/**
 * Écriture de user_mood_stats pour la mémoire Lucy (plan §8.3, §III.3i).
 *
 * Rôle : synchroniser chaque enregistrement d'humeur (mood_entries)
 * dans user_mood_stats afin que loadMoodStats() côté backend puisse
 * calculer mood_today / rolling_avg_7 correctement.
 *
 * Timezone :
 *   mood_date doit refléter le jour LOCAL de l'utilisateur (§III.3i 2417–2431).
 *   Le backend lit profiles.timezone (chatContextService.loadUserTimezone)
 *   et utilise Intl.DateTimeFormat — on applique la même logique ici.
 *   Fallback : timezone appareil (Intl), puis UTC.
 *
 * Idempotence :
 *   upsert sur (user_id, mood_date) — plusieurs saves le même jour
 *   mettent à jour mood_score sans créer de doublon (§III.3i 2438–2462).
 *
 * Design :
 *   - RLS déjà active sur user_mood_stats (authenticated, user_id = auth.uid()).
 *   - Appel direct Supabase anon ; pas d'endpoint backend nécessaire.
 *   - Non-bloquant : l'appelant doit gérer .catch() pour ne pas bloquer l'UI.
 */

import { supabase } from './supabase';

// ============================================================================
// Helpers timezone
// ============================================================================

/**
 * Fuseau IANA pour l’app : profil (même source que loadUserTimezone côté backend),
 * puis appareil, puis UTC.
 */
export function resolveUserTimezoneFromProfile(
  profile: { timezone?: string } | null | undefined,
): string {
  const tz = profile?.timezone;
  if (typeof tz === 'string' && tz.trim().length > 0) return tz.trim();
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * YYYY-MM-DD pour un instant donné dans un fuseau IANA (aligné sur
 * backend chatContextUtils.getDateStringInTimezone).
 */
export function getLocalDateStringForDate(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (!year || !month || !day) throw new Error('invalid parts');
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * « Aujourd’hui » calendaire (YYYY-MM-DD) dans le fuseau utilisateur.
 */
export function getMoodDateInTimezone(timezone: string): string {
  return getLocalDateStringForDate(new Date(), timezone);
}

/**
 * Nombre de jours calendaires entre deux YYYY-MM-DD (a → b, peut être négatif).
 */
export function diffCalendarDaysYmd(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  const ta = Date.UTC(ya, ma - 1, da);
  const tb = Date.UTC(yb, mb - 1, db);
  return Math.round((tb - ta) / 86400000);
}

/**
 * Ajoute des jours calendaires à une date YYYY-MM-DD.
 *
 * Volontairement SANS fuseau — c'est une opération sur une étiquette de
 * calendrier, pas sur un instant. « Le lendemain du 3 septembre » est le
 * 4 septembre partout sur Terre. Même convention que diffCalendarDaysYmd
 * ci-dessus, qui fait déjà son calcul en UTC pur.
 *
 * L'implémentation précédente prenait MIDI UTC du jour de départ puis
 * reconvertissait le résultat vers le fuseau de la personne. C'est cette
 * reconversion qui cassait : à UTC+12 et au-delà (Nouvelle-Zélande, Fidji,
 * Kiribati, Samoa), midi UTC est déjà le lendemain en heure locale. « Hier »
 * y renvoyait donc AUJOURD'HUI, et « demain » sautait deux jours.
 *
 * Ce n'était pas un simple décalage d'un jour. computeStreak recule d'un jour
 * tant qu'il trouve une entrée : recevoir toujours la même date rendait sa
 * boucle infinie, et l'écran d'humeur gelait l'app dès son ouverture pour
 * quiconque vivait dans ces fuseaux.
 */
export function addCalendarDaysToYmd(startYmd: string, deltaDays: number): string {
  const [y, m, d] = startYmd.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86400000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ============================================================================
// Écriture dans user_mood_stats
// ============================================================================

/**
 * Upsert une entrée user_mood_stats pour la journée locale de l'utilisateur.
 *
 * @param userId    user_id (auth.uid())
 * @param moodScore Score 1–5 (même échelle que mood_entries.mood)
 * @param timezone  Fuseau IANA (ex. "Europe/Paris") — depuis profiles.timezone
 */
export async function upsertUserMoodStat(
  userId: string,
  moodScore: number,
  timezone: string,
): Promise<void> {
  const moodDate = getMoodDateInTimezone(timezone);

  const { error } = await supabase
    .from('user_mood_stats')
    .upsert(
      { user_id: userId, mood_score: moodScore, mood_date: moodDate },
      { onConflict: 'user_id,mood_date' },
    );

  if (error) {
    console.error('[lucyMoodStats] upsert user_mood_stats failed:', error.message);
  }
}
