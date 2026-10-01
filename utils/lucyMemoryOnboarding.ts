/**
 * Écriture de la mémoire Lucy lors de l'onboarding (plan §8.2).
 *
 * Écrit dans deux tables mémoire après la fin de l'onboarding :
 *   - user_identity : prénom, âge (calculé depuis date_of_birth), genre
 *   - user_traits : 3 traits sélectionnés par l'utilisateur, source='onboarding'
 *
 * Timezone : profiles.timezone est déjà persisté par updateProfile() dans AuthContext.
 * Le backend lit le timezone depuis profiles (chatContextService.loadUserTimezone),
 * pas depuis user_mood_stats (qui n'a pas de colonne timezone — §III.3i).
 * Aucune écriture supplémentaire n'est nécessaire côté app pour le timezone.
 *
 * Design :
 *   - Les erreurs DB sont loguées ; l’appelant peut await pour séquencer avec refreshProfile.
 *   - user_identity : upsert par user_id (idempotent).
 *   - user_traits onboarding : avant réécriture, DELETE des lignes source='onboarding' pour
 *     éviter d’accumuler 6+ traits si l’utilisateur change de triplet (re-onboarding).
 *   - Pas de logique LLM ici : la force initiale 0.7 est documentée comme valeur
 *     d'amorçage onboarding (§III.3d — déclaration directe utilisateur).
 */

import { supabase } from './supabase';

// ============================================================================
// Types
// ============================================================================

/** Liste fermée des trait_key (§III.3d). */
export const TRAIT_KEYS = [
  'anxious',
  'joyful',
  'hypersensitive',
  'confident',
  'insecure',
  'ambitious',
  'optimistic',
  'introverted',
  'extroverted',
  'calm',
] as const;

export type TraitKey = (typeof TRAIT_KEYS)[number];

/** Enums user_gender (§20260313160000_add_user_identity.sql). */
export type UserGender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

const TRAIT_KEY_SET = new Set<string>(TRAIT_KEYS);

/** Param URL `traits` (ex. "anxious,joyful,calm") → clés valides, ordre conservé, max 3. */
export function parseTraitsFromOnboardingParam(raw: string | undefined): TraitKey[] {
  if (!raw || typeof raw !== 'string') return [];
  const out: TraitKey[] = [];
  const seen = new Set<TraitKey>();
  for (const part of raw.split(',')) {
    const key = part.trim();
    if (!key || !TRAIT_KEY_SET.has(key)) continue;
    const tk = key as TraitKey;
    if (seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
    if (out.length >= 3) break;
  }
  return out;
}

/** Sécurise le genre depuis les params de navigation. */
export function parseUserGenderFromParam(raw: string | undefined): UserGender {
  if (raw === 'male' || raw === 'female' || raw === 'other' || raw === 'prefer_not_to_say') {
    return raw;
  }
  return 'prefer_not_to_say';
}

export interface OnboardingMemoryParams {
  userId: string;
  firstName: string;
  /** Format YYYY-MM-DD, produit par date.toISOString().split('T')[0] */
  dateOfBirth: string;
  gender: UserGender;
  /** Exactement 3 traits issus de TRAIT_KEYS */
  selectedTraits: TraitKey[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse YYYY-MM-DD en composantes calendaires (évite le piège UTC de `new Date("YYYY-MM-DD")`).
 */
function parseLocalDateParts(isoDate: string): { y: number; m0: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m0: mo - 1, d };
}

/** Âge entier à partir d'une date YYYY-MM-DD (calendrier local pour « aujourd’hui »). */
function computeAge(dateOfBirth: string): number | null {
  const parts = parseLocalDateParts(dateOfBirth);
  if (!parts) return null;
  const today = new Date();
  let age = today.getFullYear() - parts.y;
  if (
    today.getMonth() < parts.m0 ||
    (today.getMonth() === parts.m0 && today.getDate() < parts.d)
  ) {
    age--;
  }
  return age > 0 && age < 150 ? age : null;
}

// ============================================================================
// Fonction principale
// ============================================================================

/**
 * Initialise les tables mémoire Lucy à partir des données d'onboarding.
 * Appeler après updateProfile() (onboarding_completed = true).
 */
export async function initLucyMemoryFromOnboarding(
  params: OnboardingMemoryParams,
): Promise<void> {
  const { userId, firstName, dateOfBirth, gender, selectedTraits } = params;

  // --- 1. user_identity ---
  const age = computeAge(dateOfBirth);

  const { error: identityError } = await supabase
    .from('user_identity')
    .upsert(
      { user_id: userId, first_name: firstName, age, gender },
      { onConflict: 'user_id' },
    );

  if (identityError) {
    console.error('[lucyMemory] user_identity upsert failed:', identityError.message);
  }

  // --- 2. user_traits (amorçage §III.3d) — remplacer le triplet onboarding précédent (re-onboarding)
  const { error: deleteOnboardingTraitsError } = await supabase
    .from('user_traits')
    .delete()
    .eq('user_id', userId)
    .eq('source', 'onboarding');

  if (deleteOnboardingTraitsError) {
    console.error(
      '[lucyMemory] user_traits delete (onboarding) failed:',
      deleteOnboardingTraitsError.message,
    );
  }

  if (selectedTraits.length > 0) {
    const now = new Date().toISOString();
    const traitRows = selectedTraits.map((trait_key) => ({
      user_id: userId,
      trait_key,
      strength: 0.7,
      source: 'onboarding' as const,
      last_seen_at: now,
    }));

    const { error: traitsError } = await supabase
      .from('user_traits')
      .upsert(traitRows, { onConflict: 'user_id,trait_key' });

    if (traitsError) {
      console.error('[lucyMemory] user_traits upsert failed:', traitsError.message);
    }
  }
}
