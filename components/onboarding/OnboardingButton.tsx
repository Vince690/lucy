/**
 * OnboardingButton — CTA principal de l'onboarding.
 * Dégradé orange + halo, flèche, léger enfoncement au press + haptique
 * (feeling « app premium »).
 */

import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { OnbColors, OnbRadius, OnbShadow } from '@/constants/onboardingTheme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface OnboardingButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  style?: ViewStyle;
}

export default function OnboardingButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
}: OnboardingButtonProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isGhost = variant === 'ghost';
  const isBlocked = disabled || loading;

  const handlePress = () => {
    if (isBlocked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: 110 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 160 });
      }}
      onPress={handlePress}
      disabled={isBlocked}
      style={[
        styles.base,
        isGhost ? styles.ghost : styles.primary,
        !isGhost && OnbShadow.button,
        disabled && styles.disabled,
        animatedStyle,
        style,
      ]}
    >
      {!isGhost && (
        <LinearGradient
          colors={['#FB923C', '#F97316', '#EA580C']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1.6 }}
          style={styles.gradient}
        />
      )}
      {loading ? (
        <ActivityIndicator color={isGhost ? OnbColors.primary : OnbColors.white} />
      ) : (
        <View style={styles.content}>
          <Text style={[styles.label, isGhost ? styles.ghostLabel : styles.primaryLabel]}>
            {label}
          </Text>
          {!isGhost && <ArrowRight size={19} color={OnbColors.white} strokeWidth={2.4} />}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 56,
    borderRadius: OnbRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primary: {
    backgroundColor: OnbColors.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: OnbRadius.button,
  },
  disabled: {
    opacity: 0.4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  primaryLabel: {
    color: OnbColors.white,
  },
  ghostLabel: {
    color: OnbColors.primary,
  },
});
