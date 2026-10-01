import React from 'react';
import MultiChoiceQuiz from '@/components/onboarding/MultiChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

// Ordre choisi pour le pavage des rangées (largeurs mesurées) : les pilules courtes
// « Mieux dormir » + « Y voir plus clair » tiennent côte à côte.
//
// « Avoir quelqu'un à qui parler » a été retiré : il recouvrait « Me sentir moins
// seul », qui dit la même chose de façon plus précise, et faisait écho à « Juste
// parler » deux pilules plus loin.
const GOAL_KEYS = [
  'manage_stress',
  'sleep_better',
  'see_clearly',
  'understand_emotions',
  'feel_less_alone',
  'build_confidence',
  'just_talk',
] as const;

export default function GoalsScreen() {
  return (
    <MultiChoiceQuiz
      step={ONBOARDING_STEPS.goals}
      quizKey="goals"
      answerKey="goals"
      optionKeys={GOAL_KEYS}
      nextRoute="/(onboarding)/pride"
    />
  );
}
