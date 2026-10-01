import { supabase } from './supabase';

export interface DbMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  msg_seq: number;
  created_at: string;
}

const PAGE_SIZE = 50;

/**
 * Chargement initial quand aucun conversation_id n'est en cache.
 * Requête directe par user_id — évite un aller-retour supplémentaire sur la table conversations.
 * Retourne aussi le conversation_id extrait du résultat.
 */
export async function fetchLatestMessages(
  userId: string
): Promise<{ messages: DbMessage[]; hasMore: boolean; conversationId: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, role, content, msg_seq, created_at')
    .eq('user_id', userId)
    .order('msg_seq', { ascending: false })
    .limit(PAGE_SIZE + 1);

  // Une erreur (réseau, session) doit remonter : la confondre avec « aucun message »
  // faisait rejouer la séquence de bienvenue dans une nouvelle conversation.
  if (error) throw error;
  if (!data || data.length === 0) {
    return { messages: [], hasMore: false, conversationId: null };
  }

  const hasMore = data.length > PAGE_SIZE;
  const slice = (hasMore ? data.slice(0, PAGE_SIZE) : data) as DbMessage[];
  const conversationId = slice[0]?.conversation_id ?? null;

  return {
    messages: [...slice].reverse(),
    hasMore,
    conversationId,
  };
}

/**
 * Chargement par conversation_id (cas normal ou pagination).
 * beforeSeq : pour la pagination, récupère les messages dont msg_seq < beforeSeq.
 */
export async function fetchMessages(
  conversationId: string,
  beforeSeq?: number
): Promise<{ messages: DbMessage[]; hasMore: boolean }> {
  let query = supabase
    .from('messages')
    .select('id, conversation_id, role, content, msg_seq, created_at')
    .eq('conversation_id', conversationId)
    .order('msg_seq', { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (beforeSeq !== undefined) {
    query = query.lt('msg_seq', beforeSeq);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data) return { messages: [], hasMore: false };

  const hasMore = data.length > PAGE_SIZE;
  const slice = hasMore ? data.slice(0, PAGE_SIZE) : data;

  return {
    messages: ([...slice].reverse()) as DbMessage[],
    hasMore,
  };
}
