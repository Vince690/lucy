/**
 * Client LLM pour le chat utilisateur (GPT-5 mini).
 * Utilise config.llmApiKey + config.llmModel.
 *
 * Implémentation via l’API **Responses** (recommandée par OpenAI pour les modèles récents) :
 * @see https://developers.openai.com/api/docs
 *
 * Réponse bloquante, timeout explicite, pas de retry (géré au niveau appelant).
 */

import OpenAI from 'openai';
import type {
  Response as OpenAIResponse,
  EasyInputMessage,
  ResponseInput,
} from 'openai/resources/responses/responses.js';
import { config } from '../config.js';
import { logEvent } from '../logger.js';

const CHAT_TIMEOUT_MS = 30_000;

/**
 * Messages visibles côté utilisateur si le modèle ne fournit pas de texte exploitable
 * (refus, filtre, sortie vide). Écrits dans la voix de Lucy, pas celle d'un assistant.
 * En français uniquement : le serveur ne connaît pas la langue de l'utilisateur.
 */
const FALLBACK_GENERAL_FR = "attends, j'ai bugué là. tu me redis ?";

const FALLBACK_REFUSAL_FR = "hmm je vais passer sur ça, je suis pas à l'aise. raconte-moi le reste plutôt";

const FALLBACK_CONTENT_FILTER_FR = "là comme ça je peux pas te répondre. dis-le moi autrement, avec tes mots";

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateChatResponseParams {
  messages: ChatMessage[];
  systemPrompt: string;
  maxTokens?: number;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!config.llmApiKey) {
    throw new Error('LUCY_LLM_API_KEY non configurée — impossible d\'appeler le LLM chat');
  }
  if (!_client) {
    _client = new OpenAI({
      apiKey: config.llmApiKey,
      timeout: CHAT_TIMEOUT_MS,
    });
  }
  return _client;
}

/**
 * Construit `instructions` + tableau d’entrées pour l’API Responses.
 * Les messages `system` dans l’historique sont fusionnés dans les instructions (hors prompt principal).
 */
function buildInstructionsAndInput(
  systemPrompt: string,
  messages: ChatMessage[]
): { instructions: string; input: ResponseInput } {
  const systemExtras: string[] = [];
  const inputItems: EasyInputMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemExtras.push(m.content);
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      continue;
    }
    inputItems.push({
      role: m.role,
      content: m.content,
    });
  }

  const instructions =
    systemExtras.length > 0
      ? `${systemPrompt}\n\n---\n\nContexte additionnel (historique système) :\n${systemExtras.join('\n\n')}`
      : systemPrompt;

  return { instructions, input: inputItems };
}

function collectFromOutputItems(output: OpenAIResponse['output']): {
  textParts: string[];
  hasRefusal: boolean;
} {
  const textParts: string[] = [];
  let hasRefusal = false;

  for (const item of output) {
    if (item.type !== 'message' || item.role !== 'assistant') {
      continue;
    }
    for (const part of item.content) {
      if (part.type === 'output_text' && part.text) {
        textParts.push(part.text);
      } else if (part.type === 'refusal') {
        hasRefusal = true;
      }
    }
  }

  return { textParts, hasRefusal };
}

/**
 * Extrait le texte assistant de façon défensive : préfère `output_text` agrégé (SDK),
 * sinon reconstruit depuis `output[]` (messages assistant + parties texte).
 */
function resolveAssistantText(resp: OpenAIResponse): {
  text: string;
  hasRefusal: boolean;
  source: 'output_text' | 'output_items' | 'empty';
} {
  const aggregated = (resp.output_text ?? '').trim();
  if (aggregated.length > 0) {
    const { hasRefusal } = collectFromOutputItems(resp.output);
    return { text: aggregated, hasRefusal, source: 'output_text' };
  }

  const { textParts, hasRefusal } = collectFromOutputItems(resp.output);
  const joined = textParts.join('').trim() || textParts.join('\n').trim();
  if (joined.length > 0) {
    return { text: joined, hasRefusal, source: 'output_items' };
  }

  return { text: '', hasRefusal, source: 'empty' };
}

function pickFallbackMessage(
  hasRefusal: boolean,
  incompleteReason: 'max_output_tokens' | 'content_filter' | undefined
): string {
  if (hasRefusal) {
    return FALLBACK_REFUSAL_FR;
  }
  if (incompleteReason === 'content_filter') {
    return FALLBACK_CONTENT_FILTER_FR;
  }
  return FALLBACK_GENERAL_FR;
}

function logLlmDiagnostics(resp: OpenAIResponse, extra: Record<string, unknown>): void {
  console.warn(
    '[llm.chat]',
    JSON.stringify({
      response_id: resp.id,
      model: resp.model,
      status: resp.status,
      error: resp.error,
      incomplete_details: resp.incomplete_details,
      usage: resp.usage,
      ...extra,
    })
  );
}

/**
 * Génère une réponse de Lucy au message utilisateur via l’API Responses.
 * Ne renvoie jamais une chaîne vide : en cas de refus / sortie vide / filtre, un message de secours en français est utilisé.
 *
 * @throws Si la clé API est absente, ou si l’API signale une erreur bloquante (`error`, statut `failed`, etc.).
 */
export async function generateChatResponse({
  messages,
  systemPrompt,
  maxTokens = 2000,
}: GenerateChatResponseParams): Promise<string> {
  const client = getClient();
  const { instructions, input } = buildInstructionsAndInput(systemPrompt, messages);

  const response = await client.responses.create({
    model: config.llmModel,
    instructions,
    input,
    max_output_tokens: maxTokens,
    /** Pas de stockage côté OpenAI : l’historique est déjà géré dans Supabase. */
    store: false,
    /**
     * Le raisonnement est facturé en output et pèse >90 % du coût par tour.
     * `default` = paramètre omis, donc défaut du modèle (voir config.llmReasoningEffort).
     */
    ...(config.llmReasoningEffort !== 'default'
      ? { reasoning: { effort: config.llmReasoningEffort } }
      : {}),
  });

  /**
   * Usage réel du tour. `model` est celui renvoyé par l'API (pas celui demandé),
   * et `reasoning_effort_config` la valeur envoyée : les deux ensemble permettent de
   * vérifier en production qu'un déploiement a bien pris effet.
   *
   * `cached_input_tokens` vient de input_tokens_details — l'ancien log `[cache]`
   * affichait output_tokens_details, donc ne montrait pas le cache malgré son nom.
   */
  logEvent('info', 'chat.llm_usage', {
    model: response.model,
    reasoning_effort_config: config.llmReasoningEffort,
    reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
    output_tokens: response.usage?.output_tokens ?? null,
    input_tokens: response.usage?.input_tokens ?? null,
    cached_input_tokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
  });

  if (response.error) {
    logLlmDiagnostics(response, { phase: 'api_error_object' });
    throw new Error(
      `Réponse API invalide : ${response.error.message ?? JSON.stringify(response.error)}`
    );
  }

  if (response.status === 'failed' || response.status === 'cancelled') {
    logLlmDiagnostics(response, { phase: 'terminal_status' });
    throw new Error(`Génération échouée (statut ${response.status ?? 'inconnu'})`);
  }

  const { text, hasRefusal, source } = resolveAssistantText(response);

  if (text.length > 0) {
    return text;
  }

  const incompleteReason = response.incomplete_details?.reason;
  const fallback = pickFallbackMessage(hasRefusal, incompleteReason);

  logLlmDiagnostics(response, {
    phase: 'empty_output_fallback',
    extraction_source: source,
    has_refusal: hasRefusal,
    incomplete_reason: incompleteReason ?? null,
  });

  return fallback;
}
