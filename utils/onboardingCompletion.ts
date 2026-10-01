/**
 * Complétion de l'onboarding — au bout du slider « faire connaissance » (meet).
 *
 * Jusqu'au 23 septembre 2026, cette étape vivait dans le paywall et n'avait lieu
 * qu'après un achat. Depuis le pré-essai, la personne entre dans la vraie app sans
 * payer : le profil est écrit ici, puis le chat s'ouvre. Le paywall, lui, ne fait
 * plus que vendre.
 *
 * Ce qui est écrit :
 *   - le profil : identité, fuseau, préférences de notification (selon la
 *     permission déjà accordée ou non), `onboarding_completed`, consentement, et
 *     les réponses du questionnaire (clés d'options uniquement) pour que Lucy les
 *     connaisse dès le premier message (bloc « What they told you when they
 *     signed up » côté serveur) ;
 *   - la mémoire de Lucy (user_identity, user_traits) ;
 *   - la mesure : propriétés de personne et événement `onboarding_completed`.
 *
 * Seule l'écriture du profil est critique : c'est elle qui ouvre l'app. Le reste
 * est borné dans le temps et ne bloque jamais.
 *
 * Tout part en même temps. Jusqu'au 25 septembre 2026, la mémoire de Lucy n'était
 * amorcée qu'une fois le profil écrit, et l'app attendait les deux : sur la 4G, une
 * à deux secondes de plein orange après la fin de l'animation, que Vincent a prises
 * pour un bug. Désormais la mémoire part avec le profil, et l'app s'ouvre dès que le
 * profil est écrit ; la mémoire finit en arrière-plan si elle traîne. Sans risque
 * pour le premier message : le prénom et le questionnaire, Lucy les lit dans le
 * profil, et ses quatre messages d'accueil prennent plusieurs secondes.
 */

import type { OnboardingAnswers } from '@/contexts/OnboardingContext';
import type { Profile } from '@/contexts/AuthContext';
import { getPermissionStatus } from '@/utils/notificationService';
import { initLucyMemoryFromOnboarding, parseUserGenderFromParam } from '@/utils/lucyMemoryOnboarding';
import { setPersonProperties, track } from '@/utils/analytics';

const PROFILE_UPDATE_TIMEOUT_MS = 20_000;
/**
 * Ce qu'on accorde encore à la mémoire de Lucy une fois le profil écrit. Au-delà,
 * l'app s'ouvre et l'amorçage continue en arrière-plan.
 */
const MEMORY_GRACE_MS = 600;

/** Borne une promesse sans timeout propre. Rejette au-delà du délai. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout après ${ms} ms`)), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Réponses du questionnaire telles qu'elles partent dans `profiles.onboarding_answers`.
 * Clés en snake_case (convention base), valeurs = clés d'options des locales. Jamais
 * de texte libre, jamais de prénom ni de date de naissance : ceux-là ont leurs
 * colonnes.
 */
export function onboardingAnswersForProfile(answers: OnboardingAnswers) {
  return {
    mood: answers.mood ?? null,
    energy: answers.energy ?? null,
    concerns: answers.concerns ?? [],
    stress: answers.stress ?? null,
    talk_to: answers.talkTo ?? null,
    openness: answers.openness ?? null,
    goals: answers.goals ?? [],
    pride: answers.pride ?? [],
    understood: answers.understood ?? [],
  };
}

export interface CompleteOnboardingParams {
  userId: string;
  answers: OnboardingAnswers;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
  /** Durée du parcours, pour la mesure (depuis « C'est parti ? » si connue). */
  durationMs?: number | null;
}

export type CompleteOnboardingResult = { ok: true } | { ok: false; reason: 'profile_update' };

export async function completeOnboarding({
  userId,
  answers,
  updateProfile,
  durationMs,
}: CompleteOnboardingParams): Promise<CompleteOnboardingResult> {
  // Mémoire Lucy (user_identity, user_traits) : indépendante du profil, elle part
  // tout de suite. Jamais rejetée : elle journalise ses propres échecs.
  const memoryReady = initLucyMemoryFromOnboarding({
    userId,
    firstName: answers.firstName ?? '',
    dateOfBirth: answers.dateOfBirth ?? '',
    gender: parseUserGenderFromParam(answers.gender),
    selectedTraits: answers.traits ?? [],
  }).catch((err) => {
    console.error('[onboarding] initLucyMemoryFromOnboarding error:', err);
  });

  const permission = await getPermissionStatus().catch(() => 'undetermined' as const);
  const notificationsGranted = permission === 'granted';

  // Étape critique : c'est cette écriture qui ouvre l'app. Un dépassement est
  // traité comme un échec, mais l'écriture a pu aboutir côté serveur — withTimeout
  // court une promesse, il n'annule rien. Rejouer le slider réécrit les mêmes
  // valeurs : c'est idempotent.
  let updateError: { message: string } | null = null;
  try {
    const { error } = await withTimeout(
      updateProfile({
        first_name: answers.firstName ?? '',
        date_of_birth: answers.dateOfBirth ?? '',
        gender: answers.gender ?? '',
        timezone: answers.timezone ?? 'UTC',
        notification_preferences: {
          enabled: notificationsGranted,
          daily_reminder: notificationsGranted,
          weekly_summary: notificationsGranted,
        },
        onboarding_completed: true,
        onboarding_answers: onboardingAnswersForProfile(answers),
        // Consentement recueilli à l'inscription (case sign-up / mention welcome) ;
        // on horodate ici sa confirmation, au moment où le compte devient actif.
        privacy_consent_given: true,
        privacy_consent_at: new Date().toISOString(),
      }),
      PROFILE_UPDATE_TIMEOUT_MS,
    );
    updateError = error;
  } catch (err) {
    updateError = { message: (err as Error)?.message ?? 'timeout' };
  }

  if (updateError) {
    track('onboarding_completion_failed', { reason: 'profile_update' });
    console.warn('[onboarding] updateProfile :', updateError.message);
    return { ok: false, reason: 'profile_update' };
  }

  // Parcours abouti. Le profil part sur la PERSONNE, et pas seulement sur
  // l'événement : c'est la seule façon de filtrer l'entonnoir du paywall — ou
  // n'importe quel événement ultérieur — par les réponses du quiz. Aucun texte
  // libre, aucun prénom, aucune date de naissance : uniquement des clés d'option
  // et des compteurs.
  setPersonProperties({
    traits: answers.traits ?? [],
    mood_at_signup: answers.mood ?? null,
    energy: answers.energy ?? null,
    stress: answers.stress ?? null,
    talk_to: answers.talkTo ?? null,
    openness: answers.openness ?? null,
    concerns: answers.concerns ?? [],
    goals: answers.goals ?? [],
    onboarding_completed_at: new Date().toISOString(),
  });

  // Depuis le 23 septembre 2026, « onboarding terminé » veut dire « entré dans
  // l'app », plus « a payé » : l'achat se lit dans paywall_purchase_succeeded.
  track('onboarding_completed', {
    duration_ms: durationMs ?? null,
    notifications_granted: notificationsGranted,
    traits: answers.traits ?? [],
    mood: answers.mood ?? null,
    energy: answers.energy ?? null,
    stress: answers.stress ?? null,
    talk_to: answers.talkTo ?? null,
    openness: answers.openness ?? null,
    concerns: answers.concerns ?? [],
    concerns_count: answers.concerns?.length ?? 0,
    goals: answers.goals ?? [],
    goals_count: answers.goals?.length ?? 0,
    pride_count: answers.pride?.length ?? 0,
    understood_count: answers.understood?.length ?? 0,
  });

  // La mémoire a couru pendant l'écriture du profil : dans le cas courant elle est
  // déjà finie. Sinon, quelques dixièmes, puis on ouvre sans elle.
  await withTimeout(memoryReady, MEMORY_GRACE_MS).catch(() => {});

  return { ok: true };
}
