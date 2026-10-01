/**
 * Persistance locale du conversation_id « fil unique Lucy » (par compte).
 * À vider après un reset mémoire réussi (§VI + cohérence app).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const LUCY_CONVERSATION_ID_KEY_PREFIX = 'lucy_conversation_id_';

const LUCY_CHAT_SURFACE_RESET_PENDING_PREFIX = 'lucy_chat_surface_reset_pending_';

const LUCY_LAST_MESSAGE_SENT_AT_PREFIX = 'lucy_last_message_sent_at_';

const LUCY_DAILY_SENT_COUNT_PREFIX = 'lucy_daily_sent_count_';

export function getLucyConversationStorageKey(userId: string): string {
  return `${LUCY_CONVERSATION_ID_KEY_PREFIX}${userId}`;
}

function getChatSurfaceResetPendingKey(userId: string): string {
  return `${LUCY_CHAT_SURFACE_RESET_PENDING_PREFIX}${userId}`;
}

/** Après un reset mémoire serveur : l’écran Chat consomme ce fanion au focus pour vider l’UI (le Chat est souvent démonté pendant les Paramètres). */
export async function markPendingChatSurfaceReset(userId: string): Promise<void> {
  await AsyncStorage.setItem(getChatSurfaceResetPendingKey(userId), '1');
}

export async function consumePendingChatSurfaceReset(userId: string): Promise<boolean> {
  const key = getChatSurfaceResetPendingKey(userId);
  const v = await AsyncStorage.getItem(key);
  if (v !== '1') return false;
  await AsyncStorage.removeItem(key);
  return true;
}

export async function loadLucyConversationId(userId: string): Promise<string | null> {
  return AsyncStorage.getItem(getLucyConversationStorageKey(userId));
}

export async function saveLucyConversationId(userId: string, conversationId: string): Promise<void> {
  await AsyncStorage.setItem(getLucyConversationStorageKey(userId), conversationId);
}

export async function clearLucyConversationId(userId: string): Promise<void> {
  await AsyncStorage.removeItem(getLucyConversationStorageKey(userId));
}

const LUCY_PENDING_FIRST_MESSAGE_PREFIX = 'lucy_pending_first_message_';

function getPendingFirstMessageKey(userId: string): string {
  return `${LUCY_PENDING_FIRST_MESSAGE_PREFIX}${userId}`;
}

/** Message que la personne voulait envoyer quand le mur des échanges offerts est
    tombé (sixième envoi) : le Chat le consomme à l'ouverture suivante et le
    pré-remplit dans la barre. Un appui sur Envoyer, et Lucy répond. */
export async function savePendingLucyFirstMessage(userId: string, text: string): Promise<void> {
  await AsyncStorage.setItem(getPendingFirstMessageKey(userId), text);
}

export async function consumePendingLucyFirstMessage(userId: string): Promise<string | null> {
  const key = getPendingFirstMessageKey(userId);
  const value = await AsyncStorage.getItem(key);
  if (value == null) return null;
  await AsyncStorage.removeItem(key);
  return value;
}

function getLastMessageSentAtKey(userId: string): string {
  return `${LUCY_LAST_MESSAGE_SENT_AT_PREFIX}${userId}`;
}

/** Notification du soir : sert à savoir si l'utilisateur a déjà parlé à Lucy récemment. */
export async function saveLastMessageSentAt(userId: string, timestamp: number): Promise<void> {
  await AsyncStorage.setItem(getLastMessageSentAtKey(userId), String(timestamp));
}

export async function getLastMessageSentAt(userId: string): Promise<number | null> {
  const value = await AsyncStorage.getItem(getLastMessageSentAtKey(userId));
  return value ? parseInt(value, 10) : null;
}

function getDailySentCountKey(userId: string): string {
  return `${LUCY_DAILY_SENT_COUNT_PREFIX}${userId}`;
}

/**
 * Incrémente le nombre de messages envoyés aujourd'hui et renvoie le total.
 *
 * Le jour calendaire est celui du fuseau de la personne, calculé par l'appelant
 * — même convention que les entrées d'humeur. Changer de jour repart de 1 :
 * seul le volume d'une journée nous intéresse, et il n'y a donc rien à purger.
 *
 * Compté à la journée et non à la session : quelqu'un qui écrit huit messages
 * le matin et sept le soir a autant apprécié ses échanges que celui qui en
 * écrit quinze d'affilée.
 *
 * Renvoie `null` si le stockage est inaccessible — l'appelant doit alors ne
 * rien conclure plutôt que de supposer un compte bas.
 */
export async function bumpDailySentCount(userId: string, dateYmd: string): Promise<number | null> {
  const key = getDailySentCountKey(userId);
  try {
    const raw = await AsyncStorage.getItem(key);
    let count = 1;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.date === dateYmd && typeof parsed.count === 'number') {
        count = parsed.count + 1;
      }
    }
    await AsyncStorage.setItem(key, JSON.stringify({ date: dateYmd, count }));
    return count;
  } catch {
    return null;
  }
}
