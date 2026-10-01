/**
 * Fonctions pures pour la sélection et le scoring de la mémoire (§7.1).
 *
 * Ce module est volontairement sans import Supabase pour rester testable
 * en isolation (pas de dépendance à SUPABASE_URL / variables d'env).
 */

// ============================================================================
// Scoring des traits (§III.3d 886–904)
// ============================================================================

/**
 * Calcule le recency_score selon l'ancienneté d'un trait (§III.3d 891–900).
 *   1.0 → ≤ 30 jours
 *   0.7 → 31–90 jours
 *   0.5 → > 90 jours
 */
export function computeRecencyScore(daysSince: number): number {
  if (daysSince <= 30) return 1.0;
  if (daysSince <= 90) return 0.7;
  return 0.5;
}

/**
 * Calcule le priority_score d'un trait (§III.3d 888).
 *   priority_score = 0.7 * strength + 0.3 * recency_score
 * Arrondi à 2 décimales pour stabilité des comparaisons.
 */
export function computeTraitPriorityScore(strength: number, daysSince: number): number {
  const recency = computeRecencyScore(daysSince);
  return Math.round((0.7 * strength + 0.3 * recency) * 100) / 100;
}

// ============================================================================
// Statistiques d'humeur (§III.3i 2470–2500)
// ============================================================================

/**
 * Calcule mood_today et rolling_avg_7 depuis des lignes user_mood_stats.
 *
 * Règles (§III.3i 2470–2500) :
 *   - mood_today  : score du jour exact (null si absent)
 *   - rolling_avg_7 : AVG sur les lignes disponibles, arrondi 1 décimale
 *                     (peut être < 7 jours si données insuffisantes)
 *
 * @param rows   Lignes { mood_date: 'YYYY-MM-DD', mood_score: number }
 * @param today  Date locale de l'utilisateur (YYYY-MM-DD)
 */
export function computeMoodStats(
  rows: { mood_date: string; mood_score: number }[],
  today: string
): { mood_today: number | null; rolling_avg_7: number | null } {
  const todayRow = rows.find((r) => r.mood_date === today);
  const mood_today: number | null = todayRow?.mood_score ?? null;

  let rolling_avg_7: number | null = null;
  if (rows.length > 0) {
    const sum = rows.reduce((acc, r) => acc + r.mood_score, 0);
    rolling_avg_7 = Math.round((sum / rows.length) * 10) / 10;
  }

  return { mood_today, rolling_avg_7 };
}

/**
 * Retourne une date locale (YYYY-MM-DD) dans un fuseau IANA donné.
 * Fallback sûr vers UTC si le fuseau est invalide.
 */
export function getDateStringInTimezone(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (!year || !month || !day) {
      throw new Error('invalid date parts');
    }
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

// ============================================================================
// Identité : âge calculé depuis la date de naissance du profil
// ============================================================================

/**
 * Âge entier à partir d'une date de naissance `YYYY-MM-DD` et de la date locale du jour
 * (`YYYY-MM-DD`, calculée dans le fuseau de l'utilisateur). Null si invalide ou aberrant.
 * Calculé à chaque appel : l'âge figé à l'onboarding ne suivait pas les anniversaires.
 */
export function computeAgeFromDateOfBirth(dateOfBirth: string, today: string): number | null {
  const dob = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const now = today.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dob || !now) return null;
  let age = Number(now[1]) - Number(dob[1]);
  const beforeBirthday =
    Number(now[2]) < Number(dob[2]) ||
    (Number(now[2]) === Number(dob[2]) && Number(now[3]) < Number(dob[3]));
  if (beforeBirthday) age -= 1;
  return age > 0 && age < 150 ? age : null;
}

/**
 * Genre du profil (`male` | `female` | `other` | `prefer_not_to_say`) rendu lisible pour le
 * LLM. `other` et `prefer_not_to_say` ne sont pas transmis : rien à dire dessus.
 */
export function formatGenderForPrompt(gender: string | null | undefined): string | null {
  if (gender === 'male') return 'man';
  if (gender === 'female') return 'woman';
  return null;
}

// ============================================================================
// Bloc « Right now » : date, heure locale, délai depuis le message précédent
// ============================================================================

/**
 * Date et heure locales lisibles, en anglais (langue du prompt), dans le fuseau donné.
 * Ex. "Saturday 5 September 2026, 14:32". Fallback UTC si le fuseau est invalide.
 */
export function formatLocalDateTime(date: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(date);
  }
}

/**
 * Phrase sur le délai écoulé depuis le message utilisateur précédent, ou null si :
 *   - moins d'une heure (conversation en cours, rien à signaler),
 *   - aucun message utilisateur antérieur,
 *   - horodatages illisibles.
 *
 * Le dernier message de `messages` est celui que l'utilisateur vient d'écrire ; on cherche
 * le message utilisateur qui le précède.
 */
export function describeGapSincePreviousUserMessage(
  messages: { role: 'user' | 'assistant'; created_at: string }[]
): string | null {
  if (messages.length < 2) return null;
  const last = messages[messages.length - 1];
  let previous: { created_at: string } | null = null;
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      previous = messages[i];
      break;
    }
  }
  if (!previous) return null;

  const lastMs = new Date(last.created_at).getTime();
  const prevMs = new Date(previous.created_at).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(prevMs)) return null;

  const minutes = Math.round((lastMs - prevMs) / 60_000);
  if (minutes < 60) return null;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Their previous message was about ${hours} hour${hours > 1 ? 's' : ''} ago.`;
  const days = Math.round(hours / 24);
  return `Their previous message was ${days} day${days > 1 ? 's' : ''} ago.`;
}
