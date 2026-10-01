import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import QuestionScreenLayout from '@/components/onboarding/QuestionScreenLayout';
import ChoicePill from '@/components/onboarding/ChoicePill';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useOnboardingBack } from '@/utils/onboardingNav';
import { genderContext } from '@/utils/i18n';
import { TRAIT_KEYS, type TraitKey } from '@/utils/lucyMemoryOnboarding';
import { ONBOARDING_STEPS } from '@/constants/onboardingFlow';
import { OnbColors } from '@/constants/onboardingTheme';
import { useQuizAnalytics } from '@/utils/onboardingAnalytics';

const MAX_TRAITS = 3;

export default function TraitsScreen() {
  const router = useRouter();
  const { t } = useTranslation(['onboarding']);
  const { answers, setAnswer } = useOnboarding();
  const goBack = useOnboardingBack(ONBOARDING_STEPS.traits);
  const [selectedTraits, setSelectedTraits] = useState<TraitKey[]>(
    Array.isArray(answers.traits) ? answers.traits : [],
  );

  const { trackOption, trackCompleted } = useQuizAnalytics(
    ONBOARDING_STEPS.traits,
    'traits',
    true,
  );

  // Prochain état calculé hors de l'updater : React peut rejouer un updater,
  // et l'événement partirait alors en double.
  const toggleTrait = (trait: TraitKey, position: number) => {
    const wasSelected = selectedTraits.includes(trait);
    let next: TraitKey[];
    if (wasSelected) {
      next = selectedTraits.filter((t) => t !== trait);
    } else if (selectedTraits.length >= MAX_TRAITS) {
      // Pilule grisée : aucun choix n'est fait, rien à mesurer.
      return;
    } else {
      next = [...selectedTraits, trait];
    }
    trackOption(trait, position, wasSelected, next.length);
    setSelectedTraits(next);
  };

  const handleContinue = () => {
    trackCompleted(selectedTraits.length);
    setAnswer('traits', selectedTraits);
    router.push('/(onboarding)/mood');
  };

  return (
    <QuestionScreenLayout
      step={ONBOARDING_STEPS.traits}
      title={t('onboarding:traits.title')}
      subtitle={t('onboarding:traits.subtitle')}
      dense
      continueLabel={t('onboarding:continue')}
      continueDisabled={selectedTraits.length !== MAX_TRAITS}
      onContinue={handleContinue}
      onBack={goBack}
    >
      <View style={styles.pillsWrap}>
        {TRAIT_KEYS.map((trait, index) => {
          const isSelected = selectedTraits.includes(trait);
          const isDisabled = !isSelected && selectedTraits.length >= MAX_TRAITS;
          return (
            <ChoicePill
              key={trait}
              label={t(`onboarding:traits.keys.${trait}`, {
                context: genderContext(answers.gender),
              })}
              selected={isSelected}
              disabled={isDisabled}
              onPress={() => toggleTrait(trait, index + 1)}
            />
          );
        })}
      </View>
      <Text style={styles.counter}>
        {t('onboarding:traits.selectCount', { count: selectedTraits.length })}
      </Text>
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
  counter: {
    marginTop: 22,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: OnbColors.mutedLight,
    textAlign: 'center',
  },
});
