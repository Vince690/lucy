/**
 * Demande de notation App Store — quand la poser, et surtout quand se taire.
 *
 * Deux mécanismes coexistent dans Lucy et ne doivent pas être confondus :
 *
 *   1. Le bouton « Évaluer l'application » des Réglages, qui ouvre l'App Store
 *      sur le formulaire d'avis (`app/(app)/settings.tsx`). Déclenché par la
 *      personne, sans quota, sans garde-fou.
 *   2. Ce module, qui déclenche l'alerte système à cinq étoiles. Apple ne
 *      l'affiche AU PLUS que trois fois par période glissante de 365 jours et
 *      par appareil, et ne dit jamais si elle s'est affichée.
 *
 * C'est cette opacité qui structure tout le fichier. Comme on ne peut rien
 * observer, on ne peut que se retenir : chaque appel est une cartouche tirée à
 * l'aveugle, et une cartouche tirée pendant un moment maussade est perdue deux
 * fois — l'occasion ET, si l'alerte s'affiche vraiment, une note basse.
 *
 * ATTENTION — notre compteur et celui d'Apple ne comptent pas la même chose :
 * le nôtre compte les APPELS, celui d'Apple les AFFICHAGES. Un appel qu'iOS
 * décide d'ignorer décrémente notre budget sans toucher au sien. Le nôtre est
 * donc toujours plus sévère que le sien, et c'est délibéré : l'espacement
 * minimum ci-dessous est le vrai garde-fou, le plafond annuel n'est qu'une
 * ceinture par-dessus les bretelles.
 *
 * Ce module n'est appelé nulle part pour l'instant : le branchement des
 * déclencheurs est un chantier séparé. Il attend un appelant qui lui fournira
 * l'ancienneté du compte et, le cas échéant, l'humeur du jour — deux choses que
 * seul l'écran appelant connaît.
 */

import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { track } from './analytics';

const ATTEMPTS_KEY = '@lucy/app_review_attempts';

/**
 * Dernière humeur saisie, avec son jour.
 *
 * Le module de notation possède son propre signal plutôt que d'aller le
 * chercher dans le mood tracker : c'est lui qui en a besoin, et l'inverse
 * créerait une dépendance de l'écran d'humeur vers la notation.
 *
 * Ce qui est en jeu : l'écran de chat ne connaît pas l'humeur du jour, et
 * quinze messages dans une journée peuvent tout aussi bien être une journée de
 * crise qu'une journée de plaisir. Sans cette valeur, le déclencheur du chat
 * serait le seul des trois à demander une note à l'aveugle.
 */
const TODAY_MOOD_KEY = '@lucy/app_review_today_mood';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Trois mois entre deux demandes. Apple autorise trois affichages par an :
 * quatre-vingt-dix jours d'écart répartissent naturellement le budget sur
 * l'année au lieu de le dépenser en une semaine faste.
 */
const MIN_DAYS_BETWEEN_ATTEMPTS = 90;

/** Le plafond d'Apple, retenu à l'identique côté app (voir l'avertissement en tête). */
const MAX_ATTEMPTS_PER_YEAR = 3;

/**
 * Une semaine de compte avant la première sollicitation. En dessous, la
 * personne n'a pas encore vécu assez de Lucy pour avoir un avis, et une note
 * donnée trop tôt est une note donnée sur l'onboarding.
 */
const MIN_ACCOUNT_AGE_DAYS = 7;

/**
 * Humeur 1 ou 2 sur l'échelle de cinq du mood tracker (😢 😕) : on ne demande
 * rien. C'est la garde la plus spécifique à Lucy et la plus importante —
 * réclamer une note à quelqu'un qui vient de dire qu'il va très mal serait la
 * faute la plus coûteuse que cette app puisse commettre.
 */
const LOW_MOOD_THRESHOLD = 2;

/**
 * D'où vient la demande.
 *
 * Les trois partagent une propriété : ils arrivent APRÈS quelque chose de
 * réussi, jamais à froid. Le partage du graphique, envisagé au départ, a été
 * écarté — presque personne n'appuie dessus. L'ouverture de l'app au bout de
 * trois jours consécutifs aussi : elle mesure l'habitude et non le
 * contentement, et interrompt avant le contenu au lieu de célébrer après.
 */
export type ReviewTrigger = 'mood_five' | 'mood_streak' | 'chat_daily_volume';

/**
 * Nombre de messages envoyés dans la journée à partir duquel on considère que
 * l'échange se passe bien. La frustration fait partir, elle ne fait pas écrire
 * quinze messages. Exporté pour que l'écran de chat compare au même nombre.
 */
export const CHAT_DAILY_MESSAGE_THRESHOLD = 15;

/**
 * Pourquoi on s'est tu. Cette liste est la seule chose observable du module :
 * l'alerte elle-même étant invisible, c'est par ces raisons qu'on saura si le
 * mécanisme vit ou s'il est silencieusement cassé. `unavailable` est
 * particulièrement à surveiller — c'est ce que renverra chaque build TestFlight.
 */
export type ReviewSkipReason =
  | 'platform'
  | 'app_not_active'
  | 'low_mood'
  | 'account_too_young'
  | 'invalid_account_date'
  | 'storage_error'
  | 'too_soon'
  | 'annual_cap'
  | 'unavailable'
  | 'request_failed';

export interface ReviewContext {
  /** `profile.created_at` (ISO). Absent : la garde d'ancienneté est ignorée. */
  accountCreatedAt?: string | null;
  /**
   * Humeur du jour sur 1–5, quand l'appelant la connaît — c'est le cas du mood
   * tracker, qui vient de la recevoir.
   */
  recentMood?: number | null;
  /**
   * « Aujourd'hui » (YYYY-MM-DD) dans le fuseau de la personne. Fourni par les
   * appelants qui NE connaissent pas l'humeur — l'écran de chat — pour que la
   * garde d'humeur puisse malgré tout s'appliquer, à partir de la valeur
   * mémorisée par `rememberTodayMood`. Sans lui, une humeur mémorisée serait
   * inutilisable : rien ne dirait si elle date d'aujourd'hui ou du mois dernier.
   */
  todayYmd?: string | null;
}

function skip(reason: ReviewSkipReason, trigger: ReviewTrigger): false {
  track('review_prompt_skipped', { trigger, reason });
  return false;
}

/**
 * Horodatages des demandes passées. `null` — et non un tableau vide — si le
 * stockage est illisible : l'appelant doit pouvoir distinguer les deux.
 */
async function readAttempts(): Promise<number[] | null> {
  try {
    const raw = await AsyncStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  } catch {
    // Stockage illisible ou JSON corrompu. On renvoie null plutôt qu'un tableau
    // vide : un tableau vide serait indistinguable d'un premier lancement et
    // rouvrirait le robinet à chaque appel.
    return null;
  }
}

/**
 * Mémorise l'humeur du jour pour les déclencheurs qui ne la connaissent pas.
 *
 * `dateYmd` est fourni par l'appelant et non calculé ici : le jour calendaire
 * dépend du fuseau de la personne (`getMoodDateInTimezone`), que ce module n'a
 * aucune raison de connaître.
 *
 * Silencieuse en cas d'échec : ne pas pouvoir mémoriser une humeur ne doit
 * jamais empêcher de l'enregistrer.
 */
export async function rememberTodayMood(mood: number, dateYmd: string): Promise<void> {
  try {
    await AsyncStorage.setItem(TODAY_MOOD_KEY, JSON.stringify({ date: dateYmd, mood }));
  } catch (e) {
    console.warn('[appReview] mémorisation de l’humeur du jour :', e);
  }
}

/** Humeur mémorisée, uniquement si elle porte bien sur le jour demandé. */
async function readTodayMood(todayYmd: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(TODAY_MOOD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.date !== todayYmd) return null;
    return typeof parsed.mood === 'number' ? parsed.mood : null;
  } catch {
    // Une humeur illisible ne bloque pas : on retombe simplement sur le cas
    // « humeur inconnue », qui laisse passer. C'est le comportement d'une
    // personne n'ayant rien saisi aujourd'hui, et il n'y a pas de raison de
    // traiter les deux différemment.
    return null;
  }
}

/**
 * Pose une demande de notation si toutes les conditions sont réunies.
 *
 * Renvoie `true` si l'alerte a été DEMANDÉE à iOS — jamais si elle s'est
 * affichée, et encore moins si quelqu'un a noté : cela, l'API ne le dit pas.
 */
export async function maybeRequestReview(
  trigger: ReviewTrigger,
  context: ReviewContext = {},
): Promise<boolean> {
  // Même raisonnement que `CAN_RATE_APP` dans les Réglages : Lucy n'est pas
  // encore sur le Play Store. `isAvailableAsync()` répondrait pourtant `true`
  // sur Android 5+, sans rien savoir de cela.
  if (Platform.OS !== 'ios') return skip('platform', trigger);

  // Une alerte demandée alors que l'app passe en arrière-plan est une cartouche
  // dépensée dans le vide. Même précaution que notificationService.ts.
  if (AppState.currentState !== 'active') return skip('app_not_active', trigger);

  const { accountCreatedAt, recentMood, todayYmd } = context;

  // L'humeur transmise prime sur la mémorisée : l'appelant qui la fournit vient
  // de la recevoir, elle est donc plus fraîche que ce qui est stocké.
  const mood =
    typeof recentMood === 'number' ? recentMood : todayYmd ? await readTodayMood(todayYmd) : null;

  if (typeof mood === 'number' && mood <= LOW_MOOD_THRESHOLD) {
    return skip('low_mood', trigger);
  }

  if (accountCreatedAt) {
    const createdAt = new Date(accountCreatedAt).getTime();
    // Une date illisible ne doit pas ouvrir la porte : on ne saute la garde que
    // si l'appelant n'a rien fourni du tout. Raison distincte de
    // `account_too_young` — une date cassée est un défaut de données, pas le
    // fonctionnement normal, et les confondre rendrait le bug invisible.
    if (!Number.isFinite(createdAt)) return skip('invalid_account_date', trigger);
    if (Date.now() - createdAt < MIN_ACCOUNT_AGE_DAYS * DAY_MS) {
      return skip('account_too_young', trigger);
    }
  }

  const attempts = await readAttempts();
  if (attempts === null) return skip('storage_error', trigger);

  const now = Date.now();

  const lastAttempt = attempts.length > 0 ? Math.max(...attempts) : null;
  if (lastAttempt !== null && now - lastAttempt < MIN_DAYS_BETWEEN_ATTEMPTS * DAY_MS) {
    return skip('too_soon', trigger);
  }

  // Fenêtre glissante, pas année civile : c'est ainsi qu'Apple compte.
  const withinYear = attempts.filter((t) => now - t < 365 * DAY_MS);
  if (withinYear.length >= MAX_ATTEMPTS_PER_YEAR) return skip('annual_cap', trigger);

  // Testé en dernier car c'est le seul appel natif de la chaîne : inutile de le
  // payer quand une garde locale a déjà tranché. Renvoie `false` en TestFlight.
  let available = false;
  try {
    available = await StoreReview.isAvailableAsync();
  } catch {
    available = false;
  }
  if (!available) return skip('unavailable', trigger);

  try {
    await StoreReview.requestReview();
  } catch (e) {
    console.warn('[appReview] requestReview :', e);
    return skip('request_failed', trigger);
  }

  // Enregistré seulement après un appel réussi, et volontairement AVANT de
  // savoir si l'alerte s'est affichée : c'est bien la tentative qu'on compte.
  // On ne garde que la fenêtre utile, la liste ne peut donc pas enfler.
  const kept = [...withinYear, now];
  try {
    await AsyncStorage.setItem(ATTEMPTS_KEY, JSON.stringify(kept));
  } catch (e) {
    // L'alerte est déjà partie : on ne peut plus la reprendre. Le pire cas est
    // une demande de trop au prochain déclencheur, qu'Apple absorbera de toute
    // façon avec son propre quota.
    console.warn('[appReview] enregistrement de la tentative :', e);
  }

  track('review_prompt_requested', {
    trigger,
    // Rang de CETTE demande dans la fenêtre glissante : 1, 2 ou 3. Nommé ainsi
    // plutôt qu'« attempts_in_year », qui se lirait comme un état d'avant.
    attempt_number_in_year: kept.length,
    days_since_last_attempt:
      lastAttempt !== null ? Math.round((now - lastAttempt) / DAY_MS) : null,
  });

  return true;
}

/**
 * Efface l'historique local des demandes.
 *
 * Pour le développement uniquement : sur simulateur l'alerte s'affiche à chaque
 * appel et sans quota, mais nos propres gardes, elles, continuent de s'appliquer.
 */
export async function resetReviewHistory(): Promise<void> {
  // Le garde rend vraie la phrase ci-dessus : en production, cette fonction ne
  // fait rien. Effacer le budget local d'un vrai utilisateur reviendrait à lui
  // reposer la question trois mois trop tôt.
  if (!__DEV__) return;
  try {
    await AsyncStorage.removeItem(ATTEMPTS_KEY);
  } catch (e) {
    console.warn('[appReview] réinitialisation de l’historique :', e);
  }
}
