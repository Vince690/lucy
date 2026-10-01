import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withRepeat,
  withTiming,
  FadeIn,
} from 'react-native-reanimated';

/**
 * Indicateur « Lucy écrit » — composant stable (hors ChatScreen) pour éviter
 * démontages/remontages à chaque rendu du parent.
 */
export function ChatTypingIndicator() {
  const dot1Opacity = useSharedValue(0.3);
  const dot2Opacity = useSharedValue(0.3);
  const dot3Opacity = useSharedValue(0.3);

  useEffect(() => {
    dot1Opacity.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
    dot2Opacity.value = withDelay(
      200,
      withRepeat(withTiming(1, { duration: 600 }), -1, true)
    );
    dot3Opacity.value = withDelay(
      400,
      withRepeat(withTiming(1, { duration: 600 }), -1, true)
    );
    // shared values stables — pas de deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dot1Style = useAnimatedStyle(() => ({ opacity: dot1Opacity.value }));
  const dot2Style = useAnimatedStyle(() => ({ opacity: dot2Opacity.value }));
  const dot3Style = useAnimatedStyle(() => ({ opacity: dot3Opacity.value }));

  return (
    <Animated.View
      entering={FadeIn.springify()}
      style={[styles.messageBubble, styles.aiMessage, styles.typingBubble]}
    >
      <View style={styles.typingContainer}>
        <Animated.View style={[styles.typingDot, dot1Style]} />
        <Animated.View style={[styles.typingDot, dot2Style]} />
        <Animated.View style={[styles.typingDot, dot3Style]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  messageBubble: {
    maxWidth: '80%',
    marginVertical: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#EDE8E0',
    borderBottomLeftRadius: 6,
  },
  typingBubble: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#374151',
    marginHorizontal: 2,
  },
});
