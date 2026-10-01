import React from 'react';
import SingleChoiceQuiz from '@/components/onboarding/SingleChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const ENERGY_KEYS = ['bursting', 'in_shape', 'average', 'bit_tired', 'rock_bottom'] as const;

export default function EnergyScreen() {
  return (
    <SingleChoiceQuiz
      step={ONBOARDING_STEPS.energy}
      quizKey="energy"
      answerKey="energy"
      optionKeys={ENERGY_KEYS}
      nextRoute="/(onboarding)/concerns"
    />
  );
}
