/**
 * QuestionHeader — chrome commun des écrans questions : chevron retour très discret
 * (optionnel) + fil de progression. Symétrique pour que la barre reste centrée.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import FlowProgress from '@/components/onboarding/FlowProgress';
import { OnbColors, OnbSpacing } from '@/constants/onboardingTheme';

interface QuestionHeaderProps {
  step: number;
  total: number;
  onBack?: () => void;
}

export default function QuestionHeader({ step, total, onBack }: QuestionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {onBack && (
          <Pressable hitSlop={12} onPress={onBack} style={styles.backBtn}>
            <ChevronLeft size={22} color={OnbColors.mutedLight} strokeWidth={2.25} />
          </Pressable>
        )}
      </View>
      <View style={styles.progress}>
        <FlowProgress step={step} total={total} />
      </View>
      <View style={styles.side} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: OnbSpacing.screenX - 8,
    paddingTop: OnbSpacing.screenTop,
    gap: 6,
  },
  side: {
    width: 30,
  },
  backBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  progress: {
    flex: 1,
  },
});
