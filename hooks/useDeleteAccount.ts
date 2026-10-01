/**
 * Suppression de compte — exigence 5.1.1(v).
 *
 * Extrait de `app/(app)/settings.tsx` pour être partagé avec l'écran
 * `(onboarding)/account`, seul point de sortie d'un abonnement terminé. Le
 * texte porté ici est de la conformité : deux copies divergeraient, et celle
 * qui divergerait serait celle qu'Apple lit.
 *
 * Supprimer le compte ne résilie PAS l'abonnement : il est vendu par Apple,
 * qui continue de facturer. Apple demande explicitement de le dire et
 * d'inviter à résilier AVANT de continuer (« notify them that their billing
 * will continue through Apple and request that they cancel their subscription
 * before continuing », developer.apple.com/support/offering-account-deletion-in-your-app).
 *
 * Apple ne l'exige que pour un abonnement actif (« if the user has
 * auto-renewable subscriptions »), mais l'avertissement est montré à tout le
 * monde, au conditionnel. Le savoir dépendrait de RevenueCat : s'il n'a pas
 * encore répondu, le drapeau est faux et l'avertissement disparaîtrait —
 * précisément dans le scénario que la revue teste. Un non-abonné lit une
 * phrase qui ne le concerne pas ; un abonné qui ne la lit pas fait rejeter
 * l'app. L'asymétrie tranche.
 */

import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { cancelAllNotifications } from '@/utils/notificationService';
import { STORE_NAME, STORE_SUBSCRIPTIONS_URL } from '@/utils/store';

export function useDeleteAccount() {
  const { t } = useTranslation();
  const { deleteAccount } = useAuth();

  return useCallback(() => {
    Alert.alert(
      t('settings:deleteAccount.confirmTitle'),
      `${t('settings:deleteAccount.confirmMessage')}\n\n${t('settings:deleteAccount.subscriptionNotice', { store: STORE_NAME })}`,
      [
        { text: t('common:cancel'), style: 'cancel' },
        {
          text: t('settings:deleteAccount.manageSubscription'),
          onPress: () => {
            Linking.openURL(STORE_SUBSCRIPTIONS_URL).catch(() => {});
          },
        },
        {
          text: t('settings:deleteAccount.confirm'),
          style: 'destructive' as const,
          onPress: async () => {
            await cancelAllNotifications().catch(() => {});
            const { error } = await deleteAccount();
            if (error) {
              Alert.alert(
                t('settings:deleteAccount.errorTitle'),
                t('settings:deleteAccount.errorMessage')
              );
            }
            // En cas de succès, AuthContext remet user/profile à null
            // → _layout.tsx redirige automatiquement vers /(auth)/welcome
          },
        },
      ]
    );
  }, [t, deleteAccount]);
}
