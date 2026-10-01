/**
 * Tests unitaires pour la logique de retry du worker (§IV.5.3, §V.13).
 *
 * Couvre :
 * - isRetryableError : classification des types d'erreur
 * - markJobFailed / runMemoryJobsWorker : comportement retry vs failed permanent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock Supabase admin
const updateMock = vi.fn();
const selectMock = vi.fn();

vi.mock('../../supabase.js', () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn(() => ({ data: [], error: null })),
        })),
      })),
    })),
  },
}));

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    workerMaxRetries: 3,
    workerRetryBackoffMs: 60_000,
    workerBatchSize: 10,
    workerStaleLockMs: 900_000,
    env: 'test',
  },
}));

// Mock handlers (défauts neutres — remplacés par test)
vi.mock('../handlers/handleSnapshot50.js', () => ({
  handleSnapshot50: vi.fn(),
}));

import { isRetryableError } from '../memoryJobs.js';
import { LlmNetworkError, LlmParseError } from '../../llm/snapshotClient.js';
import { NonRetryableError } from '../../errors.js';
import { supabaseAdmin } from '../../supabase.js';
import { runMemoryJobsWorker } from '../memoryJobs.js';
import { handleSnapshot50 } from '../handlers/handleSnapshot50.js';

// ── isRetryableError ─────────────────────────────────────────────────────────

describe('isRetryableError', () => {
  it('retourne false pour NonRetryableError', () => {
    expect(isRetryableError(new NonRetryableError('conv introuvable'))).toBe(false);
  });

  it('retourne false pour LlmParseError', () => {
    expect(isRetryableError(new LlmParseError('JSON invalide'))).toBe(false);
  });

  it('retourne true pour LlmNetworkError', () => {
    expect(isRetryableError(new LlmNetworkError('timeout'))).toBe(true);
  });

  it('retourne true pour deadlock pg (40P01)', () => {
    const err = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    expect(isRetryableError(err)).toBe(true);
  });

  it('retourne true pour serialization failure pg (40001)', () => {
    const err = Object.assign(new Error('serialization failure'), { code: '40001' });
    expect(isRetryableError(err)).toBe(true);
  });

  it('retourne true pour lock_not_available pg (55P03)', () => {
    const err = Object.assign(new Error('lock not available'), { code: '55P03' });
    expect(isRetryableError(err)).toBe(true);
  });

  it('retourne true pour une Error générique inconnue', () => {
    expect(isRetryableError(new Error('une erreur inattendue'))).toBe(true);
  });

  it('retourne true pour une valeur non-Error', () => {
    expect(isRetryableError('chaîne brute')).toBe(true);
    expect(isRetryableError(null)).toBe(true);
  });
});

// ── Worker : comportement retry via runMemoryJobsWorker ──────────────────────

/**
 * Construit un mock supabaseAdmin.from() qui capture les appels update().
 * Retourne le spy pour pouvoir inspecter les arguments.
 */
function setupSupabaseMockCapture() {
  const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ error: null }) });
  const selectSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      lt: vi.fn().mockReturnValue({ data: [], error: null }),
    }),
  });
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    update: updateSpy,
    select: selectSpy,
  } as unknown as ReturnType<typeof supabaseAdmin.from>);
  return { updateSpy, selectSpy };
}

describe('runMemoryJobsWorker — retry policy', () => {
  const baseJob = {
    claimed: true,
    id: 'job-1',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    job_type: 'snapshot_50' as const,
    trigger_user_msg_count: 50,
    attempt_count: 1,
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('marque pending (retry) quand handler lève LlmNetworkError et attempt < max', async () => {
    // claim retourne un job, puis aucun job
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: baseJob, error: null } as never)
      .mockResolvedValueOnce({ data: { claimed: false }, error: null } as never);

    vi.mocked(handleSnapshot50).mockRejectedValueOnce(
      new LlmNetworkError('timeout réseau')
    );

    const { updateSpy } = setupSupabaseMockCapture();

    const result = await runMemoryJobsWorker();

    expect(result.processed).toBe(1);
    expect(result.errors).toHaveLength(1);

    // L'update doit avoir mis status=pending (retry car LlmNetworkError + attempt 1 < max 3)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });

  it('marque failed directement quand handler lève LlmParseError (non-retentable)', async () => {
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: baseJob, error: null } as never)
      .mockResolvedValueOnce({ data: { claimed: false }, error: null } as never);

    vi.mocked(handleSnapshot50).mockRejectedValueOnce(
      new LlmParseError('JSON tronqué')
    );

    const { updateSpy } = setupSupabaseMockCapture();

    const result = await runMemoryJobsWorker();

    expect(result.processed).toBe(1);
    // LlmParseError → non-retentable → status doit être failed, pas pending
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('marque failed directement pour NonRetryableError (conversation introuvable)', async () => {
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: baseJob, error: null } as never)
      .mockResolvedValueOnce({ data: { claimed: false }, error: null } as never);

    vi.mocked(handleSnapshot50).mockRejectedValueOnce(
      new NonRetryableError('Conversation conv-1 introuvable')
    );

    const { updateSpy } = setupSupabaseMockCapture();

    const result = await runMemoryJobsWorker();

    expect(result.processed).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', last_error: expect.stringContaining('introuvable') })
    );
  });

  it('marque failed définitif quand attempt_count atteint workerMaxRetries (même si retryable)', async () => {
    // attempt_count = 3 = workerMaxRetries → plus de budget
    const exhaustedJob = { ...baseJob, attempt_count: 3 };

    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: exhaustedJob, error: null } as never)
      .mockResolvedValueOnce({ data: { claimed: false }, error: null } as never);

    vi.mocked(handleSnapshot50).mockRejectedValueOnce(
      new LlmNetworkError('timeout')
    );

    const { updateSpy } = setupSupabaseMockCapture();

    await runMemoryJobsWorker();

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('marque done et ne pousse pas d erreur si le handler réussit', async () => {
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: baseJob, error: null } as never)
      .mockResolvedValueOnce({ data: { claimed: false }, error: null } as never);

    vi.mocked(handleSnapshot50).mockResolvedValueOnce(undefined);

    const { updateSpy } = setupSupabaseMockCapture();

    const result = await runMemoryJobsWorker();

    expect(result.processed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' })
    );
  });
});
