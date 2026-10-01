import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, AuthenticatedRequest } from '../auth.js';
import {
  chatRequestSchema,
  ChatResponse,
  ChatMessageResponse,
  ChatErrorResponse,
} from '../types/chat.js';
import { config, hasLlmConfig } from '../config.js';
import {
  writeUserMessage,
  insertAssistantMessage,
  ChatServiceError,
  MessageRow,
} from '../services/chatService.js';
import { buildChatContext } from '../services/chatContextService.js';
import { decideChatAccess, refundFreeExchange } from '../services/chatGateService.js';
import { chatRateLimit } from '../middleware/chatRateLimit.js';
import { generateChatResponse } from '../llm/chatClient.js';
import { cleanAssistantText } from '../llm/cleanAssistantText.js';
import {
  buildSystemPromptWithMemory,
  contextMessagesToLlm,
} from '../services/llmPromptService.js';
import { logEvent } from '../logger.js';

const router = Router();

/**
 * POST /chat
 *
 * Endpoint principal de conversation Lucy (§4.1–4.4 du plan).
 *
 * Flow :
 *   1. Validation body (Zod)
 *   1b. Porte du chat — échange offert consommé, ou abonnement vérifié (chatGateService)
 *   2. Écriture message user — transaction atomique (RPC write_user_message, §4.2)
 *   3. Construction contexte LLM — 30 derniers messages + mémoire longue (§4.3)
 *   4. Appel LLM réel — system prompt (personnalité + mémoire) + messages (§4.4-A)
 *   5. Persistance assistant — transaction séparée, idempotente (RPC write_assistant_message, §4.4-B)
 *   6. Réponse avec memory_debug réel (dev)
 */
router.post('/', requireAuth, chatRateLimit, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId!;
  const requestId = req.header('x-request-id') || randomUUID();
  const startedAt = Date.now();
  let outcome = 'ok';
  res.setHeader('x-request-id', requestId);

  // --- 1. Validation du body ---
  const parsed = chatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    outcome = 'invalid_body';
    const errorResponse: ChatErrorResponse = {
      error: 'invalid_body',
      message: 'Corps de requête invalide',
      details: parsed.error.flatten().fieldErrors,
    };
    res.status(400).json(errorResponse);
    logEvent('info', 'chat.response', {
      request_id: requestId,
      user_id: userId,
      outcome,
      status: 400,
      duration_ms: Date.now() - startedAt,
    });
    return;
  }

  try {
    await withRouteTimeout(
      runChatFlow(parsed.data, res, userId, startedAt, requestId, (nextOutcome) => {
        outcome = nextOutcome;
      }),
      config.chatRouteTimeoutMs
    );
  } catch (err) {
    if (res.headersSent) {
      return;
    }

    if (err instanceof ChatServiceError) {
      outcome = err.code;
      const errorResponse: ChatErrorResponse = {
        error: err.code,
        message: err.message,
        ...(err.extra ?? {}),
      };
      res.status(err.statusCode).json(errorResponse);
      logEvent('warn', 'chat.response', {
        request_id: requestId,
        user_id: userId,
        outcome,
        status: err.statusCode,
        duration_ms: Date.now() - startedAt,
      });
      return;
    }

    outcome = 'internal_error';
    const errorResponse: ChatErrorResponse = {
      error: 'internal_error',
      message: 'Erreur interne du serveur',
    };
    res.status(500).json(errorResponse);
    logEvent('error', 'chat.response', {
      request_id: requestId,
      user_id: userId,
      outcome,
      status: 500,
      err_msg: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startedAt,
    });
  }
});

async function runChatFlow(
  payload: { conversation_id?: string; message_text: string; metadata?: { locale?: string } },
  res: Response,
  userId: string,
  startedAt: number,
  requestId: string,
  setOutcome: (outcome: string) => void
): Promise<void> {
  const { conversation_id, message_text } = payload;

  // --- 1b. Porte du chat (pré-essai à N échanges, puis abonnement) ---
  // AVANT toute écriture : un message refusé n'existe nulle part. Lance 402 quand
  // les échanges offerts sont épuisés sans abonnement, 503 quand RevenueCat ne
  // répond pas. Ces deux erreurs sortent d'ici sans rien à rembourser.
  let access;
  try {
    access = await decideChatAccess(userId);
  } catch (err) {
    setOutcome(err instanceof ChatServiceError ? err.code : 'internal_error');
    throw err;
  }

  try {
    // --- 2. Écriture message user (transaction atomique, §4.2) ---
    const { conversation, message: userMessage } = await writeUserMessage(
      userId,
      message_text,
      conversation_id
    );

    // --- 3. Construction contexte LLM (§4.3) ---
    const chatContext = await buildChatContext(
      conversation.id,
      userId,
      conversation.user_msg_count
    );

    // --- 4. Appel LLM réel (§4.4-A) ---
    const systemPrompt = buildSystemPromptWithMemory(chatContext, new Date(), payload.metadata?.locale);
    const llmMessages = contextMessagesToLlm(chatContext);

    let assistantContent: string;
    const llmStartedAt = Date.now();

    if (!hasLlmConfig()) {
      // Pas de clé LLM configurée — erreur explicite, pas de placeholder silencieux
      throw new ChatServiceError(
        'llm_not_configured',
        'LUCY_LLM_API_KEY non configurée — impossible de générer une réponse',
        null,
        503
      );
    }

    try {
      assistantContent = await generateChatResponse({
        messages: llmMessages,
        systemPrompt,
      });
    } catch (llmErr) {
      const llmDurationMs = Date.now() - llmStartedAt;
      logEvent('error', 'chat.llm_error', {
        request_id: requestId,
        user_id: userId,
        conv_id: conversation.id,
        llm_ms: llmDurationMs,
        err_msg: llmErr instanceof Error ? llmErr.message : String(llmErr),
      });
      throw new ChatServiceError(
        'llm_error',
        'Lucy est momentanément indisponible, réessaie dans quelques instants',
        llmErr,
        502
      );
    }

    const llmDurationMs = Date.now() - llmStartedAt;

    // Nettoyage déterministe : tirets de ponctuation, puces, paragraphes (voir cleanAssistantText).
    assistantContent = cleanAssistantText(assistantContent);
    if (!assistantContent) {
      throw new ChatServiceError(
        'llm_empty_response',
        'La réponse du LLM est vide',
        null,
        502
      );
    }

    // --- 5. Persistance assistant (transaction séparée, §4.4-B) ---
    // expectedMsgSeq = conversation.next_msg_seq (réservé par writeUserMessage)
    const { message: assistantMessage, alreadyExisted } = await insertAssistantMessage(
      conversation.id,
      userId,
      assistantContent,
      conversation.next_msg_seq
    );

    if (alreadyExisted) {
      logEvent('warn', 'chat.idempotent_hit', {
        request_id: requestId,
        user_id: userId,
        conv_id: conversation.id,
        msg_seq: assistantMessage.msg_seq,
      });
    }

    // --- 6. Réponse ---
    const toMessageResponse = (row: MessageRow): ChatMessageResponse => ({
      id: row.id,
      role: row.role,
      content: row.content,
      msg_seq: row.msg_seq,
      created_at: row.created_at,
    });

    const response: ChatResponse = {
      conversation_id: conversation.id,
      user_message: toMessageResponse(userMessage),
      assistant_message: toMessageResponse(assistantMessage),
      chat_access: access.access,
      free_exchanges_used: access.freeExchangesUsed,
      free_exchanges_limit: access.freeExchangesLimit,
      ...(config.env === 'dev'
        ? {
            memory_debug: {
              context_messages_count: chatContext.messages.length,
              traits_injected: chatContext.memory.traits.length,
              preferences_injected: chatContext.memory.preferences.length,
              relations_injected: chatContext.memory.relations.length,
              mood_today: chatContext.memory.mood.mood_today,
              rolling_avg_7: chatContext.memory.mood.rolling_avg_7,
            },
          }
        : {}),
    };

    if (res.headersSent) {
      return;
    }

    res.status(200).json(response);
    logEvent('info', 'chat.response', {
      request_id: requestId,
      user_id: userId,
      outcome: 'ok',
      status: 200,
      conv_id: conversation.id,
      is_new: conversation.is_new,
      msg_seq: userMessage.msg_seq,
      user_msg_count: conversation.user_msg_count,
      chat_access: access.access,
      free_exchanges_used: access.freeExchangesUsed,
      ctx_msgs: chatContext.messages.length,
      memory_traits: chatContext.memory.traits.length,
      memory_prefs: chatContext.memory.preferences.length,
      memory_relations: chatContext.memory.relations.length,
      llm_ms: llmDurationMs,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    // L'échange offert a été consommé avant le traitement : s'il échoue, on le rend.
    // Jamais pour un abonné (rien n'a été consommé) — et jamais bloquant.
    if (access.access === 'free') {
      await refundFreeExchange(userId);
    }

    if (err instanceof ChatServiceError) {
      setOutcome(err.code);
      throw err;
    }

    setOutcome('internal_error');
    throw err;
  }
}

async function withRouteTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ChatServiceError('timeout', 'Le traitement a dépassé le délai maximum', null, 504));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export default router;
