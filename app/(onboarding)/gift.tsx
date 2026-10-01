/**
 * « Ta première semaine, c'est moi qui te l'offre. » — le pont entre l'affect et l'argent.
 *
 * Au sixième envoi dans le vrai chat (les cinq échanges offerts sont épuisés, voir
 * constants/chatGate.ts), Lucy formule l'essai comme un cadeau : la phrase
 * implique qu'il y a un prix sans jamais le dire, et le dit comme une générosité
 * (cadre « Your first week's on us », AllTrails). Deux lignes révélées lentement
 * (cadence du reveal), l'aura vivante au-dessus, un seul bouton : « Merci Lucy ! »
 * — la réciprocité s'installe avant même de voir le paywall.
 *
 * On arrive SOUS le voile orange du zoom parti du bouton Envoyer (dissolution 420 ms).
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withDelay,
  withTiming,
  Easing,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import AmbientAura from '@/components/onboarding/AmbientAura';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import { useAuth } from '@/contexts/AuthContext';
import { attachWallPatchSink } from '@/utils/chatWallHandoff';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';

// Cadence : mêmes respirations que le reveal — chaque ligne doit être lue.
const LINE1_DELAY = 500;
const LINE2_DELAY = 1900;
const CTA_DELAY = 3100;

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Le coup de crayon déborde un peu du mot, comme un vrai trait à main levée. */
const STROKE_OVERHANG = 5;
/** Le trait se dessine une fois la phrase lue, juste avant le CTA. */
const STROKE_DELAY = LINE2_DELAY + 1000;

/**
 * La phrase du cadeau, avec le mot clé (balisé `__mot__` dans la traduction)
 * souligné d'un coup de crayon : un trait SVG légèrement ondulé qui se dessine
 * de gauche à droite. La phrase est rendue mot à mot (ligne à retour automatique
 * centrée) pour pouvoir positionner le trait sous le mot exact.
 */
function GiftLine2({ text, reduced }: { text: string; reduced: boolean }) {
  const [wordBox, setWordBox] = useState<{ x: number; width: number } | null>(null);

  const draw = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    // Coup vif : le trait part vite et s'arrête net, comme un geste décidé.
    draw.value = withDelay(
      STROKE_DELAY,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }),
    );
  }, [reduced, draw]);

  const w = (wordBox?.width ?? 0) + STROKE_OVERHANG * 2;
  // Légère surestimation de la longueur de la courbe : le trait part entièrement caché.
  const pathLen = w * 1.15;
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: pathLen * (1 - draw.value),
  }));

  const parts = text.split('__');
  if (parts.length !== 3) {
    // Traduction sans balise : rendu simple, sans soulignement.
    return <Text style={[styles.line, styles.line2]}>{text}</Text>;
  }

  const [rawPre, marked, rawPost] = parts;
  // Les fragments collés au mot (apostrophe, ponctuation) restent dans son bloc
  // pour ne pas être séparés par l'espacement inter-mots ni par un retour à la ligne.
  const preWords = rawPre.trim().split(/\s+/).filter(Boolean);
  const chipPrefix = rawPre.length > 0 && !rawPre.endsWith(' ') ? preWords.pop() : undefined;
  const postWords = rawPost.trim().split(/\s+/).filter(Boolean);
  const chipSuffix = rawPost.length > 0 && !rawPost.startsWith(' ') ? postWords.shift() : undefined;

  // Un seul geste assuré : trait quasi droit, très légèrement bombé, qui finit
  // un rien plus haut qu'il ne part — le coup de crayon vif sous un mot important.
  const d = `M 1 6.4 Q ${w * 0.5} 3.6, ${w - 1} 4.6`;

  return (
    <View style={styles.line2Row}>
      {preWords.map((word, i) => (
        <Text key={`pre-${i}`} style={styles.line2Word}>{word}</Text>
      ))}
      <View style={styles.line2Chip}>
        {chipPrefix != null && <Text style={styles.line2Word}>{chipPrefix}</Text>}
        <Text
          style={styles.line2Word}
          onLayout={(e) => setWordBox(e.nativeEvent.layout)}
        >
          {marked}
        </Text>
        {chipSuffix != null && <Text style={styles.line2Word}>{chipSuffix}</Text>}
        {wordBox != null && (
          <Svg
            pointerEvents="none"
            width={w}
            height={10}
            style={[styles.line2Stroke, { left: wordBox.x - STROKE_OVERHANG }]}
          >
            <AnimatedPath
              d={d}
              stroke={OnbColors.primaryDeep}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
              opacity={0.85}
              strokeDasharray={[pathLen, pathLen]}
              animatedProps={animatedProps}
            />
          </Svg>
        )}
      </View>
      {postWords.map((word, i) => (
        <Text key={`post-${i}`} style={styles.line2Word}>{word}</Text>
      ))}
    </View>
  );
}

export default function GiftScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const reduced = useReducedMotion();
  const navigatedRef = useRef(false);
  const { profile, patchProfile } = useAuth();

  // Le marqueur du mur, déposé par le chat au moment du zoom, s'applique ICI et
  // pas avant : la racine connaît maintenant cet écran comme gardant la main, et
  // ne saute plus au paywall par-dessus le cadeau et la frise
  // (utils/chatWallHandoff.ts). Il reste attaché tant que l'écran est là.
  const patchProfileRef = useRef(patchProfile);
  patchProfileRef.current = patchProfile;
  useEffect(() => attachWallPatchSink((patch) => patchProfileRef.current(patch)), []);

  // Le prénom personnalise l'adresse : c'est à TOI que Lucy offre la semaine.
  // Lu dans le profil : l'onboarding est terminé depuis le slider, ses réponses
  // sont effacées.
  const firstName = (profile?.first_name ?? '').trim();
  const line1 = firstName
    ? t('onboarding:gift.line1', { firstName })
    : t('onboarding:gift.line1NoName');

  const veil = useSharedValue(reduced ? 0 : 1);
  useEffect(() => {
    if (reduced) return;
    veil.value = withDelay(30, withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) }));
  }, [reduced, veil]);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));

  const delayOf = (base: number) => (reduced ? 0 : base);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.body}>
            <Animated.View entering={FadeInDown.delay(delayOf(LINE1_DELAY)).duration(800)}>
              <AmbientAura alive size={190} intensity={0.5} style={styles.aura} />
            </Animated.View>

            <Animated.Text
              entering={FadeInDown.delay(delayOf(LINE1_DELAY)).duration(800)}
              style={styles.line}
            >
              {line1}
            </Animated.Text>

            <Animated.View entering={FadeInDown.delay(delayOf(LINE2_DELAY)).duration(800)}>
              <GiftLine2 text={t('onboarding:gift.line2')} reduced={reduced} />
            </Animated.View>
          </View>

          <Animated.View
            entering={FadeInDown.delay(delayOf(CTA_DELAY)).duration(600)}
            style={{ paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }}
          >
            <OnboardingButton
              label={t('onboarding:gift.cta')}
              onPress={() => {
                if (navigatedRef.current) return;
                navigatedRef.current = true;
                router.push('/(onboarding)/trial-intro');
              }}
            />
          </Animated.View>
        </View>
      </SafeAreaView>

      {/* Voile de continuité avec le zoom parti du bouton Envoyer du chat. */}
      <Animated.View pointerEvents="none" style={[styles.veil, veilStyle]} />
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
    alignItems: 'center',
    paddingBottom: 40,
  },
  aura: {
    marginBottom: 44,
  },
  line: {
    ...OnbType.title,
    fontSize: 24,
    lineHeight: 34,
    color: OnbColors.ink,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  // La phrase du cadeau : détachée, c'est elle qu'on doit retenir.
  line2: {
    marginTop: 26,
    color: OnbColors.primary,
  },
  // Rendu mot à mot de la phrase du cadeau (pour le coup de crayon sous le mot clé).
  line2Row: {
    marginTop: 26,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 7,
    paddingHorizontal: 10,
  },
  line2Word: {
    ...OnbType.title,
    fontSize: 24,
    lineHeight: 34,
    color: OnbColors.primary,
  },
  line2Chip: {
    flexDirection: 'row',
  },
  // Un peu d'air entre le mot et le trait : le soulignement respire.
  line2Stroke: {
    position: 'absolute',
    bottom: -5,
  },
  veil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OnbColors.primary,
  },
});
