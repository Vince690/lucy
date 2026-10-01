import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Localization from 'expo-localization';
import Animated, { FadeInDown } from 'react-native-reanimated';
import QuestionHeader from '@/components/onboarding/QuestionHeader';
import ChoicePill from '@/components/onboarding/ChoicePill';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useOnboardingBack } from '@/utils/onboardingNav';
import { ONBOARDING_STEPS, ONBOARDING_TOTAL_STEPS } from '@/constants/onboardingFlow';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';
import { useQuizAnalytics } from '@/utils/onboardingAnalytics';

const GENDER_OPTIONS = ['male', 'female', 'other'];

export default function GenderScreen() {
  const router = useRouter();
  const { t } = useTranslation(['onboarding']);
  const insets = useSafeAreaInsets();
  const { answers, setAnswer } = useOnboarding();
  const { trackCompleted } = useQuizAnalytics(ONBOARDING_STEPS.gender, 'gender', false);
  const goBack = useOnboardingBack(ONBOARDING_STEPS.gender);
  const [selectedGender, setSelectedGender] = useState<string | null>(answers.gender ?? null);

  const handleContinue = () => {
    if (!selectedGender) return;
    trackCompleted(1);
    setAnswer('gender', selectedGender);
    // Fuseau horaire détecté silencieusement — l'écran dédié a été retiré du parcours.
    setAnswer('timezone', Localization.getCalendars()[0]?.timeZone || 'UTC');
    router.push('/(onboarding)/traits');
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <QuestionHeader
          step={ONBOARDING_STEPS.gender}
          total={ONBOARDING_TOTAL_STEPS}
          onBack={goBack}
        />

        <View style={styles.content}>
          <Animated.Text entering={FadeInDown.delay(200).duration(600)} style={styles.title}>
            {t('onboarding:gender.title')}
          </Animated.Text>

          <Animated.View entering={FadeInDown.delay(400).duration(600)} style={styles.form}>
            {GENDER_OPTIONS.map((option) => (
              <ChoicePill
                key={option}
                label={t(`onboarding:gender.options.${option}`)}
                selected={selectedGender === option}
                onPress={() => setSelectedGender(option)}
              />
            ))}
          </Animated.View>

          <View style={styles.spacer} />

          <Animated.View
            entering={FadeInDown.delay(550).duration(600)}
            style={{ paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }}
          >
            <OnboardingButton
              label={t('onboarding:continue')}
              onPress={handleContinue}
              disabled={!selectedGender}
            />
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OnbColors.bg,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: OnbSpacing.screenX,
  },
  title: {
    ...OnbType.title,
    fontSize: 26,
    lineHeight: 33,
    color: OnbColors.ink,
    textAlign: 'center',
    marginTop: OnbSpacing.questionTitleTop,
    // Pas de padding interne : le titre doit tenir sur UNE ligne (mesuré 304 pt / 342 dispo).
  },
  form: {
    marginTop: OnbSpacing.questionAnswerGap,
    gap: 14,
  },
  spacer: {
    flex: 1,
  },
});
