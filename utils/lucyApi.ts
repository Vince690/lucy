/**
 * Client API pour le backend Lucy (POST /chat).
 *
 * Utilise fetch natif (pas de dépendance supplémentaire).
 * Le token JWT Supabase est passé en Bearer header.
 */

import i18n from '@/utils/i18n';
import {
  clearLucyConversationId,
  markPendingChatSurfaceReset,
} from '@/utils/lucyConversationStorage';

const BACKEND_URL = process.env.EXPO_PUBLIC_LUCY_BACKEND_URL ?? 'http://localhost:4000';

/** Timeout pour l'appel /chat (le backend a 45s, on ajoute une marge). */
const CHAT_FETCH_TIMEOUT_MS = 50_000;

const MEMORY_RESET_TIMEOUT_MS = 60_000;
const ACCOUNT_DELETE_TIMEOUT_MS = 30_000;

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

// ============================================================================
// Types (miroir du contrat backend — §4.1)
// ============================================================================

export interface ChatMessageResponse {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  msg_seq: number;
  created_at: string;
}

export interface ChatApiResponse {
  conversation_id: string;
  user_message: ChatMessageResponse;
  assistant_message: ChatMessageResponse;
  /** Porte du chat (constants/chatGate.ts) : comment cette requête a été admise, et où en est le quota. */
  chat_access?: 'free' | 'premium';
  free_exchanges_used?: number;
  free_exchanges_limit?: number;
  memory_debug?: {
    context_messages_count: number;
    traits_injected: number;
    preferences_injected: number;
    relations_injected: number;
    mood_today: number | null;
    rolling_avg_7: number | null;
  } | null;
}

export interface ChatApiError {
  error: string;
  message: string;
  details?: unknown;
  /** Présents sur `free_exchanges_exhausted` (402) : le mur. */
  free_exchanges_used?: number;
  free_exchanges_limit?: number;
  chat_wall_reached_at?: string;
}

/** Code d'erreur du serveur quand les échanges offerts sont épuisés sans abonnement. */
export const FREE_EXCHANGES_EXHAUSTED = 'free_exchanges_exhausted';

// ============================================================================
// Erreur typée côté client
// ============================================================================

export class LucyApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    /** Corps d'erreur du serveur, quand il y en a un (compteurs du mur, détails). */
    public readonly body: ChatApiError | null = null
  ) {
    super(message);
    this.name = 'LucyApiError';
  }
}

// ============================================================================
// Appel POST /chat
// ============================================================================

export async function sendChatMessage(
  accessToken: string,
  messageText: string,
  conversationId?: string | null
): Promise<ChatApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_FETCH_TIMEOUT_MS);

  try {
    // La langue de l'interface, donnée à Lucy comme un fait : sans elle, un message
    // court en anglais sur un compte au prénom français recevait une réponse en français.
    const body: Record<string, unknown> = {
      message_text: messageText,
      metadata: { locale: i18n.language },
    };
    if (conversationId) {
      body.conversation_id = conversationId;
    }

    const res = await fetch(`${BACKEND_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorBody: ChatApiError | undefined;
      try {
        errorBody = (await res.json()) as ChatApiError;
      } catch {
        // réponse non-JSON — on utilise le status comme info
      }

      const code = errorBody?.error ?? `http_${res.status}`;
      const message = errorBody?.message ?? `Erreur serveur (${res.status})`;
      throw new LucyApiError(code, message, res.status, errorBody ?? null);
    }

    const data = (await res.json()) as ChatApiResponse;

    // Validation minimale des champs critiques
    if (!data.conversation_id || !data.assistant_message?.content) {
      throw new LucyApiError('invalid_response', 'Réponse API incomplète', 502);
    }

    return data;
  } catch (err) {
    if (err instanceof LucyApiError) throw err;

    if (isAbortError(err)) {
      throw new LucyApiError('timeout', 'La connexion a pris trop de temps', 0);
    }

    // Erreur réseau (backend down, pas de réseau, etc.)
    throw new LucyApiError(
      'network_error',
      'Impossible de joindre Lucy — vérifie ta connexion',
      0
    );
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// POST /memory/reset — effacement mémoire + oubli local du conversation_id
// ============================================================================

export interface MemoryResetResponse {
  ok: boolean;
  reason?: string;
}

/**
 * Réinitialise la mémoire Lucy côté serveur (§VI) puis supprime le `conversation_id`
 * stocké localement pour ce compte (prochain chat = nouveau fil ou réutilisation serveur).
 */
export async function postMemoryReset(
  accessToken: string,
  userId: string
): Promise<MemoryResetResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEMORY_RESET_TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKEND_URL}/memory/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `Erreur serveur (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        /* ignore */
      }
      throw new LucyApiError('reset_failed', message, res.status);
    }

    const data = (await res.json()) as MemoryResetResponse;

    // Nettoyage local seulement après succès serveur confirmé.
    await clearLucyConversationId(userId);
    await markPendingChatSurfaceReset(userId);
    return data;
  } catch (err) {
    if (err instanceof LucyApiError) throw err;

    if (isAbortError(err)) {
      throw new LucyApiError('timeout', 'La connexion a pris trop de temps', 0);
    }

    // Erreur réseau (backend down, pas de réseau, etc.)
    throw new LucyApiError(
      'network_error',
      'Impossible de joindre Lucy — vérifie ta connexion',
      0
    );
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// POST /account/delete — suppression complète du compte (RGPD Art. 17 + Apple 5.1.1(v))
// ============================================================================

/**
 * Supprime le compte côté serveur (auth.users + cascade sur toutes les tables).
 * Nettoie aussi le conversation_id stocké localement.
 */
export async function postAccountDelete(
  accessToken: string,
  userId: string
): Promise<{ ok: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCOUNT_DELETE_TIMEOUT_MS);

  try {
    const res = await fetch(`${BACKEND_URL}/account/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    if (!res.ok) {
      let message = `Erreur serveur (${res.status})`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch { /* ignore */ }
      throw new LucyApiError('delete_failed', message, res.status);
    }

    const data = (await res.json()) as { ok: boolean };
    await clearLucyConversationId(userId);
    return data;
  } catch (err) {
    if (err instanceof LucyApiError) throw err;

    if (isAbortError(err)) {
      throw new LucyApiError('timeout', 'La connexion a pris trop de temps', 0);
    }

    throw new LucyApiError(
      'network_error',
      'Impossible de joindre Lucy — vérifie ta connexion',
      0
    );
  } finally {
    clearTimeout(timer);
  }
}
