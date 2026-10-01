import { Stack } from 'expo-router';
import { OnboardingProvider } from '@/contexts/OnboardingContext';

export default function OnboardingLayout() {
  return (
    <OnboardingProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="start" />
        {/* Pas d'animation de stack : l'arrivée est couverte par le voile orange du zoom
            (le slide par défaut jouait SOUS le voile → cafouillage visuel en fin de zoom). */}
        <Stack.Screen name="name" options={{ animation: 'none' }} />
        <Stack.Screen name="date-of-birth" />
        <Stack.Screen name="gender" />
        <Stack.Screen name="traits" />
        <Stack.Screen name="mood" />
        <Stack.Screen name="energy" />
        <Stack.Screen name="concerns" />
        <Stack.Screen name="stress" />
        <Stack.Screen name="talk-to" />
        <Stack.Screen name="openness" />
        <Stack.Screen name="goals" />
        <Stack.Screen name="pride" />
        <Stack.Screen name="understood" />
        {/* Moments cinématiques : fondus, pas de slide. */}
        <Stack.Screen name="analysis" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="reveal" options={{ animation: 'fade' }} />
        <Stack.Screen name="meet" options={{ animation: 'fade', gestureEnabled: false }} />
        {/* Arrivée couverte par le voile orange du zoom (depuis le bouton Envoyer du
            chat, au sixième envoi) → pas d'animation de stack. */}
        <Stack.Screen name="gift" options={{ animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="trial-intro" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="paywall" options={{ gestureEnabled: false }} />
        {/* Sortie d'un abonnement terminé, ouverte par la croix du paywall.
            Modale : elle se referme par un glissé vers le bas, donc on ne peut
            pas s'y retrouver coincé. Voir account.tsx. */}
        <Stack.Screen name="account" options={{ presentation: 'modal' }} />
      </Stack>
    </OnboardingProvider>
  );
}
