/**
 * Types et schémas Zod pour l'endpoint POST /chat.
 * Conformes au plan §4.1 et à algorithme-memoire-lucy.md §IV.
 *
 * Requête  : conversation_id (optionnel), message_text (obligatoire)
 * Réponse  : conversation_id, user_message, assistant_message, memory_debug (optionnel, dev only)
 */

import { z } from 'zod';

// ============================================================================
// REQUEST
// ============================================================================

/**
 * Schéma de validation du body de POST /chat.
 * - conversation_id : UUID v4 optionnel (absent = nouvelle conversation)
 * - message_text    : texte non vide, max 5000 caractères
 * - metadata        : infos client optionnelles (locale, platform)
 */
export const chatRequestSchema = z.object({
  conversation_id: z
    .string()
    .uuid('conversation_id doit être un UUID valide')
    .optional(),
  message_text: z
    .string({ error: 'message_text est requis' })
    .trim()
    .min(1, 'message_text ne peut pas être vide')
    .max(5000, 'message_text ne peut pas dépasser 5000 caractères'),
  metadata: z
    .object({
      locale: z.string().max(10).optional(),
      platform: z.string().max(50).optional(),
    })
    .optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ============================================================================
// RESPONSE
// ============================================================================

/** Message tel que retourné dans la réponse /chat. */
export interface ChatMessageResponse {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  msg_seq: number;
  created_at: string;
}

/** Comment cette requête a été admise : échange offert, ou abonnement actif. */
export type ChatAccessResponse = 'free' | 'premium';

/** Réponse complète de POST /chat. */
export interface ChatResponse {
  conversation_id: string;
  user_message: ChatMessageResponse;
  assistant_message: ChatMessageResponse;
  /** Porte du chat (services/chatGateService.ts) : l'app s'en sert pour poser le mur au bon moment. */
  chat_access: ChatAccessResponse;
  free_exchanges_used: number;
  free_exchanges_limit: number;
  /** Présent uniquement en env dev, utile pour le debug mémoire. */
  memory_debug?: MemoryDebugInfo | null;
}

/** Infos de debug optionnelles sur le contexte mémoire utilisé pour la réponse. */
export interface MemoryDebugInfo {
  context_messages_count: number;
  traits_injected: number;
  preferences_injected: number;
  relations_injected: number;
  mood_today: number | null;
  rolling_avg_7: number | null;
}

/** Réponse d'erreur standardisée. */
export interface ChatErrorResponse {
  error: string;
  message: string;
  details?: unknown;
  /** Présents sur `free_exchanges_exhausted` (402). */
  free_exchanges_used?: number;
  free_exchanges_limit?: number;
  /** Instant du premier refus (ISO) : ce qui referme l'app derrière le paywall. */
  chat_wall_reached_at?: string;
}
