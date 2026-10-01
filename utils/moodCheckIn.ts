/**
 * Humeur demandée dans le chat.
 *
 * À la première ouverture de la journée, si aucune humeur n'a encore été
 * enregistrée — et jamais le premier jour, voir hasUserMessageBefore() —,
 * Lucy envoie deux messages (un bonjour, puis la question) et le
 * fil affiche les cinq cartes. Un toucher enregistre l'humeur exactement comme
 * le ferait le mood tracker, puis part à Lucy comme un message ordinaire.
 *
 * Ce module ne connaît pas l'écran : il lit et écrit la base et le stockage
 * local, l'écran orchestre l'affichage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TFunction } from 'i18next';
import { supabase } from './supabase';
import { getLocalDateStringForDate, upsertUserMoodStat } from './lucyMoodStats';
import { rememberTodayMood } from './appReview';
import { track } from './analytics';

/**
 * La journée de Lucy commence à 6 h, heure locale : avant, on est encore dans
 * la soirée de la veille (celui qui parle à Lucy à 1 h du matin ne s'est pas
 * couché). Pas de bonjour ni de question avant cette heure. La date de
 * l'humeur, elle, reste la date du calendrier, comme dans le mood tracker.
 */
export const MOOD_CHECKIN_EARLIEST_HOUR = 6;

/** Heure (0–23) qu'il est en ce moment dans le fuseau donné. */
export function getHourInTimezone(timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
      .formatToParts(new Date())
      .find((p) => p.type === 'hour')?.value;
    const n = Number(hour);
    if (!Number.isFinite(n)) throw new Error('hour');
    return n % 24;
  } catch {
    return new Date().getHours();
  }
}

/**
 * Où en est la question du jour, mémorisé sur le téléphone :
 *   - `asking` : les messages sont en cours d'écriture (verrou court, contre un
 *     double montage de l'écran) ;
 *   - `asked`  : Lucy a posé la question, les cartes restent à montrer tant
 *     qu'aucune humeur n'est enregistrée — y compris après un redémarrage ;
 *   - `done`   : carte touchée, ou la personne a écrit autre chose.
 */
export type MoodCheckInStatus = 'asking' | 'asked' | 'done';
export interface MoodCheckInState {
  ymd: string;
  status: MoodCheckInStatus;
  /** Horodatage du verrou `asking`, pour l'ignorer s'il est resté posé. */
  at?: number;
}

const MOOD_CHECKIN_PREFIX = 'lucy_mood_checkin_';
/** Au-delà, un verrou `asking` est considéré comme abandonné (écriture interrompue). */
const ASKING_LOCK_MS = 20_000;

function checkInKey(userId: string): string {
  return `${MOOD_CHECKIN_PREFIX}${userId}`;
}

export async function readMoodCheckInState(userId: string, ymd: string): Promise<MoodCheckInState | null> {
  try {
    const raw = await AsyncStorage.getItem(checkInKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MoodCheckInState;
    if (parsed.ymd !== ymd) return null;
    if (parsed.status === 'asking' && Date.now() - (parsed.at ?? 0) > ASKING_LOCK_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeMoodCheckInState(userId: string, state: MoodCheckInState): Promise<void> {
  await AsyncStorage.setItem(checkInKey(userId), JSON.stringify(state));
}

export async function clearMoodCheckInState(userId: string): Promise<void> {
  await AsyncStorage.removeItem(checkInKey(userId));
}

/**
 * La personne a-t-elle déjà écrit à Lucy un jour AVANT celui-ci ?
 *
 * La question du jour commence par « te revoilà » : elle n'a de sens que pour
 * quelqu'un qui revient. Le premier jour — la rencontre, les premiers échanges
 * offerts — Lucy ne la pose jamais, même si la personne a déjà envoyé des
 * messages ce jour-là. Elle arrive le lendemain, ou le prochain jour où la
 * personne revient. Seuls comptent les messages écrits par la personne (role
 * `user`), donc passés par le serveur : les messages d'accueil de Lucy n'en
 * font pas partie.
 */
export async function hasUserMessageBefore(userId: string, ymd: string, timezone: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('messages')
    .select('created_at')
    .eq('user_id', userId)
    .eq('role', 'user')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  const first = data?.[0]?.created_at;
  if (!first) return false;
  return getLocalDateStringForDate(new Date(first), timezone) < ymd;
}

/** Une humeur existe-t-elle déjà pour ce jour (saisie dans le mood tracker, par exemple) ? */
export async function hasMoodEntryOn(userId: string, ymd: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('mood_entries')
    .select('date')
    .eq('user_id', userId)
    .eq('date', ymd)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export interface InsertedLucyMessage {
  id: string;
  content: string;
  created_at: string;
  msg_seq: number;
}

/**
 * Écrit des messages de Lucy directement en base, à la suite de la
 * conversation, comme le fait déjà la séquence de bienvenue : ils font partie
 * de l'historique et du contexte que Lucy relit ensuite. La numérotation est
 * réservée sur `conversations.next_msg_seq`, le backend continue après.
 */
export async function insertLucyMessages(
  userId: string,
  conversationId: string,
  contents: string[],
): Promise<InsertedLucyMessage[]> {
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('next_msg_seq')
    .eq('id', conversationId)
    .single();
  if (convError || !conv) throw convError ?? new Error('conversation introuvable');

  const start: number = conv.next_msg_seq;
  const { data: inserted, error: insertError } = await supabase
    .from('messages')
    .insert(
      contents.map((content, index) => ({
        conversation_id: conversationId,
        user_id: userId,
        role: 'assistant' as const,
        content,
        msg_seq: start + index,
      })),
    )
    // `msg_seq` doit figurer dans la sélection : sur une insertion, le tri ne
    // porte que sur les colonnes renvoyées, et l'ordonner sur une colonne absente
    // fait échouer toute la requête (la bienvenue le sélectionne, elle aussi).
    .select('id, content, created_at, msg_seq')
    .order('msg_seq', { ascending: true });
  if (insertError || !inserted) throw insertError ?? new Error('insertion impossible');

  const { error: updateError } = await supabase
    .from('conversations')
    .update({ next_msg_seq: start + contents.length })
    .eq('id', conversationId);
  if (updateError) throw updateError;

  return inserted as InsertedLucyMessage[];
}

/**
 * Le bonjour dépend de l'heure ; la question est tirée au sort dans une petite
 * banque. Les textes vivent dans `chat:moodCheckIn`.
 */
export function pickMoodCheckInTexts(t: TFunction, hour: number): [string, string] {
  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const greetings = t(`chat:moodCheckIn.greetings.${period}`, { returnObjects: true }) as string[];
  const questions = t('chat:moodCheckIn.questions', { returnObjects: true }) as string[];
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  return [pick(greetings), pick(questions)];
}

/**
 * Enregistre l'humeur du jour depuis le chat : même table, même mémoire Lucy,
 * même mémoire de notation que le mood tracker. Pas de mise à jour ici : la
 * carte n'est proposée que s'il n'y a encore rien pour aujourd'hui, et le
 * mood tracker garde sa règle d'une modification par jour.
 */
export async function saveMoodFromChat(
  userId: string,
  mood: number,
  ymd: string,
  timezone: string,
): Promise<void> {
  const { error } = await supabase
    .from('mood_entries')
    .insert([{ date: ymd, mood, modified: false, user_id: userId }]);
  if (error) throw error;

  track('mood_entry_saved', { mood_value: mood, source: 'chat' });
  upsertUserMoodStat(userId, mood, timezone).catch((e) => {
    console.error('[moodCheckIn] upsertUserMoodStat :', e);
  });
  rememberTodayMood(mood, ymd).catch(() => {});
}
