/**
 * QuestionScreenLayout — gabarit commun des écrans questions (style « pièce calme » validé).
 *
 * Deux compositions :
 *  - standard : titre à position FIXE (OnbSpacing.questionTitleTop), réponse ancrée dessous
 *  - dense : titre haut (52) + zone de réponse centrée (écrans à beaucoup de choix)
 *
 * Gère aussi : chevron retour + fil de progression, CTA bas, lien « Passer » optionnel,
 * clavier (keyboardAware : CTA quasi collé au clavier déployé, comme l'écran prénom)
 * et le voile orange laissé par la transition zoom (param `transition=zoom`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import QuestionHeader from '@/components/onboarding/QuestionHeader';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { ONBOARDING_TOTAL_STEPS } from '@/constants/onboardingFlow';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';

interface QuestionScreenLayoutProps {
  step: number;
  title: string;
  subtitle?: string;
  /** Écran à beaucoup de choix : titre haut + réponses centrées. */
  dense?: boolean;
  /** Écran avec saisie texte : le CTA suit le clavier. */
  keyboardAware?: boolean;
  continueLabel: string;
  continueDisabled?: boolean;
  onContinue: () => void;
  /** Lien discret sous le CTA (questions passables). */
  skipLabel?: string;
  onSkip?: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}

export default function QuestionScreenLayout({
  step,
  title,
  subtitle,
  dense = false,
  keyboardAware = false,
  continueLabel,
  continueDisabled = false,
  onContinue,
  skipLabel,
  onSkip,
  onBack,
  children,
}: QuestionScreenLayoutProps) {
  const insets = useSafeAreaInsets();
  const { transition } = useLocalSearchParams();
  const [veil, setVeil] = useState(transition === 'zoom');
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Verrou anti « appuis en rafale » sur Continuer / Passer :
  //  - `fired` : une seule navigation par passage sur l'écran (le 2e appui pendant
  //    la transition retombe sur CET écran, encore visible, et repartait aussitôt) ;
  //  - `readyAt` : période de grâce à l'arrivée — un appui « fantôme » hérité de
  //    l'écran précédent ne peut pas déclencher un écran pré-rempli (reprise).
  // Réarmé à chaque focus (retour arrière compris).
  const navLock = useRef({ fired: false, readyAt: 0 });
  useFocusEffect(
    useCallback(() => {
      navLock.current = { fired: false, readyAt: Date.now() + 500 };
    }, []),
  );
  const guarded = (action?: () => void) => () => {
    if (!action) return;
    if (navLock.current.fired || Date.now() < navLock.current.readyAt) return;
    navLock.current.fired = true;
    action();
  };

  useEffect(() => {
    if (!keyboardAware) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboardAware]);

  const inner = (
    <>
      <QuestionHeader step={step} total={ONBOARDING_TOTAL_STEPS} onBack={onBack} />

      <View style={styles.content}>
        <Animated.View
          entering={FadeInDown.delay(200).duration(600)}
          style={[styles.header, dense ? styles.headerDense : styles.headerStandard]}
        >
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(400).duration(600)}
          style={dense ? styles.formDense : styles.formStandard}
        >
          {children}
        </Animated.View>

        {!dense && <View style={styles.spacer} />}

        <Animated.View
          entering={FadeInDown.delay(550).duration(600)}
          style={{
            paddingBottom:
              keyboardAware && keyboardVisible
                ? 8
                : insets.bottom + Math.max(insets.bottom, OnbSpacing.screenBottom),
          }}
        >
          <OnboardingButton
            label={continueLabel}
            onPress={guarded(onContinue)}
            disabled={continueDisabled}
          />
          {skipLabel && onSkip ? (
            <Pressable onPress={guarded(onSkip)} hitSlop={8} style={styles.skipBtn}>
              <Text style={styles.skipLabel}>{skipLabel}</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      {/* Bord bas géré à la main (paddingBottom du bloc CTA) : la safe area bottom de la
          SafeAreaView s'ajouterait au padding quand le clavier est déployé. */}
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {keyboardAware ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
            keyboardVerticalOffset={0}
          >
            {inner}
          </KeyboardAvoidingView>
        ) : (
          inner
        )}
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
  header: {
    gap: 10,
  },
  headerStandard: {
    marginTop: OnbSpacing.questionTitleTop,
  },
  headerDense: {
    marginTop: 52,
  },
  title: {
    ...OnbType.title,
    fontSize: 26,
    lineHeight: 33,
    color: OnbColors.ink,
    textAlign: 'center',
    // Pleine largeur : maximise ce qui tient par ligne (titres longs sur 2 lignes max,
    // vérifié par mesure SF Pro Bold 26 sur les titres du quiz).
  },
  subtitle: {
    ...OnbType.body,
    fontSize: 16,
    lineHeight: 23,
    color: OnbColors.muted,
    textAlign: 'center',
    paddingHorizontal: 34,
  },
  formStandard: {
    marginTop: OnbSpacing.questionAnswerGap,
  },
  formDense: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  spacer: {
    flex: 1,
  },
  skipBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 2,
  },
  skipLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: OnbColors.mutedLight,
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OnbColors.primary,
  },
});
