import React from 'react';
import SingleChoiceQuiz from '@/components/onboarding/SingleChoiceQuiz';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';

const TALK_TO_KEYS = [
  'almost_anyone',
  'a_few_people',
  'my_partner',
  'my_family',
  'an_ai',
  'hardly_anyone',
  'keep_to_myself',
] as const;

export default function TalkToScreen() {
  return (
    <SingleChoiceQuiz
      step={ONBOARDING_STEPS.talkTo}
      quizKey="talkTo"
      answerKey="talkTo"
      optionKeys={TALK_TO_KEYS}
      nextRoute="/(onboarding)/openness"
    />
  );
}
