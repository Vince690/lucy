import React from 'react';
import SingleChoiceQuiz from '@/components/onboarding/SingleChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const MOOD_KEYS = ['thriving', 'pretty_good', 'mixed', 'not_great', 'struggling'] as const;

export default function MoodScreen() {
  return (
    <SingleChoiceQuiz
      step={ONBOARDING_STEPS.mood}
      quizKey="mood"
      answerKey="mood"
      optionKeys={MOOD_KEYS}
      nextRoute="/(onboarding)/energy"
    />
  );
}
