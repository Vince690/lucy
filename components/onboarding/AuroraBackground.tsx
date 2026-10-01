/**
 * AuroraBackground — fond « mesh gradient » animé (Voie A, sans dépendance native).
 *
 * Plusieurs grands halos oranges radiaux couvrent l'écran et dérivent / se dilatent en continu.
 * Leurs recouvrements se fondent → un champ de couleur qui coule doucement, façon mesh gradient.
 * Blanc dominant, orange majoritaire, léger.
 *
 * Perf : on anime le transform (dérive + échelle) des calques, pas les stops du dégradé.
 * Respecte « Réduire les animations » → champ statique (les halos au repos, doux et beau).
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  useReducedMotion,
  cancelAnimation,
} from 'react-native-reanimated';

interface BlobSpec {
  color: string;
  opacity: number;
  size: number;
  left: number;
  top: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
}

function Blob({ color, opacity, size, left, top, dx, dy, duration, delay }: BlobSpec) {
  const t = useSharedValue(0);
  const reduced = useReducedMotion();
  const gradientId = useRef(`mesh-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    if (reduced) return;
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
    return () => cancelAnimation(t);
  }, [reduced, t, delay, duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    // Pulsation d'opacité : c'est elle qui rend le mouvement perceptible à l'œil,
    // bien plus que la seule translation d'un dégradé diffus.
    opacity: 0.62 + t.value * 0.38,
    transform: [
      { translateX: dx * t.value },
      { translateY: dy * t.value },
      { scale: 1 + t.value * 0.3 },
    ],
  }));

  return (
    <Animated.View
      style={[{ position: 'absolute', left, top, width: size, height: size }, animatedStyle]}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={gradientId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="40%" stopColor={color} stopOpacity={opacity * 0.55} />
            <Stop offset="72%" stopColor={color} stopOpacity={opacity * 0.16} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
}

export default function AuroraBackground() {
  const { width: W, height: H } = useWindowDimensions();
  const S = Math.max(W, H);

  // Chaque halo est défini par la trajectoire de son CENTRE : (cx0, cy0) → (cx1, cy1),
  // en fractions d'écran. Chacun traverse toute la largeur (gauche ↔ droite, sens alternés,
  // 4 bandes verticales) → la couleur balaie l'écran entier, sans zone favorisée.
  // L'aller-retour (withRepeat inversé) fait une boucle parfaitement sans couture.
  const mkBlob = (
    color: string,
    opacity: number,
    sizeF: number,
    cx0: number,
    cy0: number,
    cx1: number,
    cy1: number,
    duration: number,
    delay: number,
  ): BlobSpec => {
    const size = S * sizeF;
    return {
      color,
      opacity,
      size,
      left: W * cx0 - size / 2,
      top: H * cy0 - size / 2,
      dx: W * (cx1 - cx0),
      dy: H * (cy1 - cy0),
      duration,
      delay,
    };
  };

  const blobs: BlobSpec[] = [
    mkBlob('#F97316', 0.3, 0.8, -0.1, 0.1, 1.05, 0.3, 5600, 0),
    mkBlob('#FDBA74', 0.3, 0.9, 1.1, 0.32, -0.08, 0.12, 6400, 400),
    mkBlob('#FB923C', 0.28, 0.7, 1.05, 0.62, -0.05, 0.8, 5200, 200),
    mkBlob('#FED7AA', 0.32, 0.95, -0.05, 0.88, 1.0, 0.62, 6000, 650),
  ];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {blobs.map((b, i) => (
        <Blob key={i} {...b} />
      ))}
    </View>
  );
}
