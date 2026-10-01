/**
 * Service de chat — couche DB pour POST /chat.
 *
 * 4.2 : L'écriture du message utilisateur est une transaction atomique
 *        via la RPC Postgres `write_user_message` (SELECT ... FOR UPDATE).
 *        Cette RPC sérialise les écritures par conversation, garantissant :
 *          - msg_seq unique et ordonné,
 *          - compteurs (next_msg_seq, user_msg_count) cohérents,
 *          - jobs mémoire créés aux bons seuils, sans doublons.
 *
 * 4.4 : L'insertion du message assistant utilise une transaction séparée
 *        via la RPC `write_assistant_message` (§IV.4 Étape 3) :
 *          - verrou conversation (SELECT ... FOR UPDATE),
 *          - idempotence via msg_seq (pas de doublon si retry),
 *          - incrémentation next_msg_seq (pas user_msg_count).
 */

import { supabaseAdmin } from '../supabase.js';

// ============================================================================
// Types internes DB (lignes telles que retournées par Supabase)
// ============================================================================

export interface ConversationRow {
  id: string;
  user_id: string;
  next_msg_seq: number;
  user_msg_count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  msg_seq: number;
  created_at: string;
}

/** Résultat de writeUserMessage — tout ce que la RPC retourne. */
export interface WriteUserMessageResult {
  conversation: ConversationRow & { is_new: boolean };
  message: MessageRow;
}

// ============================================================================
// Écriture message utilisateur — transaction atomique (4.2)
// ============================================================================

/**
 * Écrit un message utilisateur de manière transactionnelle via la RPC Postgres
 * `write_user_message`. En une seule transaction, la RPC :
 *
 *   1. Résout la conversation si conversation_id est absent : réutilise la plus ancienne
 *      du user (fil unique type WhatsApp), sinon en crée une ; verrou advisory anti-doublon.
 *      Si conversation_id est fourni, utilise cette conversation (comportement inchangé).
 *   2. Verrouille la conversation (SELECT ... FOR UPDATE, §IV.3)
 *   3. Vérifie l'appartenance à userId (403 si mismatch)
 *   4. Réserve msg_seq depuis next_msg_seq
 *   5. Insère le message user
 *   6. Incrémente next_msg_seq et user_msg_count
 *   7. Met à jour updated_at (trigger)
 *   8. Crée les memory_jobs snapshot_50 si seuil 50 atteint (idempotent, ON CONFLICT DO NOTHING)
 *
 * Retourne la conversation (avec is_new) et le message inséré.
 */
export async function writeUserMessage(
  userId: string,
  messageText: string,
  conversationId?: string
): Promise<WriteUserMessageResult> {
  const { data, error } = await supabaseAdmin.rpc('write_user_message', {
    p_user_id: userId,
    p_conversation_id: conversationId ?? null,
    p_message_text: messageText,
  });

  if (error) {
    // Map Postgres exceptions to typed errors
    if (error.message?.includes('conversation_not_found')) {
      throw new ChatServiceError('not_found', 'Conversation introuvable', error, 404);
    }
    if (error.message?.includes('conversation_forbidden')) {
      throw new ChatServiceError('forbidden', 'Cette conversation ne vous appartient pas', error, 403);
    }

    throw new ChatServiceError('db_error', 'Erreur lors de l\'écriture du message', error);
  }

  if (!data) {
    throw new ChatServiceError('db_error', 'Aucune donnée retournée par write_user_message');
  }

  // La RPC retourne un jsonb ; le client Supabase le parse automatiquement.
  const result = data as {
    conversation: ConversationRow & { is_new: boolean };
    message: MessageRow;
  };

  return result;
}

// ============================================================================
// Insertion message assistant — transaction séparée (4.4, §IV.4 Étape 3)
// ============================================================================

/** Résultat de insertAssistantMessage. */
export interface InsertAssistantResult {
  message: MessageRow;
  alreadyExisted: boolean;
}

/**
 * Insère un message assistant via la RPC `write_assistant_message`.
 *
 * La RPC exécute dans une seule transaction :
 *   1. SELECT ... FOR UPDATE sur la conversation (verrou §IV.3)
 *   2. Vérification d'appartenance (user_id)
 *   3. Idempotence : si un assistant message avec le msg_seq attendu existe → retour existant
 *   4. Vérification cohérence séquence (next_msg_seq == expectedMsgSeq)
 *   5. INSERT message + incrémentation next_msg_seq
 *
 * @param expectedMsgSeq — la valeur de conversation.next_msg_seq au moment de l'appel
 *                          (= userMessage.msg_seq + 1 dans le flow normal).
 */
export async function insertAssistantMessage(
  conversationId: string,
  userId: string,
  content: string,
  expectedMsgSeq: number
): Promise<InsertAssistantResult> {
  const { data, error } = await supabaseAdmin.rpc('write_assistant_message', {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_content: content,
    p_expected_msg_seq: expectedMsgSeq,
  });

  if (error) {
    if (error.message?.includes('conversation_not_found')) {
      throw new ChatServiceError('not_found', 'Conversation introuvable', error, 404);
    }
    if (error.message?.includes('conversation_forbidden')) {
      throw new ChatServiceError('forbidden', 'Cette conversation ne vous appartient pas', error, 403);
    }
    if (error.message?.includes('msg_seq_mismatch')) {
      throw new ChatServiceError('conflict', 'Conflit de séquence — la conversation a changé', error, 409);
    }
    throw new ChatServiceError('db_error', "Erreur lors de l'insertion du message assistant", error);
  }

  if (!data) {
    throw new ChatServiceError('db_error', 'Aucune donnée retournée par write_assistant_message');
  }

  const result = data as { message: MessageRow; already_existed: boolean };
  return {
    message: result.message,
    alreadyExisted: result.already_existed,
  };
}

// ============================================================================
// Erreur métier typée
// ============================================================================

export class ChatServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause: unknown = null,
    public readonly statusCode: number = 500,
    /** Champs supplémentaires recopiés dans la réponse d'erreur (ex. compteurs du mur). */
    public readonly extra: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = 'ChatServiceError';
  }
}
