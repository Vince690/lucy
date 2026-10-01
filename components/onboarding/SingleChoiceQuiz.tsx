/**
 * SingleChoiceQuiz — écran de quiz à choix unique, pilules en rangées centrées (flexWrap).
 * Chaque route du quiz n'est plus qu'un mince paramétrage de ce composant.
 */

import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import QuestionScreenLayout from '@/components/onboarding/QuestionScreenLayout';
import ChoicePill from '@/components/onboarding/ChoicePill';
import { useOnboarding, type OnboardingAnswers } from '@/contexts/OnboardingContext';
import { useOnboardingBack } from '@/utils/onboardingNav';
import { genderContext } from '@/utils/i18n';
import { useQuizAnalytics } from '@/utils/onboardingAnalytics';

/** Clés de réponse à valeur « choix unique » (string). */
type SingleChoiceKey = 'mood' | 'energy' | 'stress' | 'talkTo' | 'openness';

interface SingleChoiceQuizProps {
  step: number;
  /** Bloc de locales onboarding:quiz.<quizKey> (title + options.*) */
  quizKey: string;
  answerKey: SingleChoiceKey;
  optionKeys: readonly string[];
  nextRoute: string;
}

export default function SingleChoiceQuiz({
  step,
  quizKey,
  answerKey,
  optionKeys,
  nextRoute,
}: SingleChoiceQuizProps) {
  const router = useRouter();
  const { t } = useTranslation(['onboarding']);
  const { answers, setAnswer } = useOnboarding();
  const goBack = useOnboardingBack(step);
  const stored = answers[answerKey];
  const [selected, setSelected] = useState<string | null>(
    typeof stored === 'string' ? stored : null,
  );
  const gctx = genderContext(answers.gender);
  const { trackOption, trackCompleted } = useQuizAnalytics(step, quizKey, false);

  const handleContinue = () => {
    if (!selected) return;
    trackCompleted(1);
    setAnswer(answerKey as keyof OnboardingAnswers, selected as never);
    router.push(nextRoute as never);
  };

  return (
    <QuestionScreenLayout
      step={step}
      title={t(`onboarding:quiz.${quizKey}.title`, { context: gctx })}
      continueLabel={t('onboarding:continue')}
      continueDisabled={!selected}
      onContinue={handleContinue}
      onBack={goBack}
    >
      <View style={styles.pillsWrap}>
        {optionKeys.map((key, index) => (
          <ChoicePill
            key={key}
            label={t(`onboarding:quiz.${quizKey}.options.${key}`, { context: gctx })}
            selected={selected === key}
            onPress={() => {
              // `index + 1` : le rang lu par un humain dans le tableau *_KEYS,
              // pour que le classement des options se relise sans décalage.
              trackOption(key, index + 1, false, 1);
              setSelected(key);
            }}
          />
        ))}
      </View>
    </QuestionScreenLayout>
  );
}

const styles = StyleSheet.create({
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
});
