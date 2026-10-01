/**
 * Mesure du parcours d'onboarding.
 *
 * Regroupé ici plutôt que recopié dans chaque écran : les treize questions
 * passent par trois composants seulement (SingleChoiceQuiz, MultiChoiceQuiz,
 * et l'écran traits), et l'entonnoir n'a de sens que si les treize émettent
 * exactement les mêmes événements avec exactement les mêmes propriétés.
 *
 * Aucune réponse en clair ne sort : uniquement les CLÉS d'option telles
 * qu'elles sont déclarées dans les tableaux *_KEYS des écrans. Un libellé
 * traduit ne doit jamais être envoyé — il changerait à chaque retouche de
 * copie et rendrait toute comparaison dans le temps impossible.
 */

import { useCallback, useEffect, useRef } from 'react';
import { track } from '@/utils/analytics';

interface QuizAnalytics {
  /**
   * Un appui sur une pilule, sélection comme désélection.
   *
   * `position` est le rang de l'option dans la liste : sans lui, une option
   * jamais choisie serait condamnée à tort alors qu'elle est seulement en bas
   * d'un écran de quinze pilules.
   */
  trackOption: (
    optionKey: string,
    position: number,
    isDeselect: boolean,
    selectedCount: number,
  ) => void;
  /** La question est validée et l'on passe à la suivante. */
  trackCompleted: (selectedCount: number) => void;
}

export function useQuizAnalytics(
  step: number,
  stepName: string,
  isMulti: boolean,
): QuizAnalytics {
  // Chrono de l'écran : un temps anormalement long sur une question révèle une
  // hésitation, pas un abandon. Les deux se corrigent différemment.
  const startedAt = useRef(Date.now());
  const changes = useRef(0);

  useEffect(() => {
    startedAt.current = Date.now();
    changes.current = 0;
    track('onboarding_step_viewed', { step_index: step, step_name: stepName });
  }, [step, stepName]);

  const trackOption = useCallback<QuizAnalytics['trackOption']>(
    (optionKey, position, isDeselect, selectedCount) => {
      changes.current += 1;
      track('onboarding_option_selected', {
        question: stepName,
        option_key: optionKey,
        position,
        is_multi: isMulti,
        is_deselect: isDeselect,
        selected_count: selectedCount,
      });
    },
    [stepName, isMulti],
  );

  const trackCompleted = useCallback<QuizAnalytics['trackCompleted']>(
    (selectedCount) => {
      track('onboarding_step_completed', {
        step_index: step,
        step_name: stepName,
        time_on_screen_ms: Date.now() - startedAt.current,
        answer_changes: changes.current,
        selected_count: selectedCount,
      });
    },
    [step, stepName],
  );

  return { trackOption, trackCompleted };
}
