/**
 * « Voici comment ça se passe. » — l'écran de réassurance pré-paywall.
 *
 * Timeline verticale de l'essai (pattern Blinkist) : Aujourd'hui (tout se débloque),
 * Jour 5 (Lucy envoie un rappel), Jour 7 (l'abonnement démarre). Révélée en cascade.
 * Le ton suit l'écran « semaine offerte » qui précède : on explique un cadeau reçu,
 * pas un produit qu'on vend. C'est AUSSI le moment de pré-permission notifications :
 * « Activer le rappel » déclenche la pop-up système dans le seul contexte où dire oui
 * rend service (être prévenu avant la fin de l'essai) ; « Plus tard » continue sans
 * pop-up — la cartouche système n'est jamais grillée sur un refus implicite.
 *
 * On arrive en fondu depuis l'écran « semaine offerte » (gift).
 */

import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { LockOpen, Bell, CalendarCheck } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import OnboardingButton from '@/components/onboarding/OnboardingButton';
import {
  getPermissionStatus,
  requestPermissions,
  scheduleNotificationChain,
} from '@/utils/notificationService';
import { useAuth } from '@/contexts/AuthContext';
import i18n from '@/utils/i18n';
import { OnbColors, OnbSpacing, OnbType } from '@/constants/onboardingTheme';
import { track } from '@/utils/analytics';

const ICON_SIZE = 44;

export default function TrialIntroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['onboarding']);
  const reduced = useReducedMotion();
  const { profile, updateProfile } = useAuth();
  const [requesting, setRequesting] = useState(false);
  const navigatedRef = useRef(false);

  const goNext = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.push('/(onboarding)/paywall');
  };

  const handleLater = () => {
    // « Plus tard » compte aussi : sans lui, l'entonnoir ne distinguait pas un
    // refus du rappel d'une app fermée sur cet écran.
    track('notification_permission_prompted', { result: 'skipped' });
    goNext();
  };

  const handleRemind = async () => {
    if (requesting || navigatedRef.current) return;
    setRequesting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      // Pop-up système iOS (une seule chance) — déclenchée sur un oui explicite.
      await requestPermissions();
      // Le principal levier de retour dans l'app : savoir combien de gens
      // acceptent vraiment change la valeur de tout le reste de la chaîne.
      const status = await getPermissionStatus().catch(() => 'undetermined' as const);
      track('notification_permission_prompted', { result: status });
      // Le profil existe déjà (onboarding terminé au slider) avec les rappels
      // coupés : un oui ici les allume et planifie la chaîne, sans attendre l'achat.
      if (status === 'granted' && !profile?.notification_preferences?.enabled) {
        updateProfile({
          notification_preferences: { enabled: true, daily_reminder: true, weekly_summary: true },
        }).catch(() => {});
        scheduleNotificationChain(profile?.first_name ?? '', i18n.language || 'fr').catch(() => {});
      }
    } catch {
      // Permission indisponible : on continue, le paywall n'en dépend pas.
      track('notification_permission_prompted', { result: 'error' });
    }
    setRequesting(false);
    goNext();
  };

  const steps = [
    { Icon: LockOpen, label: t('onboarding:trial.today'), body: t('onboarding:trial.todayBody') },
    { Icon: Bell, label: t('onboarding:trial.day5'), body: t('onboarding:trial.day5Body') },
    { Icon: CalendarCheck, label: t('onboarding:trial.day7'), body: t('onboarding:trial.day7Body') },
  ];

  const delayOf = (base: number) => (reduced ? 0 : base);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <Animated.Text
            entering={FadeInDown.delay(delayOf(250)).duration(700)}
            style={styles.title}
          >
            {t('onboarding:trial.title')}
          </Animated.Text>

          <View style={styles.timeline}>
            {/* Fil vertical reliant les trois moments — il n'apparaît qu'APRÈS eux :
                les points posent le parcours, la barre vient le relier. */}
            <Animated.View
              entering={FadeIn.delay(delayOf(2250)).duration(600)}
              style={styles.timelineLine}
            />
            {steps.map(({ Icon, label, body }, i) => (
              <Animated.View
                key={label}
                entering={FadeInDown.delay(delayOf(750 + i * 450)).duration(650)}
                style={styles.stepRow}
              >
                <View style={[styles.stepIcon, i === 0 && styles.stepIconAccent]}>
                  <Icon
                    size={21}
                    color={i === 0 ? OnbColors.white : OnbColors.primary}
                    strokeWidth={2.2}
                  />
                </View>
                <View style={styles.stepTexts}>
                  <Text style={styles.stepLabel}>{label}</Text>
                  <Text style={styles.stepBody}>{body}</Text>
                </View>
              </Animated.View>
            ))}
          </View>

          <View style={styles.spacer} />

          <Animated.View
            entering={FadeInDown.delay(delayOf(2250)).duration(650)}
            style={{ paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) }}
          >
            <Text style={styles.promise}>{t('onboarding:trial.promise')}</Text>
            <OnboardingButton
              label={t('onboarding:trial.cta')}
              onPress={handleRemind}
              loading={requesting}
            />
            <Pressable onPress={handleLater} hitSlop={8} style={styles.laterBtn}>
              <Text style={styles.laterLabel}>{t('onboarding:trial.later')}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OnbColors.bg,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: OnbSpacing.screenX,
  },
  title: {
    ...OnbType.title,
    fontSize: 27,
    lineHeight: 35,
    color: OnbColors.ink,
    textAlign: 'center',
    marginTop: 84,
  },
  timeline: {
    marginTop: 52,
    paddingHorizontal: 6,
    gap: 34,
  },
  timelineLine: {
    position: 'absolute',
    left: 6 + ICON_SIZE / 2 - 1,
    top: ICON_SIZE / 2,
    bottom: ICON_SIZE / 2,
    width: 2,
    backgroundColor: OnbColors.primarySoft,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  stepIcon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: OnbColors.selectedBg,
    borderWidth: 1.5,
    borderColor: OnbColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // « Aujourd'hui » en plein orange : c'est l'étape où l'on EST (le cadeau est
  // actif maintenant) — pattern des timelines d'essai de référence.
  stepIconAccent: {
    backgroundColor: OnbColors.primary,
    borderColor: OnbColors.primary,
  },
  stepTexts: {
    flex: 1,
    gap: 3,
    paddingTop: 1,
  },
  stepLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: OnbColors.ink,
  },
  stepBody: {
    fontSize: 15,
    lineHeight: 21,
    color: OnbColors.muted,
  },
  spacer: {
    flex: 1,
  },
  promise: {
    fontSize: 15,
    fontWeight: '600',
    color: OnbColors.inkSoft,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  laterBtn: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 2,
  },
  laterLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: OnbColors.mutedLight,
  },
});
