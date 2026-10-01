import React from 'react';
import { useTranslation } from 'react-i18next';
import { View } from '@/utils/SafePrimitives';
import { StyleSheet } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import { Header } from '@/components/Header';
import { OrangeTransitionLayer } from '@/components/OrangeTransitionLayer';
import { track } from '@/utils/analytics';

/**
 * Plus de menu latéral : le chat est l'écran d'accueil, et l'humeur comme les
 * réglages s'ouvrent par-dessus, en pages, depuis les deux boutons du header.
 * Le header reste posé au-dessus de la pile et change de contenu selon la page.
 */
export default function AppLayout() {
  const { t } = useTranslation(['mood', 'settings']);
  const router = useRouter();
  const pathname = usePathname();

  const isChat = pathname === '/' || pathname === '';

  const getTitle = () => {
    switch (pathname) {
      case '/mood-tracker':
        return t('mood:title');
      case '/settings':
        return t('settings:title');
      case '/edit-profile':
        return t('settings:myAccount');
      default:
        return '';
    }
  };

  // Une page ouverte directement (notification, lien) n'a rien derrière elle :
  // on retombe alors sur le chat plutôt que de laisser la flèche sans effet.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)');
  };

  return (
    <View style={styles.container}>
      {isChat ? (
        <Header
          variant="chat"
          onMoodPress={() => {
            track('header_navigated', { destination: 'mood-tracker' });
            router.push('/(app)/mood-tracker');
          }}
          onSettingsPress={() => {
            track('header_navigated', { destination: 'settings' });
            router.push('/(app)/settings');
          }}
        />
      ) : (
        <Header
          onBackPress={goBack}
          title={getTitle()}
          titleStyle={pathname === '/settings' ? { fontSize: 22 } : undefined}
        />
      )}
      <Stack screenOptions={{ headerShown: false, contentStyle: styles.screen }} />
      {/* Voile orange d'arrivée (fin du slider) et disque du sixième envoi : par-dessus
          le header comme le fil. Voir utils/orangeTransition.ts. */}
      <OrangeTransitionLayer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    width: '100%',
    maxWidth: '100%',
  },
  screen: {
    backgroundColor: '#FFFFFF',
  },
});
