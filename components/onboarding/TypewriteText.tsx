/**
 * TypewriteText — le texte apparaît lettre par lettre, en fondu, de façon fluide.
 * Léger (opacité seule). Respecte « Réduire les animations » (texte plein alors).
 *
 * Le wrapping est préservé : chaque mot est une unité insécable, la coupure se fait
 * entre les mots.
 */

import React from 'react';
import { View, Text, StyleProp, TextStyle } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

interface TypewriteTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Délai avant la 1ère lettre (ms). */
  startDelay?: number;
  /** Délai entre chaque lettre (ms). */
  charDelay?: number;
  /** Durée du fondu de chaque lettre (ms). */
  duration?: number;
}

export default function TypewriteText({
  text,
  style,
  startDelay = 260,
  charDelay = 28,
  duration = 240,
}: TypewriteTextProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <Text style={style}>{text}</Text>;
  }

  const words = text.split(' ');
  let charIndex = 0;

  return (
    <View
      accessible
      accessibilityLabel={text}
      importantForAccessibility="no-hide-descendants"
      style={styles.wrap}
    >
      {words.map((word, wi) => {
        const chars = Array.from(word);
        const isLast = wi === words.length - 1;
        return (
          <View key={wi} style={styles.word}>
            {chars.map((ch, ci) => {
              const delay = startDelay + charIndex * charDelay;
              charIndex += 1;
              return (
                <Animated.Text
                  key={ci}
                  entering={FadeIn.delay(delay).duration(duration)}
                  style={style}
                >
                  {ch}
                </Animated.Text>
              );
            })}
            {!isLast && ((): React.ReactNode => {
              const delay = startDelay + charIndex * charDelay;
              charIndex += 1;
              return (
                <Animated.Text entering={FadeIn.delay(delay).duration(duration)} style={style}>
                  {' '}
                </Animated.Text>
              );
            })()}
          </View>
        );
      })}
    </View>
  );
}

const styles = {
  wrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  word: { flexDirection: 'row' as const },
};
