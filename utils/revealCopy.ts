/**
 * Construction des phrases du reveal personnalisé (fin du quiz d'onboarding).
 *
 * Transforme les réponses (clés d'options) en lignes de texte où les éléments issus
 * des réponses de l'utilisateur sont marqués `highlight` (rendus en orange à l'écran).
 * Logique pure : les libellés viennent des locales `onboarding:reveal.*`.
 */

import type { OnboardingAnswers } from '@/contexts/OnboardingContext';

export interface RevealSegment {
  text: string;
  highlight: boolean;
}

export type RevealLine = RevealSegment[];

type Translate = (key: string, options?: Record<string, unknown>) => string;

// Clés couvertes par les locales reveal.* — toute autre valeur est ignorée proprement.
const REVEAL_CONCERNS = new Set([
  'stress',
  'sleep',
  'future',
  'relationships',
  'loneliness',
  'self_confidence',
  'work_studies',
  'health',
  'finances',
]);
const REVEAL_ENERGY = new Set(['bursting', 'in_shape', 'average', 'bit_tired', 'rock_bottom']);
const REVEAL_GOALS = new Set([
  'manage_stress',
  'sleep_better',
  'understand_emotions',
  'feel_less_alone',
  'build_confidence',
  'see_clearly',
  'someone_to_talk',
  'just_talk',
]);

/** Découpe un gabarit `… {{var}} …` en segments, les valeurs interpolées en highlight. */
export function interpolateSegments(
  template: string,
  vars: Record<string, string>,
): RevealLine {
  const out: RevealLine = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template))) {
    if (match.index > last) {
      out.push({ text: template.slice(last, match.index), highlight: false });
    }
    out.push({ text: vars[match[1]] ?? '', highlight: true });
    last = re.lastIndex;
  }
  if (last < template.length) {
    out.push({ text: template.slice(last), highlight: false });
  }
  return out;
}

/**
 * Les lignes du reveal, dans l'ordre d'affichage. Chaque donnée manquante ou d'un
 * format inattendu fait simplement sauter la ligne concernée — jamais de trou visible.
 */
export function buildRevealLines(answers: OnboardingAnswers, t: Translate): RevealLine[] {
  const lines: RevealLine[] = [];

  // Accord en genre (clés `_female` des locales) — masculin de principe sinon.
  const gctx = answers.gender === 'female' ? 'female' : undefined;

  // Ligne 1 — préoccupation principale (première cochée) + énergie.
  const concernKey = answers.concerns?.find((k) => REVEAL_CONCERNS.has(k));
  const energyKey =
    answers.energy && REVEAL_ENERGY.has(answers.energy) ? answers.energy : undefined;
  const concern = concernKey ? t(`onboarding:reveal.concerns.${concernKey}`) : undefined;
  const energy = energyKey ? t(`onboarding:reveal.energy.${energyKey}`) : undefined;

  if (concern && energy) {
    lines.push(interpolateSegments(t('onboarding:reveal.line1'), { concern, energy }));
  } else if (concern) {
    lines.push(interpolateSegments(t('onboarding:reveal.line1NoEnergy'), { concern }));
  } else if (energy) {
    // « Rien de spécial » coché : variante apaisée — le « rien » est lui aussi
    // mis en avant (c'est une réponse comprise, pas une absence de réponse).
    lines.push(
      interpolateSegments(t('onboarding:reveal.line1Calm'), {
        nothing: t('onboarding:reveal.nothing'),
        energy,
      }),
    );
  }

  // Ligne 2 — objectifs (les deux premiers cochés).
  const goalKeys = (answers.goals ?? []).filter((k) => REVEAL_GOALS.has(k)).slice(0, 2);
  if (goalKeys.length === 2) {
    lines.push(
      interpolateSegments(t('onboarding:reveal.line2Two'), {
        goal1: t(`onboarding:reveal.goals.${goalKeys[0]}`, { context: gctx }),
        goal2: t(`onboarding:reveal.goals.${goalKeys[1]}`, { context: gctx }),
      }),
    );
  } else if (goalKeys.length === 1) {
    lines.push(
      interpolateSegments(t('onboarding:reveal.line2'), {
        goal: t(`onboarding:reveal.goals.${goalKeys[0]}`, { context: gctx }),
      }),
    );
  }

  // Ligne 3 — la promesse produit, toujours présente.
  lines.push([{ text: t('onboarding:reveal.line3'), highlight: false }]);

  return lines;
}
