import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PurchasesProvider, usePurchases } from '@/contexts/PurchasesContext';
import { hasReachedWall, isPaywallRequired } from '@/constants/chatGate';
import i18n from '@/utils/i18n';
import { scheduleNotificationChain, skipTonightReminderIfAlreadyTalked } from '@/utils/notificationService';
import {
  configureAnalytics,
  identifyUser,
  resetAnalytics,
  track,
  trackScreen,
  watchAccessibilityChanges,
} from '@/utils/analytics';

/** Au-delà, un compte qui se connecte est un retour, pas une inscription. */
const SIGNUP_WINDOW_MS = 30 * 60 * 1000;

// Le splash natif reste affiché jusqu'à ce que la session soit résolue, puis part
// en fondu au lieu de se couper net. Sans preventAutoHideAsync, iOS le retire dès
// que le bundle JS est prêt — donc avant que AuthContext sache où rediriger, d'où
// un écran blanc intercalaire.
// `fade` est iOS-only et vaut false par défaut (expo-splash-screen 31).
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 400, fade: true });

let splashHidden = false;
function hideSplash() {
  if (splashHidden) return;
  splashHidden = true;
  SplashScreen.hideAsync().catch(() => {});
}

// Filet de sécurité, posé ici et non dans un composant : depuis qu'on empêche le
// masquage automatique, un splash jamais masqué bloque l'app pour de bon. Le
// masquage nominal vit dans RootLayoutNav, monté *sous* AuthProvider — si ce
// dernier échoue à s'initialiser (Supabase injoignable), rien ne le monterait et
// personne n'appellerait hideAsync. Au niveau module, ce timeout part quoi qu'il
// arrive.
setTimeout(hideSplash, 6000);

function RootLayoutNav() {
  const { user, profile, loading } = useAuth();
  const { customerInfo, customerInfoResolved } = usePurchases();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const appState = useRef(AppState.currentState);
  // Dernier écran émis, pour ne pas compter deux fois le même : la chaîne de
  // redirection ci-dessous fait des router.replace successifs, et une même
  // route peut se présenter plusieurs fois d'affilée.
  const lastScreen = useRef<string | null>(null);
  // Identité déjà transmise à PostHog. Sert à ne réinitialiser que sur une VRAIE
  // déconnexion : sans elle, chaque lancement d'app hors session appellerait
  // reset() et fabriquerait un nouvel identifiant anonyme, ce qui casserait le
  // suivi de tout le parcours d'avant-inscription.
  const identified = useRef<string | null>(null);

  // Mesure — configuration au tout premier montage, avant toute redirection.
  // Reste inerte tant que les variables PostHog manquent au .env.
  useEffect(() => {
    configureAnalytics();
    return watchAccessibilityChanges();
  }, []);

  // Identité : le MÊME identifiant Supabase que celui donné à RevenueCat, sans
  // quoi les événements d'abonnement et le parcours d'onboarding atterrissent
  // sur deux personnes distinctes et aucun entonnoir ne se recoupe.
  // Extraits de `user` pour que l'effet déclare honnêtement ses dépendances :
  // les deux valeurs sont fixes pour un compte donné, mais les lire à travers
  // l'objet masquerait ce qu'il utilise vraiment.
  const userCreatedAt = user?.created_at;
  const userProvider = user?.app_metadata?.provider;

  useEffect(() => {
    if (loading) return;
    if (user?.id) {
      if (identified.current === user.id) return;
      identified.current = user.id;
      identifyUser(user.id);

      // L'inscription se constate ICI et nulle part ailleurs : c'est le seul
      // point où les trois chemins d'entrée se rejoignent. AuthContext, lui, ne
      // voit qu'un bouton pressé, sans savoir si le compte existait déjà —
      // émettre là-bas comptait chaque inscription Google deux fois, et
      // manquait celles dont l'e-mail était confirmé sur un autre appareil.
      //
      // Un compte tout juste créé signe une inscription. La fenêtre est large
      // pour absorber une confirmation d'e-mail lue ailleurs, et assez courte
      // pour ne jamais requalifier en inscription un retour du lendemain.
      //
      // Et RIEN n'est émis pour un retour : cette ref vit le temps d'un montage,
      // pas d'une session. Un simple lancement d'app avec une session restaurée
      // passe ici, et un `logged_in` posé là suivrait la courbe des ouvertures
      // sans rien dire de plus. Les retours se lisent dans « Application
      // Opened », les tentatives dans `auth_started`.
      const createdAt = userCreatedAt ? Date.parse(userCreatedAt) : NaN;
      if (Number.isFinite(createdAt) && Date.now() - createdAt < SIGNUP_WINDOW_MS) {
        track('signup_completed', { method: userProvider ?? 'unknown' });
      }
    } else if (identified.current) {
      identified.current = null;
      resetAnalytics();
    }
  }, [loading, user?.id, userCreatedAt, userProvider]);

  // Vues d'écran. expo-router n'expose pas le NavigationContainer de
  // react-navigation : la capture automatique du SDK ne peut pas fonctionner,
  // les écrans sont donc émis ici. La garde sur `loading` évite de compter les
  // routes traversées le temps que la session se résolve.
  useEffect(() => {
    if (loading || !pathname || pathname === lastScreen.current) return;
    lastScreen.current = pathname;
    trackScreen(pathname);
  }, [pathname, loading]);

  const triggerSchedule = () => {
    if (profile?.onboarding_completed && profile?.notification_preferences?.enabled) {
      const firstName = profile.first_name || '';
      const lang = i18n.language || 'fr';
      scheduleNotificationChain(firstName, lang).catch(() => {});
    }
  };

  // Schedule on profile load
  useEffect(() => {
    if (!loading && profile?.onboarding_completed) {
      triggerSchedule();
    }
  }, [loading, profile?.onboarding_completed, profile?.notification_preferences?.enabled]);

  // Reschedule when app comes to foreground / check skip when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        triggerSchedule();
      } else if (appState.current === 'active' && nextState.match(/inactive|background/)) {
        if (user?.id) {
          skipTonightReminderIfAlreadyTalked(user.id).catch(() => {});
        }
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [profile, user]);

  // Voir la garde ci-dessous. Calculé ici aussi pour retenir le splash.
  const waitingForPurchases =
    !customerInfoResolved && !customerInfo && hasReachedWall(profile);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboardingGroup = segments[0] === '(onboarding)';
    const inAppGroup = segments[0] === '(app)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/intro');
      return;
    }
    if (user && !profile?.onboarding_completed && !inOnboardingGroup) {
      router.replace('/(onboarding)/start');
      return;
    }
    if (!user || !profile?.onboarding_completed) return;

    // Onboarding terminé (depuis le slider « faire connaissance », voir
    // utils/onboardingCompletion.ts). Trois écrans gardent la main sur leur
    // propre sortie et ne doivent pas être court-circuités :
    //   - meet : il vient d'écrire le profil et navigue lui-même sous le voile ;
    //   - gift et trial-intro : le prélude du mur (sixième envoi), qui mène au paywall.
    const screen = inOnboardingGroup ? segments[1] : undefined;
    const selfNavigating = screen === 'meet' || screen === 'gift' || screen === 'trial-intro';

    // Le paywall barre l'app dans deux cas (constants/chatGate.ts) : abonnement
    // terminé, ou mur tombé sans abonnement. Quand seul le mur est en cause, on
    // attend que RevenueCat ait répondu une première fois : quelqu'un qui s'est
    // abonné au mur verrait sinon le paywall clignoter à chaque démarrage, le
    // temps que son abonnement soit relu.
    if (waitingForPurchases) return;

    if (isPaywallRequired(customerInfo, profile)) {
      // `account` est la sortie du paywall d'un abonnement terminé (déconnexion,
      // suppression de compte — guideline 5.1.1(v)) : il doit être atteignable
      // dans cet état, sinon la garde le renverrait au paywall à l'instant où on
      // l'ouvre. Pour le mur, il n'y a pas de croix : le paywall revient à chaque
      // ouverture, et seul un abonnement rouvre l'app.
      if (screen !== 'paywall' && screen !== 'account' && !selfNavigating) {
        router.replace('/(onboarding)/paywall');
      }
      return;
    }

    if (!inAppGroup && !selfNavigating) {
      router.replace('/(app)');
    }
  }, [user, profile, loading, segments, customerInfo, customerInfoResolved, waitingForPurchases]);

  // Masquage nominal : une fois la session résolue, et seulement après que
  // l'effet de redirection ci-dessus ait eu le temps de poser le bon écran —
  // sinon le fondu révèle l'écran d'accueil avant la bascule. Quelqu'un derrière
  // le mur attend aussi la réponse de RevenueCat (le filet de 6 s reste).
  useEffect(() => {
    if (loading || waitingForPurchases) return;
    const timer = setTimeout(hideSplash, 120);
    return () => clearTimeout(timer);
  }, [loading, waitingForPurchases]);

  // Fondu entre les groupes, jamais de glissement : le passage du chat à l'écran
  // cadeau se fait sous l'orange (disque d'un côté, voile de l'autre), et un
  // glissement latéral s'y voyait — un zoom qui finit en balayage (vidéo de
  // Vincent du 25 septembre 2026). Les autres bascules (connexion, onboarding,
  // achat) y gagnent aussi.
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(app)" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  useFrameworkReady();

  useEffect(() => {
    if (Platform.OS === 'android') {
      SystemUI.setBackgroundColorAsync('transparent');
    }
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, width: '100%', maxWidth: '100%' }}>
        <KeyboardProvider>
          <AuthProvider>
            <PurchasesProvider>
              <RootLayoutNav />
              <StatusBar style="auto" translucent />
            </PurchasesProvider>
          </AuthProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}