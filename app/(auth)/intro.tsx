import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  withTiming,
  cancelAnimation,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import AuroraBackground from '@/components/onboarding/AuroraBackground';
import TypewriteText from '@/components/onboarding/TypewriteText';
import StoriesProgress from '@/components/onboarding/StoriesProgress';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';

const SLIDES: { key: string; autoAdvanceMs: number | null }[] = [
  { key: 'hook', autoAdvanceMs: 6000 },
  { key: 'promise', autoAdvanceMs: 4400 },
  { key: 'promise2', autoAdvanceMs: 6500 },
  { key: 'science', autoAdvanceMs: null },
];

export default function IntroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const [index, setIndex] = useState(0);
  const progress = useSharedValue(0);

  const goToWelcome = useCallback(() => {
    router.replace('/(auth)/welcome');
  }, [router]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= SLIDES.length) {
        goToWelcome();
        return;
      }
      setIndex(next);
    },
    [goToWelcome],
  );

  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    const slide = SLIDES[index];
    if (slide.autoAdvanceMs) {
      progress.value = withTiming(
        1,
        { duration: slide.autoAdvanceMs, easing: Easing.linear },
        (finished) => {
          if (finished) runOnJS(goTo)(index + 1);
        },
      );
    } else {
      progress.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.ease) });
    }
    return () => cancelAnimation(progress);
  }, [index, goTo, progress]);

  // Slides 0-2 : tap droite = suivant. Écran 4 (science) : tap droite inerte
  // (avance uniquement via Continuer). Tap gauche = retour partout.
  const canAdvanceByTap = SLIDES[index].autoAdvanceMs !== null;

  return (
    <View style={styles.container}>
      <AuroraBackground />

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.tapRow}>
          <Pressable style={styles.tapLeft} onPress={() => goTo(index - 1)} />
          <Pressable
            style={styles.tapRight}
            onPress={() => {
              if (canAdvanceByTap) goTo(index + 1);
            }}
          />
        </View>
      </View>

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={styles.progressWrap} pointerEvents="none">
            <StoriesProgress total={SLIDES.length} index={index} progress={progress} />
          </View>
          <Pressable hitSlop={10} onPress={goToWelcome}>
            <Text style={styles.signIn}>{t('onboarding:intro.signIn')}</Text>
          </Pressable>
        </View>

        <View style={styles.body} pointerEvents="box-none">
          {index === 0 && <HookSlide t={t} />}
          {index === 1 && <PromiseSlide t={t} />}
          {index === 2 && <Promise2Slide t={t} />}
          {index === 3 && <ScienceSlide t={t} insets={insets} onContinue={goToWelcome} />}
        </View>
      </SafeAreaView>
    </View>
  );
}

function HookSlide({ t }: { t: TFunction }) {
  return (
    <View style={styles.centerSlide} pointerEvents="none">
      <TypewriteText text={t('onboarding:intro.hook')} style={styles.heroQuote} startDelay={300} />
      <Animated.Text entering={FadeIn.delay(2600).duration(700)} style={styles.hookAuthor}>
        {t('onboarding:intro.hookAuthor')}
      </Animated.Text>
    </View>
  );
}

function PromiseSlide({ t }: { t: TFunction }) {
  return (
    <View style={styles.centerSlide} pointerEvents="none">
      <TypewriteText text={t('onboarding:intro.promiseTitle')} style={styles.hero} startDelay={260} />
    </View>
  );
}

function Promise2Slide({ t }: { t: TFunction }) {
  return (
    <View style={styles.linesSlide} pointerEvents="none">
      {/* « Meet Lucy. » ouvre l'écran : sa taille le détache des trois lignes
          qui suivent, lesquelles gardent heroSmall. */}
      <View style={styles.lineBreakAfter}>
        <TypewriteText text={t('onboarding:intro.promise2Line0')} style={styles.heroLead} startDelay={260} />
      </View>
      <TypewriteText text={t('onboarding:intro.promise2Line1')} style={styles.heroSmall} startDelay={1150} />
      <TypewriteText text={t('onboarding:intro.promise2Line2')} style={styles.heroSmall} startDelay={1850} />
      <TypewriteText text={t('onboarding:intro.promise2Line3')} style={styles.heroSmall} startDelay={3050} />
    </View>
  );
}

// Chaque affirmation est créditée par le nom de l'institution en texte brut — jamais
// par un logo : un logo officiel laisse entendre un partenariat qui n'existe pas
// (marque déposée + App Store 5.2.1). Un crédit vide n'affiche rien.
const SCIENCE_FACTS = [
  { fact: 'science.fact2', source: 'science.source2' },
  { fact: 'science.fact1', source: 'science.source1' },
  { fact: 'science.fact3', source: 'science.source3' },
] as const;

function ScienceSlide({
  t,
  insets,
  onContinue,
}: {
  t: TFunction;
  insets: EdgeInsets;
  onContinue: () => void;
}) {
  return (
    <View style={styles.scienceSlide} pointerEvents="box-none">
      <View style={styles.scienceContent} pointerEvents="none">
        <Animated.View entering={FadeInDown.delay(150).duration(600)} style={styles.titleWrap}>
          <Text style={styles.scienceTitle}>{t('onboarding:intro.science.title')}</Text>
          <View style={styles.titleAccent} />
        </Animated.View>

        <View style={styles.factsList}>
          {SCIENCE_FACTS.map((item, i) => {
            // returnEmptyString est à false : une citation vide fait renvoyer la clé
            // elle-même par t(). On l'écarte pour ne jamais afficher « science.sourceN ».
            const raw = t(`onboarding:intro.${item.source}`);
            const source = raw && !raw.includes('science.source') ? raw : '';
            return (
              <React.Fragment key={item.fact}>
                {i > 0 && (
                  <Animated.View
                    entering={FadeIn.delay(420 + i * 180).duration(560)}
                    style={styles.factDivider}
                  />
                )}
                <Animated.View
                  entering={FadeInDown.delay(360 + i * 180).duration(560)}
                  style={styles.factBlock}
                >
                  <Text style={styles.factText}>{t(`onboarding:intro.${item.fact}`)}</Text>
                  {source ? (
                    <Animated.Text
                      entering={FadeIn.delay(620 + i * 180).duration(620)}
                      style={styles.factSource}
                    >
                      {source}
                    </Animated.Text>
                  ) : null}
                </Animated.View>
              </React.Fragment>
            );
          })}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }]}>
        <OnboardingButton label={t('onboarding:continue')} onPress={onContinue} />
      </View>
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
  tapRow: {
    flex: 1,
    flexDirection: 'row',
  },
  tapLeft: {
    width: '32%',
  },
  tapRight: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: OnbSpacing.screenX,
    paddingTop: OnbSpacing.screenTop,
  },
  progressWrap: {
    flex: 1,
  },
  signIn: {
    fontSize: 14,
    fontWeight: '600',
    color: OnbColors.muted,
  },
  body: {
    flex: 1,
  },
  centerSlide: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: OnbSpacing.screenX + 4,
  },
  hero: {
    ...OnbType.display,
    fontSize: 29,
    lineHeight: 40,
    color: OnbColors.ink,
  },
  heroQuote: {
    ...OnbType.display,
    fontSize: 29,
    lineHeight: 40,
    color: OnbColors.ink,
  },
  hookAuthor: {
    marginTop: 22,
    fontSize: 15,
    fontWeight: '600',
    color: OnbColors.primary,
  },
  heroSmall: {
    ...OnbType.title,
    fontSize: 26,
    lineHeight: 35,
    color: OnbColors.ink,
  },
  /** Première ligne de l'écran 3 (« Meet Lucy. »), à la taille de heroQuote. */
  heroLead: {
    ...OnbType.title,
    fontSize: 29,
    lineHeight: 38,
    color: OnbColors.ink,
  },
  linesSlide: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: OnbSpacing.screenX + 4,
    gap: 6,
  },
  lineBreakAfter: {
    marginBottom: 20,
  },
  scienceSlide: {
    flex: 1,
  },
  scienceContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: OnbSpacing.screenX + 6,
    paddingBottom: 44,
  },
  titleWrap: {
    alignItems: 'center',
    gap: 12,
  },
  // Aligné sur `heroQuote` (29) : les quatre écrans de l'intro se lisent comme
  // une même suite, et un titre plus petit faisait décrocher le dernier.
  scienceTitle: {
    ...OnbType.title,
    fontSize: 29,
    lineHeight: 36,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  titleAccent: {
    width: 30,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: OnbColors.primary,
  },
  factsList: {
    marginTop: 36,
    gap: 26,
  },
  factBlock: {
    alignItems: 'center',
    gap: 10,
  },
  factDivider: {
    alignSelf: 'center',
    width: 44,
    height: StyleSheet.hairlineWidth,
    backgroundColor: OnbColors.hairline,
  },
  factText: {
    ...OnbType.body,
    fontSize: 18.5,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: OnbColors.ink,
    textAlign: 'center',
  },
  // Crédit éditorial : petites capitales espacées. La hiérarchie repose sur la
  // taille (10.5 contre 18.5) ; la couleur ne fait que la confirmer d'un cran.
  // #353B47 = l'encre à ~85 % sur fond clair : assez pour détacher la source de
  // l'affirmation, trop peu pour se lire comme un gris — un vrai gris jurerait
  // avec l'orange de la marque.
  // Valeur figée plutôt qu'`opacity` : le FadeIn d'entrée anime l'opacité
  // jusqu'à 1 et écraserait le réglage en fin d'animation.
  factSource: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: '#353B47',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: OnbSpacing.screenX,
    paddingTop: 8,
  },
});
