/**
 * ChoicePill — option de réponse en pilule, ajustée à la taille de son texte.
 * Sélection : fond chaud + contour orange + haptique légère.
 *
 * La largeur est réservée pour la graisse SÉLECTIONNÉE (texte fantôme en 600) :
 * la pilule ne grandit pas d'un pixel quand on la choisit — sinon les rangées
 * en flexWrap se réorganisent au tap.
 */

import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { OnbColors, OnbRadius } from '@/constants/onboardingTheme';

interface ChoicePillProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export default function ChoicePill({ label, selected, disabled = false, onPress }: ChoicePillProps) {
  const handlePress = () => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pill,
        selected && styles.pillSelected,
        disabled && styles.pillDisabled,
        pressed && !disabled && styles.pillPressed,
      ]}
    >
      <View>
        {/* Fantôme invisible en graisse max : fixe la largeur une fois pour toutes. */}
        <Text style={[styles.label, styles.labelGhost]} accessible={false}>
          {label}
        </Text>
        <Text
          style={[
            styles.label,
            styles.labelOverlay,
            selected && styles.labelSelected,
            disabled && styles.labelDisabled,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: OnbColors.hairline,
    borderRadius: OnbRadius.pill,
    paddingVertical: 12,
    paddingHorizontal: 22,
    backgroundColor: OnbColors.bg,
  },
  pillSelected: {
    backgroundColor: OnbColors.selectedBg,
    borderColor: OnbColors.primary,
  },
  pillPressed: {
    opacity: 0.75,
  },
  pillDisabled: {
    opacity: 0.35,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: OnbColors.ink,
  },
  labelGhost: {
    fontWeight: '600',
    opacity: 0,
  },
  labelOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  labelSelected: {
    color: OnbColors.primary,
    fontWeight: '600',
  },
  labelDisabled: {
    color: OnbColors.mutedLight,
  },
});
