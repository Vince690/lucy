import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TextInput, KeyboardAvoidingView, Keyboard, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import QuestionHeader from '@/components/onboarding/QuestionHeader';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { getOAuthFirstName } from '@/utils/oauthName';
import { ONBOARDING_STEPS, ONBOARDING_TOTAL_STEPS } from '@/constants/onboardingFlow';
import { OnbColors, OnbRadius, OnbSpacing, OnbType } from '@/constants/onboardingTheme';
import { useQuizAnalytics } from '@/utils/onboardingAnalytics';

export default function NameScreen() {
  const router = useRouter();
  const { transition } = useLocalSearchParams();
  const { t } = useTranslation(['onboarding']);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { answers, setAnswer } = useOnboarding();
  const { trackCompleted } = useQuizAnalytics(ONBOARDING_STEPS.name, 'name', false);
  const [firstName, setFirstName] = useState(
    () => answers.firstName ?? getOAuthFirstName(user) ?? '',
  );
  const [focused, setFocused] = useState(false);
  // Voile orange laissé par la transition zoom du « C'est parti ? » : se dissipe au montage.
  const [veil, setVeil] = useState(transition === 'zoom');
  // Clavier déployé → le CTA se rapproche du clavier ; sinon il garde sa place habituelle.
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const handleContinue = () => {
    if (firstName.trim()) {
      trackCompleted(1);
      setAnswer('firstName', firstName.trim());
      router.push('/(onboarding)/date-of-birth');
    }
  };

  return (
    <View style={styles.container}>
      {/* Bord bas géré à la main (paddingBottom ci-dessous) : la safe area bottom de la
          SafeAreaView s'ajoutait au padding du CTA quand le clavier était déployé → trop d'espace. */}
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* offset 0 : la vue va jusqu'au bas de l'écran ; un offset la surélèverait
            d'autant au-dessus du clavier (c'était la cause du grand vide sous le CTA). */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
          keyboardVerticalOffset={0}
        >
          <QuestionHeader step={ONBOARDING_STEPS.name} total={ONBOARDING_TOTAL_STEPS} />

          <View style={styles.content}>
            <Animated.Text entering={FadeInDown.delay(200).duration(600)} style={styles.title}>
              {t('onboarding:name.title')}
            </Animated.Text>

            <Animated.View entering={FadeInDown.delay(400).duration(600)} style={styles.form}>
              <TextInput
                style={[styles.input, focused && styles.inputFocused]}
                placeholder={t('onboarding:name.firstNamePlaceholder')}
                placeholderTextColor={OnbColors.mutedLight}
                value={firstName}
                onChangeText={setFirstName}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
            </Animated.View>

            <View style={styles.spacer} />

            <Animated.View
              entering={FadeInDown.delay(550).duration(600)}
              style={{
                // Clavier déployé : quasi collé (8 pt de respiration). Sinon : position
                // habituelle, identique à avant (safe area + marge standard).
                paddingBottom: keyboardVisible
                  ? 15
                  : insets.bottom + Math.max(insets.bottom, OnbSpacing.screenBottom),
              }}
            >
              <OnboardingButton
                label={t('onboarding:continue')}
                onPress={handleContinue}
                disabled={!firstName.trim()}
              />
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {veil && (
        <Animated.View
          pointerEvents="none"
          exiting={FadeOut.duration(420)}
          style={styles.veil}
          onLayout={() => setTimeout(() => setVeil(false), 30)}
        />
      )}
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
  keyboardView: {
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
  input: {
    alignSelf: 'center',
    minWidth: 220,
    maxWidth: '100%',
    borderWidth: 1,
    borderColor: OnbColors.hairline,
    borderRadius: OnbRadius.pill,
    paddingHorizontal: 28,
    paddingVertical: 15,
    fontSize: 19,
    fontWeight: '600',
    color: OnbColors.ink,
    textAlign: 'center',
    backgroundColor: OnbColors.bg,
  },
  inputFocused: {
    borderColor: OnbColors.primary,
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OnbColors.primary,
  },
});
