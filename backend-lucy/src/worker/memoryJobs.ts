/**
 * Worker des jobs mémoire (snapshot_50 uniquement).
 *
 * Boucle principale :
 *   1. Claim atomique du prochain job pending via RPC claim_next_memory_job()
 *      (FIFO created_at ASC)
 *   2. Dispatch au handler selon job_type (§IV.5.2)
 *   3. Marquage done ou failed (§IV.5.3)
 *   4. Retry : si attempt_count < max, remise en pending avec backoff
 *
 * Concurrence : le RPC utilise FOR UPDATE SKIP LOCKED — deux workers ne
 * traitent jamais le même job (§IV.5.1, §IV.7 checklist).
 *
 * Idempotence : les tables mémoire appliquent leurs propres UNIQUE/dédup ;
 * réexécuter un job produit le même état final (§IV.5.3 idempotence).
 */

import { supabaseAdmin } from '../supabase.js';
import { config } from '../config.js';
import { NonRetryableError } from '../errors.js';
import { LlmNetworkError, LlmParseError } from '../llm/snapshotClient.js';
import { logEvent, truncateLogMessage } from '../logger.js';
import { handleSnapshot50 } from './handlers/handleSnapshot50.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryJob {
  id: string;
  conversation_id: string;
  user_id: string;
  job_type: 'snapshot_50';
  trigger_user_msg_count: number;
  attempt_count: number;
  created_at: string;
}

interface ClaimResult {
  claimed: boolean;
  id?: string;
  conversation_id?: string;
  user_id?: string;
  job_type?: 'snapshot_50';
  trigger_user_msg_count?: number;
  attempt_count?: number;
  created_at?: string;
}

export interface WorkerResult {
  processed: number;
  errors: string[];
}

// ─── Error classification ────────────────────────────────────────────────────

/**
 * Détermine si une erreur est transitoire (retentable) ou permanente.
 *
 * Politique :
 *   NonRetryableError → false  : erreur logique permanente (conversation introuvable, etc.)
 *   LlmParseError     → false  : JSON LLM inutilisable ; même input → même échec (déterministe)
 *   LlmNetworkError   → true   : réseau / quota / auth, transitoire
 *   pg 40001/40P01    → true   : serialization failure / deadlock, transitoire
 *   pg 55P03          → true   : lock_not_available, transitoire
 *   Toute autre       → true   : bénéfice du doute, plafonnée par WORKER_MAX_RETRIES
 *
 * Note : LlmParseError est marqué non-retentable car le LLM retournera probablement
 * le même JSON invalide avec les mêmes entrées. Si le modèle est temporairement
 * défaillant, la prochaine rotation (nouveau job) bénéficiera d'un modèle sain.
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof NonRetryableError) return false;
  if (err instanceof LlmParseError) return false;
  if (err instanceof LlmNetworkError) return true;
  // Erreurs pg de concurrence (déterminables via la propriété `code`) :
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;
    if (code === '40001' || code === '40P01' || code === '55P03') return true;
  }
  return true; // Erreur inconnue → retry par défaut
}

// ─── Handlers map ───────────────────────────────────────────────────────────

const JOB_HANDLERS: Record<string, (job: MemoryJob) => Promise<void>> = {
  snapshot_50: handleSnapshot50,
};

// ─── Claim ──────────────────────────────────────────────────────────────────

async function claimNextJob(): Promise<MemoryJob | null> {
  const { data, error } = await supabaseAdmin.rpc('claim_next_memory_job');

  if (error) {
    throw new Error(`[worker] claim_next_memory_job RPC failed: ${error.message}`);
  }

  const result = data as ClaimResult;
  if (!result.claimed) return null;

  return {
    id: result.id!,
    conversation_id: result.conversation_id!,
    user_id: result.user_id!,
    job_type: result.job_type!,
    trigger_user_msg_count: result.trigger_user_msg_count!,
    attempt_count: result.attempt_count!,
    created_at: result.created_at!,
  };
}

// ─── Status transitions ────────────────────────────────────────────────────

async function markJobDone(jobId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('memory_jobs')
    .update({
      status: 'done',
      last_error: null,
      locked_at: null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    logEvent('error', 'worker.mark_done_failed', {
      job_id: jobId,
      err_msg: truncateLogMessage(error.message),
    });
  }
}

/**
 * Marque un job en échec.
 *
 * Si `retryable` est true et que le budget n'est pas épuisé, le job repasse en
 * `pending` avec `next_retry_at` dans le futur (backoff WORKER_RETRY_BACKOFF_MS).
 * Sinon le job passe définitivement en `failed`.
 *
 * La décision `retryable` est fournie par l'appelant via `isRetryableError(err)` ;
 * elle sépare les erreurs transitoires (réseau, deadlock) des erreurs permanentes
 * (NonRetryableError, LlmParseError).
 */
async function markJobFailed(
  jobId: string,
  errorMsg: string,
  attemptCount: number,
  retryable: boolean,
): Promise<void> {
  const canRetry = retryable && attemptCount < config.workerMaxRetries;
  const retryAfter = canRetry
    ? new Date(Date.now() + config.workerRetryBackoffMs).toISOString()
    : null;

  const { error } = await supabaseAdmin
    .from('memory_jobs')
    .update({
      status: canRetry ? 'pending' : 'failed',
      last_error: errorMsg,
      locked_at: null,
      // Backoff réel : claim_next_memory_job ignore les pending avant next_retry_at.
      next_retry_at: retryAfter,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    logEvent('error', 'worker.mark_failed_update_failed', {
      job_id: jobId,
      err_msg: truncateLogMessage(error.message),
    });
  }

  if (canRetry) {
    logEvent('info', 'worker.job_replanned', {
      job_id: jobId,
      attempt: attemptCount,
      max_retries: config.workerMaxRetries,
      backoff_ms: config.workerRetryBackoffMs,
      next_retry_at: retryAfter,
    });
  } else if (!retryable) {
    logEvent('warn', 'worker.job_failed_permanent', {
      job_id: jobId,
      reason: 'non_retryable',
      err_msg: truncateLogMessage(errorMsg),
    });
  } else {
    logEvent('warn', 'worker.job_failed_permanent', {
      job_id: jobId,
      reason: 'max_retries',
      attempt: attemptCount,
      err_msg: truncateLogMessage(errorMsg),
    });
  }
}

// ─── Stale lock recovery ───────────────────────────────────────────────────

/**
 * Récupère les jobs bloqués en running depuis trop longtemps (crash worker).
 * Les remet en pending si attempt_count < max, sinon en failed.
 */
async function recoverStaleJobs(): Promise<number> {
  const staleCutoff = new Date(Date.now() - config.workerStaleLockMs).toISOString();

  const { data: staleJobs, error } = await supabaseAdmin
    .from('memory_jobs')
    .select('id, attempt_count')
    .eq('status', 'running')
    .lt('locked_at', staleCutoff);

  if (error) {
    logEvent('error', 'worker.stale_query_failed', {
      err_msg: truncateLogMessage(error.message),
    });
    return 0;
  }

  if (!staleJobs || staleJobs.length === 0) return 0;

  let recovered = 0;
  for (const stale of staleJobs) {
    const canRetry = stale.attempt_count < config.workerMaxRetries;
    // Mise à jour atomique : ne touche que si toujours running avec lock expiré (évite course avec fin normale).
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('memory_jobs')
      .update({
        status: canRetry ? 'pending' : 'failed',
        locked_at: null,
        next_retry_at: null,
        last_error: 'Recovered from stale lock (worker timeout)',
        updated_at: new Date().toISOString(),
      })
      .eq('id', stale.id)
      .eq('status', 'running')
      .lt('locked_at', staleCutoff)
      .select('id');

    if (!updateError && updated && updated.length > 0) {
      recovered++;
      logEvent('info', 'worker.stale_recovered', {
        job_id: stale.id,
        new_status: canRetry ? 'pending' : 'failed',
      });
    }
  }

  return recovered;
}

// ─── Main loop ──────────────────────────────────────────────────────────────

export async function runMemoryJobsWorker(): Promise<WorkerResult> {
  const errors: string[] = [];
  let processed = 0;

  logEvent('info', 'worker.cycle_start', {});

  // 1. Récupérer les jobs potentiellement bloqués (stale locks)
  const recovered = await recoverStaleJobs();
  if (recovered > 0) {
    logEvent('info', 'worker.stale_batch', { recovered });
  }

  // 2. Boucle : claim + execute, un job à la fois, jusqu'à épuisement ou limite batch
  while (processed < config.workerBatchSize) {
    let job: MemoryJob | null;

    try {
      job = await claimNextJob();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      logEvent('error', 'worker.claim_failed', { err_msg: truncateLogMessage(msg) });
      break;
    }

    // Plus de jobs pending
    if (!job) break;

    const handler = JOB_HANDLERS[job.job_type];
    if (!handler) {
      const msg = `Unknown job_type: ${job.job_type}`;
      errors.push(msg);
      logEvent('error', 'worker.unknown_job_type', {
        job_id: job.id,
        job_type: job.job_type,
      });
      // Type de job inconnu = erreur logique permanente → non-retentable.
      await markJobFailed(job.id, msg, job.attempt_count, false);
      processed++;
      continue;
    }

    logEvent('debug', 'worker.processing', {
      job_id: job.id,
      job_type: job.job_type,
      conv_id: job.conversation_id,
      attempt: job.attempt_count,
    });

    try {
      await handler(job);
      await markJobDone(job.id);
      processed++;

      logEvent('debug', 'worker.handler_ok', { job_id: job.id, job_type: job.job_type });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableError(err);
      errors.push(`job ${job.id}: ${msg}`);
      // snapshot_50 : snapshot.done (outcome failed) est déjà émis dans handleSnapshot50
      if (job.job_type !== 'snapshot_50') {
        logEvent('error', 'worker.handler_failed', {
          job_id: job.id,
          job_type: job.job_type,
          retryable,
          err_msg: truncateLogMessage(msg),
        });
      }
      await markJobFailed(job.id, msg, job.attempt_count, retryable);
      processed++;
    }
  }

  logEvent('info', 'worker.cycle_end', {
    processed,
    error_count: errors.length,
  });

  return { processed, errors };
}
