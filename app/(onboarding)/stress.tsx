import React from 'react';
import SingleChoiceQuiz from '@/components/onboarding/SingleChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const STRESS_KEYS = ['enormously', 'quite_a_bit', 'okay', 'not_much', 'not_at_all'] as const;

export default function StressScreen() {
  return (
    <SingleChoiceQuiz
      step={ONBOARDING_STEPS.stress}
      quizKey="stress"
      answerKey="stress"
      optionKeys={STRESS_KEYS}
      nextRoute="/(onboarding)/talk-to"
    />
  );
}
