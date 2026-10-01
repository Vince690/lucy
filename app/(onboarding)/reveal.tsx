/**
 * Reveal personnalisé — le retour sur investissement du quiz.
 *
 * « {{prénom}}, voici ce qu'on a compris. » puis les phrases construites depuis les
 * réponses (utils/revealCopy), les mots de l'utilisateur en orange. Révélation ligne
 * par ligne, lente ; le CTA n'apparaît qu'après la dernière ligne (on laisse le moment
 * de reconnaissance se produire). Pas de chrome : ni fil d'étapes, ni retour.
 */

import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { buildRevealLines } from '@/utils/revealCopy';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';
import { track } from '@/utils/analytics';

// Cadence de révélation (ms) — lente à dessein : chaque ligne doit être lue.
const TITLE_DELAY = 300;
const FIRST_LINE_DELAY = 1100;
const LINE_GAP = 850;

export default function RevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const { answers } = useOnboarding();
  const reduced = useReducedMotion();

  const lines = useMemo(() => buildRevealLines(answers, t), [answers, t]);
  const navigatedRef = useRef(false);

  const title = answers.firstName
    ? t('onboarding:reveal.title', { firstName: answers.firstName })
    : t('onboarding:reveal.titleNoName');

  const ctaDelay = FIRST_LINE_DELAY + lines.length * LINE_GAP + 500;
  const delayOf = (base: number) => (reduced ? 0 : base);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.body}>
            <Animated.Text
              entering={FadeInDown.delay(delayOf(TITLE_DELAY)).duration(700)}
              style={styles.title}
            >
              {title}
            </Animated.Text>

            <View style={styles.lines}>
              {lines.map((line, i) => (
                <Animated.Text
                  key={i}
                  entering={FadeInDown.delay(delayOf(FIRST_LINE_DELAY + i * LINE_GAP)).duration(
                    700,
                  )}
                  style={[styles.line, i === lines.length - 1 && styles.lastLine]}
                >
                  {line.map((segment, j) => (
                    <Text key={j} style={segment.highlight ? styles.highlight : undefined}>
                      {segment.text}
                    </Text>
                  ))}
                </Animated.Text>
              ))}
            </View>
          </View>

          <Animated.View
            entering={FadeInDown.delay(delayOf(ctaDelay)).duration(600)}
            style={{ paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }}
          >
            <OnboardingButton
              label={t('onboarding:continue')}
              onPress={() => {
                if (navigatedRef.current) return;
                navigatedRef.current = true;
                // `lines_count` décrit la longueur du portrait servi : c'est
                // la seule variable de ce que voit la personne, le contenu
                // étant construit depuis ses propres réponses. Aucun mot du
                // portrait n'est envoyé — il reprend ses phrases.
                track('reveal_continued', { lines_count: lines.length });
                router.push('/(onboarding)/meet');
              }}
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
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  title: {
    ...OnbType.title,
    fontSize: 27,
    lineHeight: 35,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  lines: {
    marginTop: 34,
    gap: 22,
    paddingHorizontal: 8,
  },
  line: {
    ...OnbType.body,
    fontSize: 18.5,
    lineHeight: 28,
    color: OnbColors.inkSoft,
    textAlign: 'center',
  },
  // Détachée du bloc : respiration avant la conclusion, transition vers le CTA.
  lastLine: {
    marginTop: 22,
    fontWeight: '600',
    color: OnbColors.ink,
  },
  highlight: {
    color: OnbColors.primary,
    fontWeight: '600',
  },
});
