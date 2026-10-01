/**
 * StoriesProgress — barre segmentée façon « stories ».
 * Le segment courant se remplit en continu (piloté par `progress`), les précédents
 * sont pleins, les suivants vides.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { OnbColors } from '@/constants/onboardingTheme';

interface SegmentProps {
  i: number;
  index: number;
  progress: SharedValue<number>;
}

function Segment({ i, index, progress }: SegmentProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const w = i < index ? 1 : i === index ? progress.value : 0;
    return { transform: [{ scaleX: w }] };
  });

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, animatedStyle]} />
    </View>
  );
}

interface StoriesProgressProps {
  total: number;
  index: number;
  progress: SharedValue<number>;
}

export default function StoriesProgress({ total, index, progress }: StoriesProgressProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <Segment key={i} i={i} index={index} progress={progress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  track: {
    flex: 1,
    height: 2.5,
    borderRadius: 999,
    // Blanc (pas gris) : sur le fond mesh orange, le gris se mélange mal ;
    // le remplissage orange suffit à lire la progression.
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: OnbColors.primary,
    borderRadius: 999,
    transformOrigin: 'left',
  },
});
