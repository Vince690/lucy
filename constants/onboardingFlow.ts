/**
 * Ordre et progression du parcours d'onboarding (identité + quiz introspectif).
 *
 * Source de vérité du fil de progression : chaque écran référence ONBOARDING_STEPS
 * pour son numéro d'étape, et ONBOARDING_TOTAL_STEPS pour le total.
 * `firstIncompleteRoute` permet de REPRENDRE le parcours là où il s'était arrêté
 * (réponses persistées dans AsyncStorage via OnboardingContext).
 */

import type { OnboardingAnswers } from '@/contexts/OnboardingContext';

export const ONBOARDING_STEPS = {
  name: 1,
  dateOfBirth: 2,
  gender: 3,
  traits: 4,
  mood: 5,
  energy: 6,
  concerns: 7,
  stress: 8,
  talkTo: 9,
  openness: 10,
  goals: 11,
  pride: 12,
  understood: 13,
} as const;

// L'ancien écran notifications (14) est sorti du fil : la permission se demande
// sur l'écran essai (rappel de fin d'essai). La complétion vit au bout du slider
// « faire connaissance » (meet → utils/onboardingCompletion.ts) : la personne entre
// ensuite dans la vraie app, le paywall n'arrive qu'au sixième envoi.
export const ONBOARDING_TOTAL_STEPS = 13;

/** Route de chaque étape — utilisé par le retour arrière quand la pile est vide (reprise). */
export const ONBOARDING_ROUTE_BY_STEP: Record<number, string> = {
  1: '/(onboarding)/name',
  2: '/(onboarding)/date-of-birth',
  3: '/(onboarding)/gender',
  4: '/(onboarding)/traits',
  5: '/(onboarding)/mood',
  6: '/(onboarding)/energy',
  7: '/(onboarding)/concerns',
  8: '/(onboarding)/stress',
  9: '/(onboarding)/talk-to',
  10: '/(onboarding)/openness',
  11: '/(onboarding)/goals',
  12: '/(onboarding)/pride',
  13: '/(onboarding)/understood',
};

/** Première question sans réponse — cible de la navigation depuis « C'est parti ? ». */
export function firstIncompleteRoute(a: OnboardingAnswers): string {
  if (!a.firstName) return '/(onboarding)/name';
  if (!a.dateOfBirth) return '/(onboarding)/date-of-birth';
  if (!a.gender) return '/(onboarding)/gender';
  if (!a.traits || a.traits.length < 3) return '/(onboarding)/traits';
  if (!a.mood) return '/(onboarding)/mood';
  if (!a.energy) return '/(onboarding)/energy';
  if (!a.concerns?.length) return '/(onboarding)/concerns';
  if (!a.stress) return '/(onboarding)/stress';
  if (!a.talkTo) return '/(onboarding)/talk-to';
  if (!a.openness) return '/(onboarding)/openness';
  if (!a.goals?.length) return '/(onboarding)/goals';
  if (!a.pride?.length) return '/(onboarding)/pride';
  if (!a.understood?.length) return '/(onboarding)/understood';
  // Quiz complet : rejouer l'analyse, le reveal, puis le slider qui ouvre l'app.
  return '/(onboarding)/analysis';
}
