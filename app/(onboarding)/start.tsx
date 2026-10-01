/**
 * Écran « C'est parti ? » — transition post-inscription, avant les questions.
 * Une seule question, en grand, centrée (appuyer sur « Oui » = répondre → engagement).
 * Fond mesh animé (signature de l'intro) + transition « zoom » : le disque orange naît
 * au centre du bouton et grossit très vite jusqu'à couvrir l'écran → on ENTRE activement.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import AuroraBackground from '@/components/onboarding/AuroraBackground';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { firstIncompleteRoute } from '@/constants/onboardingFlow';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';
import { track } from '@/utils/analytics';

const BUTTON_HEIGHT = 56;

export default function StartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [zooming, setZooming] = useState(false);
  const zoom = useSharedValue(0);

  // Le disque de zoom part du centre du bouton (bas d'écran) et doit couvrir tout
  // l'écran : échelle = 2 × distance jusqu'au coin le plus lointain / diamètre initial.
  const buttonCenterY = H - Math.max(insets.bottom, OnbSpacing.screenBottom) - BUTTON_HEIGHT / 2;
  const maxScale = (2 * Math.hypot(W / 2, buttonCenterY)) / BUTTON_HEIGHT + 0.5;

  const { answers } = useOnboarding();

  // Reprise : si l'app a été fermée en cours de parcours, on renvoie directement
  // à la première question sans réponse (réponses persistées dans AsyncStorage).
  const navigateNext = useCallback(() => {
    router.replace({
      pathname: firstIncompleteRoute(answers) as never,
      params: { transition: 'zoom' },
    });
  }, [router, answers]);

  const handleStart = () => {
    if (zooming) return;
    // `is_resume` sépare un vrai départ d'une reprise de parcours : les deux
    // n'ont pas le même taux d'achèvement et les mélanger fausserait l'entonnoir.
    const resumeRoute = firstIncompleteRoute(answers);
    track('onboarding_started', {
      is_resume: resumeRoute !== '/(onboarding)/name',
      resume_route: resumeRoute,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (reduced) {
      navigateNext();
      return;
    }
    setZooming(true);
    zoom.value = withTiming(1, { duration: 480, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(navigateNext)();
    });
  };

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + zoom.value * (maxScale - 1) }],
  }));

  return (
    <View style={styles.container}>
      <AuroraBackground />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Animated.Text entering={FadeInDown.delay(300).duration(700)} style={styles.title}>
            {t('onboarding:start.title')}
          </Animated.Text>
        </View>

        <Animated.View
          entering={FadeInDown.delay(850).duration(650)}
          style={[styles.footer, { paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }]}
        >
          <OnboardingButton label={t('onboarding:start.cta')} onPress={handleStart} />
        </Animated.View>
      </SafeAreaView>

      {/* Disque de zoom : centré sur le bouton, grossit jusqu'à couvrir l'écran. */}
      {zooming && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.zoomDisc,
            {
              left: W / 2 - BUTTON_HEIGHT / 2,
              top: buttonCenterY - BUTTON_HEIGHT / 2,
            },
            zoomStyle,
          ]}
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
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: OnbSpacing.screenX,
  },
  title: {
    ...OnbType.display,
    fontSize: 42,
    lineHeight: 50,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: OnbSpacing.screenX,
  },
  zoomDisc: {
    position: 'absolute',
    width: BUTTON_HEIGHT,
    height: BUTTON_HEIGHT,
    borderRadius: BUTTON_HEIGHT / 2,
    backgroundColor: OnbColors.primary,
  },
});
