/**
 * Handler pour les jobs de type snapshot_50.
 *
 * Étape 5.2 : construit le payload d'entrée pour le LLM snapshot.
 * Étape 5.3 : appel LLM snapshot, parsing JSON, validation Zod.
 * Étapes 5.4–5.5 : transaction Postgres (TTL, memory_snapshots, tables mémoire).
 *
 * Exécute exclusivement les règles de §V (extraction structurée + application mémoire).
 */

import type { MemoryJob } from '../memoryJobs.js';
import { buildSnapshotInputPayload } from '../services/snapshotPayloadService.js';
import { SNAPSHOT_SYSTEM_PROMPT, buildSnapshotUserMessage } from '../../prompts/snapshotSystemPrompt.js';
import { extractSnapshot, type ExtractSnapshotResult } from '../../llm/snapshotClient.js';
import { applySnapshot50Transaction } from '../../snapshot/applySnapshotTransaction.js';
import { logEvent, truncateLogMessage } from '../../logger.js';

/**
 * Résultat de l'étape 5.3, prêt pour 5.4–5.6.
 * Exporté pour que les étapes suivantes puissent typer leur entrée.
 */
export interface Snapshot50Result {
  /** Snapshot validé (sections invalides à null) */
  extraction: ExtractSnapshotResult;
  /** Nombre de sections non-null dans le snapshot validé */
  validSectionCount: number;
  /** Nombre d'erreurs de validation (sections ignorées, items filtrés) */
  validationErrorCount: number;
}

export async function handleSnapshot50(job: MemoryJob): Promise<void> {
  const startedAt = Date.now();
  let llmDurationMs = 0;
  let segmentUserCount = 0;
  let segmentAssistantCount = 0;
  let validSectionCount = 0;
  let validationErrorCount = 0;

  try {
    // ── 5.2 — Construction du payload ──────────────────────────────────────
    const payload = await buildSnapshotInputPayload(job);

    segmentUserCount = payload.conversationSegment.filter((m) => m.role === 'user').length;
    segmentAssistantCount = payload.conversationSegment.length - segmentUserCount;
    const memorySections = Object.entries(payload.currentMemory).map(([key, val]) => {
      if (val === null) return `${key}:null`;
      if (Array.isArray(val)) return `${key}:${val.length}`;
      return `${key}:obj`;
    });

    logEvent('debug', 'snapshot.payload', {
      job_id: job.id,
      conv_id: job.conversation_id,
      segment_user_msgs: segmentUserCount,
      segment_assistant_msgs: segmentAssistantCount,
      memory_sections: memorySections,
      payload_chars: JSON.stringify(payload).length,
    });

    // ── 5.3 — Appel LLM snapshot, parsing JSON, validation Zod ────────────

    const userMessage = buildSnapshotUserMessage(payload);
    const llmStartedAt = Date.now();
    const extraction = await extractSnapshot({
      systemPrompt: SNAPSHOT_SYSTEM_PROMPT,
      userMessage,
    });
    llmDurationMs = Date.now() - llmStartedAt;

    // Métriques de validation (sans PII)
    const { validated } = extraction;
    const sectionKeys = [
      'user_identity', 'user_identity_goals', 'user_occupation_notes',
      'user_traits', 'user_preferences', 'user_relations',
      'user_ephemeral_events', 'user_life_events',
    ] as const;

    validSectionCount = sectionKeys.filter(
      (k) => validated[k] !== null
    ).length;

    validationErrorCount = Object.keys(validated.errors).length;

    const sectionSummary = sectionKeys.map((k) => {
      const v = validated[k];
      if (v === null) return `${k}:SKIP`;
      if (typeof v === 'object' && v !== null) {
        const inner = Object.values(v)[0];
        if (Array.isArray(inner)) return `${k}:${inner.length}`;
        if (inner === null) return `${k}:null`;
        return `${k}:ok`;
      }
      return `${k}:ok`;
    });

    logEvent('debug', 'snapshot.extraction', {
      job_id: job.id,
      valid_sections: validSectionCount,
      validation_errors: validationErrorCount,
      sections: sectionSummary,
    });

    if (validationErrorCount > 0) {
      logEvent('warn', 'snapshot.validation', {
        job_id: job.id,
        error_keys: Object.keys(validated.errors),
      });
    }

    // ── 5.4 + 5.5 : transaction unique (TTL, memory_snapshots, apply mémoire) ─
    // Si le LLM n'a rien extrait (filtre contenu, refus modèle), on saute la transaction.
    if (validSectionCount === 0) {
      logEvent('warn', 'snapshot.skipped', {
        job_id: job.id,
        conv_id: job.conversation_id,
        reason: 'no_valid_sections',
      });
    } else {
      await applySnapshot50Transaction({ job, validated });
    }

    logEvent('info', 'snapshot.done', {
      job_id: job.id,
      conv_id: job.conversation_id,
      user_id: job.user_id,
      outcome: 'ok',
      total_ms: Date.now() - startedAt,
      llm_ms: llmDurationMs,
      valid_sections: validSectionCount,
      validation_errors: validationErrorCount,
      segment_user_msgs: segmentUserCount,
      segment_assistant_msgs: segmentAssistantCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logEvent('error', 'snapshot.done', {
      job_id: job.id,
      conv_id: job.conversation_id,
      user_id: job.user_id,
      outcome: 'failed',
      total_ms: Date.now() - startedAt,
      llm_ms: llmDurationMs,
      valid_sections: validSectionCount,
      validation_errors: validationErrorCount,
      segment_user_msgs: segmentUserCount,
      segment_assistant_msgs: segmentAssistantCount,
      err_msg: truncateLogMessage(msg),
    });
    throw err;
  }
}
