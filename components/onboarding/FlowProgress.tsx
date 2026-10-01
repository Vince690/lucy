/**
 * FlowProgress — barre de progression fine et continue du flow d'onboarding
 * (écrans à questions). Matérialise l'avancement (sunk cost) sans voler l'attention.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { OnbColors } from '@/constants/onboardingTheme';

interface FlowProgressProps {
  /** Étape courante (1-indexée). */
  step: number;
  total: number;
}

export default function FlowProgress({ step, total }: FlowProgressProps) {
  const fraction = Math.min(Math.max(step / total, 0), 1);
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withTiming(fraction, { duration: 550, easing: Easing.out(Easing.cubic) });
  }, [fraction, p]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: p.value }],
  }));

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 2.5,
    borderRadius: 999,
    backgroundColor: OnbColors.hairline,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: OnbColors.primary,
    borderRadius: 999,
    transformOrigin: 'left',
  },
});
