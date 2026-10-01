/**
 * AmbientAura — la « signature » visuelle de l'onboarding Lucy.
 *
 * Un halo orange radial qui respire. Deux modes :
 *  - calme (défaut) : respiration lente et discrète, ambiance.
 *  - `alive` : l'ÂME de Lucy — respiration ample et organique (squash & stretch façon
 *    animation Disney : le halo s'étire sur un axe quand il se comprime sur l'autre),
 *    dérive désynchronisée, et un cœur interne plus dense qui bat en contre-phase.
 *
 * Perf : on n'anime PAS les stops du dégradé (impossible en reanimated) — uniquement
 * les transforms des calques. Respecte "Réduire les animations".
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  useReducedMotion,
  cancelAnimation,
} from 'react-native-reanimated';
import { OnbColors } from '@/constants/onboardingTheme';

interface AmbientAuraProps {
  size?: number;
  color?: string;
  /** Opacité du centre du halo (0..1). */
  intensity?: number;
  /** Mode « âme vivante » : respiration ample, étirements organiques, cœur battant. */
  alive?: boolean;
  /** Positionnement (absolu) fourni par l'écran. */
  style?: ViewStyle | ViewStyle[];
}

/**
 * Phase qui tourne en continu (0 → 1, linéaire, en boucle). Les mouvements sont
 * ensuite des sinus/cosinus de cette phase : position ET vitesse parfaitement
 * continues au bouclage — aucune « couture » visible, contrairement à un
 * aller-retour withTiming qui marque un arrêt à chaque extrémité.
 */
function spinPhase(value: { value: number }, duration: number) {
  value.value = 0;
  value.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
}

const TWO_PI = Math.PI * 2;

export default function AmbientAura({
  size = 460,
  color = OnbColors.primary,
  intensity = 0.5,
  alive = false,
  style,
}: AmbientAuraProps) {
  const breath = useSharedValue(0);
  const sway = useSharedValue(0.5);
  const swirl = useSharedValue(0.5);
  const reduced = useReducedMotion();

  // ids uniques par instance pour éviter toute collision de <Defs> entre auras.
  const uid = useRef(Math.random().toString(36).slice(2)).current;
  const haloId = `aura-${uid}`;
  const coreId = `aura-core-${uid}`;

  useEffect(() => {
    if (reduced) return;

    // Périodes complètes désynchronisées (rapports non entiers) → le motif combiné
    // ne se répète jamais à l'œil, alors que chaque orbite est individuellement
    // parfaite. Mêmes tempos qu'avant (une période = l'ancien aller-retour).
    spinPhase(breath, alive ? 4600 : 8400);
    spinPhase(sway, alive ? 6600 : 11200);
    if (alive) spinPhase(swirl, 9400);

    return () => {
      cancelAnimation(breath);
      cancelAnimation(sway);
      cancelAnimation(swirl);
    };
  }, [reduced, alive, breath, sway, swirl]);

  const haloStyle = useAnimatedStyle(() => {
    // Ondes dérivées des phases : b oscille 0→1→0 (part du repos), s et w
    // oscillent -1→+1 autour du centre (partent du centre) — l'orbite de la comète.
    const b = 0.5 - 0.5 * Math.cos(TWO_PI * breath.value);
    const s = Math.sin(TWO_PI * sway.value);
    const w = Math.sin(TWO_PI * swirl.value);

    if (!alive) {
      return {
        transform: [
          { scale: 1 + 0.09 * b },
          { translateY: s * 10 },
          { translateX: s * -6 },
        ],
      };
    }
    // Squash & stretch : un axe s'étire pendant que l'autre se comprime.
    return {
      transform: [
        { translateX: s * 13 },
        { translateY: w * 16 },
        { scaleX: 1 + 0.13 * b - 0.02 * w },
        { scaleY: 1 - 0.08 * b + 0.025 * s },
      ],
    };
  });

  // Le cœur bat en CONTRE-PHASE du halo (quand le halo s'ouvre, le cœur se resserre).
  const coreStyle = useAnimatedStyle(() => {
    const b = 0.5 - 0.5 * Math.cos(TWO_PI * breath.value);
    const s = Math.sin(TWO_PI * sway.value);
    const w = Math.sin(TWO_PI * swirl.value);
    return {
      opacity: 0.7 + 0.3 * (1 - b),
      transform: [
        { translateX: s * -8 },
        { translateY: w * -9 },
        { scale: 0.88 + 0.22 * (1 - b) },
      ],
    };
  });

  const coreSize = size * 0.56;

  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <Animated.View style={haloStyle}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={color} stopOpacity={intensity} />
              <Stop offset="45%" stopColor={color} stopOpacity={intensity * 0.45} />
              <Stop offset="100%" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${haloId})`} />
        </Svg>
      </Animated.View>

      {alive && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.center, coreStyle]}>
          <Svg width={coreSize} height={coreSize}>
            <Defs>
              <RadialGradient id={coreId} cx="50%" cy="50%" r="50%">
                <Stop
                  offset="0%"
                  stopColor={color}
                  stopOpacity={Math.min(intensity * 1.6, 1)}
                />
                <Stop offset="55%" stopColor={color} stopOpacity={intensity * 0.5} />
                <Stop offset="100%" stopColor={color} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle
              cx={coreSize / 2}
              cy={coreSize / 2}
              r={coreSize / 2}
              fill={`url(#${coreId})`}
            />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
