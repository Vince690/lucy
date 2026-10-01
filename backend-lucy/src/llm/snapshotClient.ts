/**
 * Client LLM pour l'extraction de snapshots mémoire (GPT-5 nano).
 * Utilise getSnapshotApiKey() + config.snapshotLlmModel.
 *
 * Red-team hardening :
 * - Singleton invalidé si la clé API change (hot reload, test isolation)
 * - Erreurs classifiées : LlmNetworkError (retry-able) vs LlmParseError (pas de retry)
 * - max_completion_tokens garde-fou contre JSON tronqué
 * - Aucun eval/import dynamique sur la réponse LLM — seulement JSON.parse + Zod
 */

import OpenAI from 'openai';
import { config, getSnapshotApiKey } from '../config.js';
import { validateSnapshot, type ValidatedSnapshot } from './snapshotSchema.js';
import { logEvent } from '../logger.js';

const SNAPSHOT_TIMEOUT_MS = 120_000;
const SNAPSHOT_MAX_TOKENS = 16000;

// ── Error classification ─────────────────────────────────────────────────

export class LlmNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'LlmNetworkError';
  }
}

export class LlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmParseError';
  }
}

// ── Singleton client ─────────────────────────────────────────────────────

let _client: OpenAI | null = null;
let _clientKey: string | null = null;

function getClient(): OpenAI {
  const apiKey = getSnapshotApiKey();
  if (!apiKey) {
    throw new LlmNetworkError(
      'Clé API snapshot LLM non configurée (LUCY_LLM_API_KEY ou LUCY_SNAPSHOT_LLM_API_KEY)'
    );
  }
  if (!_client || _clientKey !== apiKey) {
    _client = new OpenAI({ apiKey, timeout: SNAPSHOT_TIMEOUT_MS });
    _clientKey = apiKey;
  }
  return _client;
}

export function _resetClient(): void {
  _client = null;
  _clientKey = null;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface ExtractSnapshotParams {
  systemPrompt: string;
  userMessage: string;
}

export interface ExtractSnapshotResult {
  validated: ValidatedSnapshot;
  rawJson: unknown;
  finishReason: string | null;
}

// ── Extraction ───────────────────────────────────────────────────────────

export async function extractSnapshot(
  { systemPrompt, userMessage }: ExtractSnapshotParams
): Promise<ExtractSnapshotResult> {
  const client = getClient();

  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await client.chat.completions.create({
      model: config.snapshotLlmModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_completion_tokens: SNAPSHOT_MAX_TOKENS,
      response_format: { type: 'json_object' },
      reasoning_effort: 'medium',
    });
  } catch (err) {
    throw new LlmNetworkError(
      `Appel LLM snapshot échoué: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  logEvent('info', 'snapshot.llm_usage', {
    model: completion.model,
    input_tokens: completion.usage?.prompt_tokens ?? null,
    output_tokens: completion.usage?.completion_tokens ?? null,
    reasoning_tokens: (completion.usage as any)?.completion_tokens_details?.reasoning_tokens ?? null,
    total_tokens: completion.usage?.total_tokens ?? null,
  });

  const choice = completion.choices[0];
  const finishReason = choice?.finish_reason ?? null;
  const raw = choice?.message?.content;

  // Réponse vide — filtre de contenu ou refus du modèle → snapshot ignoré (no-op)
  if (!raw) {
    return { validated: validateSnapshot(null), rawJson: null, finishReason: null };
  }

  // JSON tronqué
  if (finishReason === 'length') {
    throw new LlmParseError(
      `Réponse LLM snapshot tronquée (finish_reason=length). Début: ${raw.slice(0, 200)}…`
    );
  }

  // Parse JSON
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(raw);
  } catch {
    throw new LlmParseError(
      `JSON snapshot invalide — début de réponse : ${raw.slice(0, 300)}`
    );
  }

  // Si le modèle retourne null ou non-objet → no-op propre
  if (typeof rawJson !== 'object' || rawJson === null || Array.isArray(rawJson)) {
    return { validated: validateSnapshot(null), rawJson, finishReason };
  }

  const validated = validateSnapshot(rawJson);
  return { validated, rawJson, finishReason };
}
