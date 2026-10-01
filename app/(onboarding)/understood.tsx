import React from 'react';
import MultiChoiceQuiz from '@/components/onboarding/MultiChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const UNDERSTOOD_KEYS = [
  'my_sensitivity',
  'need_for_calm',
  'my_emotions',
  'life_choices',
  'need_for_independence',
  'my_past',
  'way_of_seeing',
  'my_silences',
] as const;

export default function UnderstoodScreen() {
  return (
    <MultiChoiceQuiz
      step={ONBOARDING_STEPS.understood}
      quizKey="understood"
      answerKey="understood"
      optionKeys={UNDERSTOOD_KEYS}
      nextRoute="/(onboarding)/analysis"
    />
  );
}
