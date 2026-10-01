import React from 'react';
import MultiChoiceQuiz from '@/components/onboarding/MultiChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const CONCERN_KEYS = [
  'stress',
  'sleep',
  'future',
  'relationships',
  'loneliness',
  'self_confidence',
  'work_studies',
  'health',
  'finances',
  'nothing_special',
] as const;

export default function ConcernsScreen() {
  return (
    <MultiChoiceQuiz
      step={ONBOARDING_STEPS.concerns}
      quizKey="concerns"
      answerKey="concerns"
      optionKeys={CONCERN_KEYS}
      exclusiveKey="nothing_special"
      nextRoute="/(onboarding)/stress"
    />
  );
}
