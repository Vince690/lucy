import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import QuestionHeader from '@/components/onboarding/QuestionHeader';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useOnboardingBack } from '@/utils/onboardingNav';
import { ONBOARDING_STEPS, ONBOARDING_TOTAL_STEPS } from '@/constants/onboardingFlow';
import { OnbColors, OnbRadius, OnbSpacing, OnbType } from '@/constants/onboardingTheme';
import { useQuizAnalytics } from '@/utils/onboardingAnalytics';

// Doit rester cohérent avec la classification d'âge déclarée dans App Store
// Connect (18+) et avec les CGU / la politique de confidentialité.
const MIN_AGE = 18;

/** Relit une date YYYY-MM-DD du contexte (reprise de parcours), sinon défaut. */
function parseStoredDate(iso: string | undefined): Date {
  if (iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(2000, 0, 1);
}

function computeAge(dateOfBirth: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dateOfBirth.getFullYear();
  const beforeBirthday =
    now.getMonth() < dateOfBirth.getMonth() ||
    (now.getMonth() === dateOfBirth.getMonth() && now.getDate() < dateOfBirth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export default function DateOfBirthScreen() {
  const router = useRouter();
  const { t } = useTranslation(['onboarding']);
  const insets = useSafeAreaInsets();
  const { answers, setAnswer } = useOnboarding();
  const { trackCompleted } = useQuizAnalytics(ONBOARDING_STEPS.dateOfBirth, 'dateOfBirth', false);
  const goBack = useOnboardingBack(ONBOARDING_STEPS.dateOfBirth);
  const [date, setDate] = useState(() => parseStoredDate(answers.dateOfBirth));
  const [show, setShow] = useState(Platform.OS === 'ios');
  const [gated, setGated] = useState(false);

  const onChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShow(false);
    }
    if (selectedDate) {
      setDate(selectedDate);
    }
  };

  const handleContinue = () => {
    if (computeAge(date) < MIN_AGE) {
      setGated(true);
      return;
    }
    trackCompleted(1);
    setAnswer('dateOfBirth', date.toISOString().split('T')[0]);
    router.push('/(onboarding)/gender');
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (gated) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.gateContent}>
            <Animated.View entering={FadeIn.duration(500)} style={styles.gateBody}>
              <Text style={styles.gateTitle}>{t('onboarding:dateOfBirth.gate.title')}</Text>
              <Text style={styles.gateText}>{t('onboarding:dateOfBirth.gate.body')}</Text>
            </Animated.View>
            <View style={{ paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }}>
              <OnboardingButton
                label={t('onboarding:dateOfBirth.gate.edit')}
                variant="ghost"
                onPress={() => setGated(false)}
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <QuestionHeader
          step={ONBOARDING_STEPS.dateOfBirth}
          total={ONBOARDING_TOTAL_STEPS}
          onBack={goBack}
        />

        <View style={styles.content}>
          <Animated.Text entering={FadeInDown.delay(200).duration(600)} style={styles.title}>
            {t('onboarding:dateOfBirth.title')}
          </Animated.Text>

          <Animated.View entering={FadeInDown.delay(400).duration(600)} style={styles.form}>
            {Platform.OS === 'android' && !show && (
              <Pressable style={styles.dateButton} onPress={() => setShow(true)}>
                <Text style={styles.dateButtonText}>{formatDate(date)}</Text>
              </Pressable>
            )}

            {show && (
              <DateTimePicker
                value={date}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onChange}
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
              />
            )}
          </Animated.View>

          <View style={styles.spacer} />

          <Animated.View
            entering={FadeInDown.delay(550).duration(600)}
            style={{ paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }}
          >
            <OnboardingButton label={t('onboarding:continue')} onPress={handleContinue} />
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
    paddingHorizontal: 30,
  },
  form: {
    marginTop: OnbSpacing.questionAnswerGap,
  },
  spacer: {
    flex: 1,
  },
  dateButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: OnbColors.hairline,
    borderRadius: OnbRadius.pill,
    paddingHorizontal: 26,
    paddingVertical: 14,
    backgroundColor: OnbColors.bg,
  },
  dateButtonText: {
    fontSize: 17,
    color: OnbColors.ink,
    fontWeight: '600',
  },
  gateContent: {
    flex: 1,
    paddingHorizontal: OnbSpacing.screenX + 4,
  },
  gateBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
  },
  gateTitle: {
    ...OnbType.title,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  gateText: {
    ...OnbType.body,
    color: OnbColors.muted,
    textAlign: 'center',
  },
});
