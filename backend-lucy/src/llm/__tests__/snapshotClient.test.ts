import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI BEFORE importing snapshotClient
vi.mock('openai', () => {
  const createMock = vi.fn();
  class MockOpenAI {
    chat = { completions: { create: createMock } };
  }
  return { default: MockOpenAI, _createMock: createMock };
});

// Mock config to provide a fake API key
vi.mock('../../config.js', () => ({
  config: {
    snapshotLlmModel: 'gpt-5-nano-2025-08-07',
    snapshotLlmApiKey: 'test-key',
    llmApiKey: 'test-key',
  },
  getSnapshotApiKey: () => 'test-key',
}));

import { extractSnapshot, _resetClient, LlmNetworkError, LlmParseError } from '../snapshotClient.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { _createMock: createMock } = await import('openai') as any;

// ---------- Helper: mock OpenAI response ----------

function mockCompletion(content: string | null, finishReason = 'stop') {
  createMock.mockResolvedValueOnce({
    choices: [{
      message: { content },
      finish_reason: finishReason,
    }],
  });
}

function emptySnapshotJson() {
  return JSON.stringify({
    user_identity: { identity_update: null },
    user_identity_goals: { goal: null },
    user_occupation_notes: { notes: [] },
    user_traits: { traits: [] },
    user_preferences: { preferences: [] },
    user_relations: { relation: null },
    user_ephemeral_events: { events: [] },
    user_life_events: { events: [] },
  });
}

const params = {
  systemPrompt: 'test system prompt',
  userMessage: 'test user message',
};

// ---------- Tests ----------

describe('extractSnapshot', () => {
  beforeEach(() => {
    _resetClient();
    createMock.mockReset();
  });

  afterEach(() => {
    _resetClient();
  });

  // ── Happy path ───────────────────────────────────────────────────────

  it('returns validated snapshot for valid empty JSON', async () => {
    mockCompletion(emptySnapshotJson());
    const result = await extractSnapshot(params);

    expect(result.finishReason).toBe('stop');
    expect(result.validated.user_identity).toEqual({ identity_update: null });
    expect(result.validated.user_traits).toEqual({ traits: [] });
    expect(Object.keys(result.validated.errors)).toHaveLength(0);
    expect(result.rawJson).toEqual(JSON.parse(emptySnapshotJson()));
  });

  it('returns validated snapshot with populated sections', async () => {
    const json = {
      user_identity: { identity_update: { location_general: 'Lyon' } },
      user_identity_goals: { goal: { goal_text: 'learn guitar' } },
      user_occupation_notes: { notes: [{ note_text: 'dev fullstack' }] },
      user_traits: { traits: [{ trait_key: 'anxious', status: 'affirm' }] },
      user_preferences: { preferences: [{ category_key: 'music_genres', value: 'jazz' }] },
      user_relations: { relation: { match_id: null, name_raw: 'Sophie', relation_type: 'friend' } },
      user_ephemeral_events: { events: [{ event_text: 'dentist tomorrow', event_at: null }] },
      user_life_events: { events: [{ event_text: 'moved to Lyon', event_at: '2026-01-15T00:00:00Z' }] },
    };
    mockCompletion(JSON.stringify(json));

    const result = await extractSnapshot(params);

    expect(result.validated.user_identity!.identity_update!.location_general).toBe('Lyon');
    expect(result.validated.user_identity_goals!.goal!.goal_text).toBe('learn guitar');
    expect(result.validated.user_traits!.traits).toHaveLength(1);
    expect(result.validated.user_preferences!.preferences).toHaveLength(1);
    expect(result.validated.user_relations!.relation!.name_raw).toBe('Sophie');
    expect(result.validated.user_ephemeral_events!.events).toHaveLength(1);
    expect(result.validated.user_life_events!.events).toHaveLength(1);
    expect(Object.keys(result.validated.errors)).toHaveLength(0);
  });

  // ── Partial validity (§I.B: invalid sections ignored) ────────────────

  it('ignores invalid sections, keeps valid ones', async () => {
    const json = {
      user_identity: { identity_update: null },
      user_identity_goals: { goal: null },
      user_occupation_notes: { notes: [] },
      user_traits: { traits: [{ trait_key: 'INVALID', status: 'affirm' }] },
      user_preferences: { preferences: [] },
      user_relations: { relation: null },
      user_ephemeral_events: { events: [] },
      user_life_events: { events: [] },
    };
    mockCompletion(JSON.stringify(json));

    const result = await extractSnapshot(params);

    // Invalid trait filtered, but section structure is valid → empty array
    expect(result.validated.user_traits!.traits).toHaveLength(0);
    expect(result.validated.errors).toHaveProperty('user_traits_items');
    // Other sections untouched
    expect(result.validated.user_identity).toEqual({ identity_update: null });
  });

  it('handles missing sections gracefully', async () => {
    const json = {
      user_identity: { identity_update: null },
      // all other sections missing
    };
    mockCompletion(JSON.stringify(json));

    const result = await extractSnapshot(params);

    expect(result.validated.user_identity).toEqual({ identity_update: null });
    expect(result.validated.user_identity_goals).toBeNull();
    expect(result.validated.user_traits).toBeNull();
    expect(result.validated.errors).toHaveProperty('user_identity_goals', 'Missing section');
  });

  // ── Error: empty response ────────────────────────────────────────────

  it('throws LlmParseError on empty response content', async () => {
    mockCompletion(null);

    const err = await extractSnapshot(params).catch((e) => e);
    expect(err).toBeInstanceOf(LlmParseError);
    expect(err.message).toContain('vide');
  });

  // ── Error: truncated JSON (finish_reason=length) ─────────────────────

  it('throws LlmParseError when finish_reason is length', async () => {
    mockCompletion('{"user_identity": {"identity_upd', 'length');

    const err = await extractSnapshot(params).catch((e) => e);
    expect(err).toBeInstanceOf(LlmParseError);
    expect(err.message).toContain('tronquée');
  });

  // ── Error: invalid JSON ──────────────────────────────────────────────

  it('throws LlmParseError on unparseable JSON', async () => {
    mockCompletion('This is not JSON at all');

    const err = await extractSnapshot(params).catch((e) => e);
    expect(err).toBeInstanceOf(LlmParseError);
    expect(err.message).toContain('invalide');
  });

  // ── Error: network/API error ─────────────────────────────────────────

  it('throws LlmNetworkError on OpenAI SDK error', async () => {
    createMock.mockRejectedValueOnce(new Error('Connection timeout'));

    const err = await extractSnapshot(params).catch((e) => e);
    expect(err).toBeInstanceOf(LlmNetworkError);
    expect(err.message).toContain('Connection timeout');
  });

  it('throws LlmNetworkError on rate limit error', async () => {
    createMock.mockRejectedValueOnce(new Error('Rate limit exceeded'));

    await expect(extractSnapshot(params)).rejects.toThrow(LlmNetworkError);
  });

  // ── Extra root keys (§V.6: warn + continue) ─────────────────────────

  it('handles extra root keys without crashing', async () => {
    const json = {
      ...JSON.parse(emptySnapshotJson()),
      unknown_extra: { some: 'data' },
    };
    mockCompletion(JSON.stringify(json));

    const result = await extractSnapshot(params);

    expect(result.validated.errors._extra_root_keys).toContain('unknown_extra');
    // Valid sections still parsed
    expect(result.validated.user_identity).toEqual({ identity_update: null });
  });

  // ── Non-object JSON root ─────────────────────────────────────────────

  it('handles array as JSON root', async () => {
    mockCompletion('[]');

    const result = await extractSnapshot(params);

    expect(result.validated.errors._root).toBe('Snapshot is not a valid object');
    expect(result.validated.user_identity).toBeNull();
  });

  // ── finishReason propagation ─────────────────────────────────────────

  it('propagates finishReason for monitoring', async () => {
    mockCompletion(emptySnapshotJson(), 'stop');
    const result = await extractSnapshot(params);
    expect(result.finishReason).toBe('stop');
  });
});
