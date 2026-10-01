import React from 'react';
import MultiChoiceQuiz from '@/components/onboarding/MultiChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

// Ordre composé d'après les largeurs mesurées pour un pavage « faux aléatoire » :
// rangées de 2 et de 1 entremêlées (2-1-2-2-1-2-1-2-1-1), sans motif reconnaissable.
const PRIDE_KEYS = [
  'my_journey',
  'humor',
  'work_studies',
  'kindness',
  'creativity',
  'friendships',
  'courage',
  'overcoming_hardship',
  'my_family',
  'honesty',
  'caring_for_others',
  'curiosity',
  'perseverance',
  'personal_growth',
  'independence',
] as const;

export default function PrideScreen() {
  return (
    <MultiChoiceQuiz
      step={ONBOARDING_STEPS.pride}
      quizKey="pride"
      answerKey="pride"
      optionKeys={PRIDE_KEYS}
      maxSelections={5}
      nextRoute="/(onboarding)/understood"
    />
  );
}
