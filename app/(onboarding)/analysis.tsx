/**
 * Analyse — la « labor illusion » signature de l'onboarding.
 *
 * VRAI écran blanc à l'arrivée, puis l'âme de Lucy (AmbientAura `alive`) naît du néant.
 * Les propres mots de l'utilisateur — ses réponses au quiz, en pilules fantômes —
 * apparaissent en suspension autour d'elle, disposés en anneau irrégulier, puis sont
 * absorbés un à un : pulsation du halo + ondulation goutte d'eau + haptique légère à
 * chaque absorption. Un anneau ÉPAIS aux bouts arrondis se dessine sur la durée, sans
 * rail pré-tracé (le chemin reste imprévisible). À la fin, Lucy remercie en personne
 * (seul texte de l'écran), tout s'apaise → reveal.
 *
 * Moment cinématique : pas de chrome, pas de CTA, durée fixe, non accélérable.
 * « Réduire les animations » : aura statique + navigation rapide.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withDelay,
  withTiming,
  withSequence,
  withRepeat,
  interpolate,
  runOnJS,
  Easing,
  useReducedMotion,
  cancelAnimation,
  type SharedValue,
} from 'react-native-reanimated';
import AmbientAura from '@/components/onboarding/AmbientAura';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { OnbColors } from '@/constants/onboardingTheme';
import { track } from '@/utils/analytics';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ---------------------------------------------------------------------------
// Chronologie (ms)
// ---------------------------------------------------------------------------
const BIRTH_DELAY = 1100; // écran blanc pur avant que quoi que ce soit n'apparaisse
const BIRTH_DURATION = 1100; // naissance de l'aura depuis le néant
const EXHALE_AT = BIRTH_DELAY + BIRTH_DURATION - 80; // expiration après la naissance
const EXHALE_DOWN = 850; // descente (expiration) — décélère fortement vers le bas
const EXHALE_UP = 1050; // remontée — départ légèrement plus franc, arrive en douceur
const APPEAR_BASE = 3700; // première pilule (après la naissance + l'expiration)
const APPEAR_GAP = 190; // cascade d'apparition
const ABSORB_SETTLE = 600; // respiration entre fin d'apparition et début d'absorption
const ABSORB_GAP = 300; // cadence d'absorption
const ABSORB_DURATION = 650;
const FINAL_HOLD = 2100; // remerciement de Lucy + apaisement avant navigation

// Fraction verticale du centre de l'aura.
const AURA_CY = 0.4;
const RING_RADIUS = 118;
const RING_STROKE = 10; // affirmé sans être massif — bouts arrondis

// Emplacements composés à la main : anneau IRRÉGULIER autour de l'aura (rayons et
// angles variés, aucune colonne), rien sous 0.72 pour laisser respirer le texte final.
const SLOTS = [
  { x: 0.5, y: 0.075 },
  { x: 0.28, y: 0.13 },
  { x: 0.74, y: 0.165 },
  { x: 0.19, y: 0.28 },
  { x: 0.81, y: 0.33 },
  { x: 0.22, y: 0.47 },
  { x: 0.78, y: 0.44 },
  { x: 0.3, y: 0.62 },
  { x: 0.68, y: 0.66 },
  { x: 0.48, y: 0.72 },
] as const;

const PILL_BOX = 240; // largeur du conteneur invisible centré sur l'emplacement

// ---------------------------------------------------------------------------
// Pilule flottante absorbée
// ---------------------------------------------------------------------------
interface FloatingPillProps {
  label: string;
  slotX: number;
  slotY: number;
  targetX: number;
  targetY: number;
  appearAt: number;
  absorbAt: number;
  screenWidth: number;
  onAbsorbed: () => void;
}

function FloatingPill({
  label,
  slotX,
  slotY,
  targetX,
  targetY,
  appearAt,
  absorbAt,
  screenWidth,
  onAbsorbed,
}: FloatingPillProps) {
  const appear = useSharedValue(0);
  const absorb = useSharedValue(0);
  const float = useSharedValue(0);

  useEffect(() => {
    appear.value = withDelay(
      appearAt,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
    );
    // Dérive douce, désynchronisée par pilule via la durée dépendant de la position.
    float.value = withDelay(
      appearAt,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 2400 + slotY * 900, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 2400 + slotY * 900, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
    absorb.value = withDelay(
      absorbAt,
      withTiming(1, { duration: ABSORB_DURATION, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onAbsorbed)();
      }),
    );
    return () => {
      cancelAnimation(appear);
      cancelAnimation(absorb);
      cancelAnimation(float);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dx = targetX - slotX;
  const dy = targetY - slotY;

  const animatedStyle = useAnimatedStyle(() => {
    const t = absorb.value;
    return {
      opacity: appear.value * interpolate(t, [0, 0.7, 1], [1, 0.9, 0]),
      transform: [
        { translateX: dx * t },
        { translateY: dy * t + (float.value - 0.5) * 9 * (1 - t) },
        { scale: (0.92 + 0.08 * appear.value) * (1 - 0.7 * t) },
      ],
    };
  });

  // Conteneur invisible centré sur l'emplacement, borné aux bords de l'écran.
  const left = Math.min(Math.max(slotX - PILL_BOX / 2, 8), screenWidth - PILL_BOX - 8);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pillBox, { left, top: slotY - 22 }, animatedStyle]}
    >
      <View style={styles.pill}>
        <Text style={styles.pillLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Anneau de progression — épais, bouts arrondis, SANS rail pré-tracé
// ---------------------------------------------------------------------------
function ProgressRing({ progress, size }: { progress: SharedValue<number>; size: number }) {
  const circumference = 2 * Math.PI * RING_RADIUS;
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));
  return (
    <Svg
      width={size}
      height={size}
      // Départ du tracé à midi.
      style={{ transform: [{ rotate: '-90deg' }] }}
    >
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={RING_RADIUS}
        stroke={OnbColors.primary}
        strokeWidth={RING_STROKE}
        // Encre adoucie, cohérente avec le halo : l'anneau accompagne, il ne crie pas.
        strokeOpacity={0.50}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circumference}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Écran
// ---------------------------------------------------------------------------
export default function AnalysisScreen() {
  const router = useRouter();
  const { t } = useTranslation(['onboarding']);
  const { answers } = useOnboarding();
  const { width: W, height: H } = useWindowDimensions();
  const reduced = useReducedMotion();

  const [showThanks, setShowThanks] = useState(false);
  const navigatedRef = useRef(false);

  // Les mots de l'utilisateur, entrelacés par thème pour la variété : 3 traits,
  // 2 « à comprendre », à qui parler, humeur, énergie, 1 préoccupation, 1 objectif.
  const labels = useMemo(() => {
    const traits = (answers.traits ?? []).map((k) => t(`onboarding:traits.keys.${k}`));
    const understood = (answers.understood ?? [])
      .slice(0, 2)
      .map((k) => t(`onboarding:quiz.understood.options.${k}`));
    const talkTo = answers.talkTo
      ? [t(`onboarding:quiz.talkTo.options.${answers.talkTo}`)]
      : [];
    const concern = (answers.concerns ?? [])
      .filter((k) => k !== 'nothing_special')
      .slice(0, 1)
      .map((k) => t(`onboarding:quiz.concerns.options.${k}`));
    const goal = (answers.goals ?? [])
      .slice(0, 1)
      .map((k) => t(`onboarding:quiz.goals.options.${k}`));
    const mood = answers.mood ? [t(`onboarding:quiz.mood.options.${answers.mood}`)] : [];
    const energy = answers.energy ? [t(`onboarding:quiz.energy.options.${answers.energy}`)] : [];
    const interleaved = [
      traits[0],
      understood[0],
      concern[0],
      mood[0],
      talkTo[0],
      goal[0],
      understood[1],
      energy[0],
      traits[1],
      traits[2],
    ].filter((v): v is string => Boolean(v));
    return interleaved.slice(0, SLOTS.length);
  }, [answers, t]);

  const n = labels.length;
  const absorbStart = APPEAR_BASE + n * APPEAR_GAP + ABSORB_SETTLE;
  const endAt = absorbStart + Math.max(n - 1, 0) * ABSORB_GAP + ABSORB_DURATION;

  const auraCenterX = W / 2;
  const auraCenterY = H * AURA_CY;

  const birth = useSharedValue(0);
  const pulse = useSharedValue(1); // battements (impacts, expiration de naissance)
  const breathe = useSharedValue(1); // respiration continue, JAMAIS interrompue
  const flash = useSharedValue(0); // éclat du cœur vers le bord à chaque absorption
  const ring = useSharedValue(0);

  // Battement du halo LUI-MÊME (goutte de savoir) : contraction brève → dilatation
  // FRANCHE au-delà de la taille normale → retour, doublé d'un éclat du cœur orange
  // qui s'étend vers le bord. Réassigner la séquence INTERROMPT le battement en cours
  // et le relance (rafale si les pilules s'enchaînent) — la respiration continue en
  // dessous, sur sa propre couche.
  const handleAbsorbed = () => {
    Haptics.selectionAsync().catch(() => {});
    pulse.value = withSequence(
      withTiming(0.9, { duration: 100, easing: Easing.out(Easing.quad) }),
      withTiming(1.17, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
    );
    flash.value = withSequence(
      withTiming(0.6, { duration: 130, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 620, easing: Easing.out(Easing.ease) }),
    );
  };

  useEffect(() => {
    const startedAt = Date.now();
    const navigate = () => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      // La séquence est allée à son terme sans que personne ne quitte l'app.
      // Une chute ici, sur un écran où l'on ne fait qu'attendre, signalerait
      // une animation trop longue — pas un désintérêt pour le contenu.
      track('analysis_screen_finished', {
        duration_ms: Date.now() - startedAt,
        reduced_motion: reduced,
      });
      router.replace('/(onboarding)/reveal');
    };

    if (reduced) {
      birth.value = 1;
      const id = setTimeout(navigate, 900);
      return () => clearTimeout(id);
    }

    // Naissance : écran blanc pur, puis l'aura ÉMERGE du néant.
    birth.value = withDelay(
      BIRTH_DELAY,
      withTiming(1, { duration: BIRTH_DURATION, easing: Easing.out(Easing.cubic) }),
    );

    ring.value = withDelay(
      APPEAR_BASE - 300,
      withTiming(1, { duration: endAt - APPEAR_BASE + 300, easing: Easing.inOut(Easing.ease) }),
    );

    // Respiration continue (Headspace) : très lente, très ample sans être un battement.
    // Sur sa PROPRE couche multiplicative → les impacts d'absorption ne la coupent pas.
    breathe.value = withDelay(
      EXHALE_AT + EXHALE_DOWN + EXHALE_UP,
      withRepeat(
        withSequence(
          withTiming(0.92, { duration: 2700, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 2700, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );

    const timers = [
      // Expiration de naissance : descente profonde qui DÉCÉLÈRE vers le bas (quasi
      // immobile au creux), puis remontée qui repart lentement et accélère avant
      // d'arriver en douceur — fluide, apaisant, jamais brusque.
      setTimeout(() => {
        pulse.value = withSequence(
          withTiming(0.75, { duration: EXHALE_DOWN, easing: Easing.out(Easing.cubic) }),
          withTiming(1, { duration: EXHALE_UP, easing: Easing.inOut(Easing.quad) }),
        );
      }, EXHALE_AT),
      // Remerciement final de Lucy + pulsation profonde
      setTimeout(() => {
        setShowThanks(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        pulse.value = withSequence(
          withTiming(0.88, { duration: 140, easing: Easing.out(Easing.quad) }),
          withTiming(1.2, { duration: 240, easing: Easing.out(Easing.cubic) }),
          withTiming(1, { duration: 620, easing: Easing.inOut(Easing.ease) }),
        );
      }, endAt - 400),
      setTimeout(navigate, endAt + FINAL_HOLD),
    ];
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(ring);
      cancelAnimation(pulse);
      cancelAnimation(breathe);
      cancelAnimation(flash);
      cancelAnimation(birth);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Trois couches multiplicatives : naissance × respiration continue × battements.
  const auraStyle = useAnimatedStyle(() => ({
    opacity: birth.value,
    transform: [{ scale: pulse.value * breathe.value * (0.02 + 0.98 * birth.value) }],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flash.value,
  }));

  const thanksText = answers.firstName
    ? t('onboarding:analysis.thanks', { firstName: answers.firstName })
    : t('onboarding:analysis.thanksNoName');

  const ringSize = RING_RADIUS * 2 + RING_STROKE + 4;

  return (
    <View style={styles.container}>
      {/* L'âme de Lucy (naissance + respiration vivante + pulsations) */}
      <Animated.View
        style={[styles.auraWrap, { left: auraCenterX - 230, top: auraCenterY - 230 }, auraStyle]}
        pointerEvents="none"
      >
        <AmbientAura size={460} intensity={0.46} alive />
        {/* Éclat d'impact : le cœur orange s'étend brièvement vers le bord du halo
            à chaque absorption (opacité pilotée par flash). */}
        <Animated.View style={[styles.flashLayer, flashStyle]}>
          <Svg width={360} height={360}>
            <Defs>
              <RadialGradient id="analysis-flash" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={OnbColors.primary} stopOpacity={0.55} />
                <Stop offset="55%" stopColor={OnbColors.primary} stopOpacity={0.32} />
                <Stop offset="100%" stopColor={OnbColors.primary} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={180} cy={180} r={180} fill="url(#analysis-flash)" />
          </Svg>
        </Animated.View>
      </Animated.View>

      {!reduced && (
        <Animated.View
          entering={FadeIn.delay(APPEAR_BASE - 500).duration(700)}
          style={[
            styles.ringWrap,
            { left: auraCenterX - ringSize / 2, top: auraCenterY - ringSize / 2 },
          ]}
          pointerEvents="none"
        >
          <ProgressRing progress={ring} size={ringSize} />
        </Animated.View>
      )}

      {/* Les mots de l'utilisateur, en suspension puis absorbés */}
      {!reduced &&
        labels.map((label, i) => (
          <FloatingPill
            key={`${label}-${i}`}
            label={label}
            slotX={W * SLOTS[i].x}
            slotY={H * SLOTS[i].y}
            targetX={auraCenterX}
            targetY={auraCenterY}
            appearAt={APPEAR_BASE + i * APPEAR_GAP}
            absorbAt={absorbStart + i * ABSORB_GAP}
            screenWidth={W}
            onAbsorbed={handleAbsorbed}
          />
        ))}

      {/* Le remerciement de Lucy — seul texte de l'écran, à la toute fin */}
      {showThanks && (
        <View style={styles.thanksWrap} pointerEvents="none">
          <Animated.Text entering={FadeIn.duration(500)} style={styles.thanks}>
            {thanksText}
          </Animated.Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OnbColors.bg,
  },
  auraWrap: {
    position: 'absolute',
    width: 460,
    height: 460,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringWrap: {
    position: 'absolute',
  },
  pillBox: {
    position: 'absolute',
    width: PILL_BOX,
    alignItems: 'center',
  },
  pill: {
    borderWidth: 1,
    borderColor: OnbColors.hairline,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: OnbColors.bg,
  },
  pillLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: OnbColors.muted,
  },
  thanksWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 132,
    alignItems: 'center',
    paddingHorizontal: 44,
  },
  // Même voix que le titre du reveal (« {{prénom}}, voici ce qu'on a compris. »)
  thanks: {
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: OnbColors.ink,
    textAlign: 'center',
    lineHeight: 35,
  },
});
