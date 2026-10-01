/**
 * Écran d'attente de confirmation d'adresse.
 *
 * Le lien de l'email ouvre une page web, pas l'app : quand l'utilisateur revient
 * ici de lui-même, l'écran doit avoir compris que c'est fait, sans qu'il ait à
 * chercher quoi faire.
 *
 * Il n'existe pas de moyen d'interroger Supabase là-dessus sans être connecté :
 * `signUp` ne renvoie pas de session tant que l'adresse n'est pas validée. On
 * retente donc une connexion avec les identifiants gardés en mémoire par
 * AuthContext — si elle passe, c'est que l'adresse est confirmée, et le layout
 * racine redirige tout seul vers l'onboarding.
 *
 * Deux déclencheurs plutôt qu'un : le retour au premier plan couvre le cas
 * courant, le bouton couvre celui où iOS n'émet pas de transition (retour depuis
 * Mail sans que l'app soit passée en arrière-plan).
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useAuth } from '@/contexts/AuthContext';
import { track } from '@/utils/analytics';

export default function EmailConfirmationScreen() {
  const { t } = useTranslation(['auth']);
  const { retryPendingSignIn } = useAuth();
  const [checking, setChecking] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const check = React.useCallback(
    async (silent: boolean) => {
      if (!silent) {
        setChecking(true);
        setFailed(false);
      }
      const { confirmed } = await retryPendingSignIn();
      if (!silent) {
        setChecking(false);
        // En cas de succès, la redirection est pilotée par _layout.tsx : inutile
        // de naviguer ici, et l'écran est démonté avant que l'état ne s'affiche.
        if (!confirmed) setFailed(true);
      }
    },
    [retryPendingSignIn],
  );

  // Le mur le plus haut du parcours : une confirmation par e-mail exigée avant
  // que quiconque ait vu la valeur de l'app. Croisé avec `signup_completed`,
  // cet événement chiffre exactement combien de gens s'y perdent.
  React.useEffect(() => {
    track('email_confirmation_pending');
  }, []);

  // Vérification discrète au retour au premier plan : si ça a marché, l'écran
  // disparaît de lui-même ; sinon rien ne bouge et aucun message d'échec ne
  // s'affiche, l'utilisateur n'ayant rien demandé.
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check(true);
    });
    return () => sub.remove();
  }, [check]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <Animated.View entering={FadeIn.delay(200)} style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Mail size={48} color="#F97316" strokeWidth={2} />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(400)} style={styles.textContainer}>
            <Text style={styles.title}>{t('auth:emailConfirmation.title')}</Text>
            <Text style={styles.subtitle}>{t('auth:emailConfirmation.subtitle')}</Text>
            <Text style={styles.description}>{t('auth:emailConfirmation.description')}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(550)} style={styles.actionContainer}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                checking && styles.buttonDisabled,
              ]}
              onPress={() => check(false)}
              disabled={checking}
            >
              {checking ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{t('auth:emailConfirmation.confirmed')}</Text>
              )}
            </Pressable>

            {failed ? (
              <Animated.Text entering={FadeIn.duration(200)} style={styles.error}>
                {t('auth:emailConfirmation.notYet')}
              </Animated.Text>
            ) : null}
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    marginBottom: 32,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
  },
  actionContainer: {
    marginTop: 40,
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 14,
  },
  button: {
    alignSelf: 'stretch',
    backgroundColor: '#F97316',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  buttonPressed: {
    backgroundColor: '#EA580C',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    color: '#EF4444',
    textAlign: 'center',
  },
});
