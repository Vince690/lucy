import React from 'react';
import SingleChoiceQuiz from '@/components/onboarding/SingleChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const OPENNESS_KEYS = [
  'almost_too_easy',
  'easy',
  'right_people',
  'not_that_simple',
  'very_hard',
] as const;

export default function OpennessScreen() {
  return (
    <SingleChoiceQuiz
      step={ONBOARDING_STEPS.openness}
      quizKey="openness"
      answerKey="openness"
      optionKeys={OPENNESS_KEYS}
      nextRoute="/(onboarding)/goals"
    />
  );
}
