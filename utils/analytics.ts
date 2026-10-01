/**
 * PostHog — initialisation du SDK et helpers de mesure.
 *
 * Même forme que utils/purchases.ts : un singleton, un drapeau `configured`, et
 * un silence complet si la configuration manque. Aucun contexte React : l'ordre
 * de montage entre AuthProvider et PurchasesProvider n'a alors pas à être arbitré.
 *
 * RÈGLE ABSOLUE — aucun contenu personnel ne sort de l'app. Jamais le texte d'un
 * message à Lucy, jamais une note d'humeur, jamais un prénom, jamais un e-mail.
 * Uniquement des clés d'option, des compteurs et des durées. Toute propriété
 * ajoutée ici doit pouvoir être lue par un inconnu sans rien apprendre de la
 * personne.
 */

import { AccessibilityInfo, PixelRatio, Platform } from 'react-native';
import PostHog from 'posthog-react-native';
import type { PostHogEventProperties } from '@posthog/core';

/**
 * Le type de propriétés du SDK : uniquement du JSON sérialisable. Volontairement
 * repris tel quel plutôt qu'un Record<string, unknown> plus souple — c'est lui
 * qui fait échouer la compilation si on tente de joindre un objet arbitraire
 * (un message, un profil) à un événement.
 */
export type EventProperties = PostHogEventProperties;

let client: PostHog | null = null;

/**
 * Réglages d'accessibilité du système, relus au démarrage et à chaque changement.
 *
 * NE SONT PLUS COLLECTÉS : `screen_reader_enabled` et `invert_colors_enabled`.
 * Ces deux réglages ne se règlent pas par confort — ils signalent une cécité ou
 * une malvoyance, et Apple range le handicap dans les « informations
 * sensibles » de ses étiquettes de confidentialité. Les envoyer imposait de
 * cocher la case la plus lourde de la liste pour un signal inexploitable à
 * cette échelle. Ne pas les rétablir sans mettre à jour la fiche App Store.
 *
 * Ce qui reste — taille du texte, gras, animations réduites — relève du confort
 * de lecture d'une large population et ne dit rien d'un handicap.
 *
 * Volontairement des propriétés d'ÉVÉNEMENT et non de personne. On s'en sert
 * pour segmenter des moyennes (« les gens en très gros caractères
 * abandonnent-ils davantage sur l'écran à quinze options ? »), jamais pour
 * constituer un profil rattaché à une identité.
 *
 * Elles sont recopiées en propriétés persistantes du SDK par
 * registerCommonProperties() — ce qui reste du niveau ÉVÉNEMENT : `register`
 * n'écrit rien sur la personne.
 */
let a11y: EventProperties = {};

export function isAnalyticsConfigured() {
  return client !== null;
}

export function configureAnalytics() {
  if (client) return;

  const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;

  // Le host est EXIGÉ, sans repli. Le défaut du SDK pointe sur le cloud
  // américain : un repli silencieux enverrait les rejeux d'écran aux États-Unis
  // alors que le projet a été créé à Francfort, et la région d'un projet
  // PostHog n'est pas migrable. Mieux vaut ne rien mesurer que mesurer au
  // mauvais endroit.
  if (!apiKey || !host) {
    console.warn(
      '[analytics] EXPO_PUBLIC_POSTHOG_KEY ou EXPO_PUBLIC_POSTHOG_HOST manquante dans .env — mesure désactivée',
    );
    return;
  }

  try {
    client = new PostHog(apiKey, {
      host,
      // Cycle de vie de l'app : « Application Opened », « Application
      // Backgrounded »… C'est ce qui permet de mesurer l'abandon du paywall,
      // qui est dur et ne se quitte donc que par la mise en arrière-plan.
      captureAppLifecycleEvents: true,
      enableSessionReplay: true,
      sessionReplayConfig: {
        // Les trois masquages sont déjà à true par défaut. On les réaffirme
        // ici : ce sont eux qui rendent le rejeu acceptable sur une app de
        // confidences, ils ne doivent jamais tomber par accident lors d'une
        // montée de version du SDK.
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        // Ces deux-là sont à true par défaut, et c'est le vrai danger.
        // captureLog embarquerait les console.warn qui entourent l'auth et les
        // achats ; captureNetworkTelemetry (iOS) embarquerait les URL du
        // backend Lucy.
        captureLog: false,
        captureNetworkTelemetry: false,
        // TOUTES les sessions. L'échantillonnage n'a de sens qu'au-delà de
        // quelques milliers de rejeux par mois — l'offre gratuite en couvre
        // 5 000. En dessous, il ne fait que rendre le débogage aléatoire : on
        // ne peut pas retrouver la session de la personne qui vient d'écrire.
        // À rebaisser le jour où le volume approchera du plafond.
        sampleRate: 1.0,
      },
      // Notifications : l'app n'envoie que des rappels LOCAUX (voir
      // utils/notificationService.ts). Il n'y a donc aucun jeton distant que
      // PostHog aurait à connaître, et ces deux options sont à true par défaut.
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
    });
  } catch (e) {
    console.warn('[analytics] configuration PostHog impossible :', e);
    return;
  }

  // getFontScale est synchrone : posé tout de suite, il évite que les tout
  // premiers événements d'une session partent sans aucune donnée
  // d'accessibilité. Les booléens, eux, se lisent de façon asynchrone.
  a11y = { font_scale: Math.round(PixelRatio.getFontScale() * 100) / 100 };
  registerCommonProperties();
  unregisterRetiredProperties();
  refreshAccessibilityProperties();
}

/**
 * Attache des propriétés à la PERSONNE, pas à l'événement.
 *
 * Réservé aux réponses du quiz d'onboarding : ce sont elles qui permettent de
 * filtrer l'entonnoir du paywall — et tout événement ultérieur — par le profil.
 * Les réglages d'accessibilité, eux, restent délibérément au niveau de
 * l'événement : voir le commentaire de `a11y`.
 */
export function setPersonProperties(properties: EventProperties) {
  if (!client) return;
  try {
    client.setPersonProperties(properties);
  } catch (e) {
    console.warn('[analytics] setPersonProperties :', e);
  }
}

/**
 * Relit les réglages d'accessibilité du système. Appelé à l'initialisation puis
 * à chaque bascule : quelqu'un peut activer VoiceOver en cours de parcours.
 */
export async function refreshAccessibilityProperties() {
  try {
    const [reduceMotion, boldText] = await Promise.all([
      AccessibilityInfo.isReduceMotionEnabled(),
      Platform.OS === 'ios' ? AccessibilityInfo.isBoldTextEnabled() : Promise.resolve(false),
    ]);
    a11y = {
      reduce_motion_enabled: reduceMotion,
      bold_text_enabled: boldText,
      font_scale: Math.round(PixelRatio.getFontScale() * 100) / 100,
    };
  } catch {
    // Un réglage illisible ne doit jamais empêcher la mesure du reste.
    a11y = {};
  }
  // Toute écriture de `a11y` doit être suivie d'un réenregistrement, sinon les
  // événements du SDK garderaient la valeur d'avant la bascule. Le `register`
  // fusionne : après un échec de lecture, les événements du SDK conservent la
  // dernière valeur lue plutôt que de repartir sans rien.
  registerCommonProperties();
}

/**
 * Propriétés jointes à CHAQUE événement émis par ce module.
 *
 * Posées explicitement plutôt que par registerForSession : ces propriétés de
 * session sautent quand PostHog en ouvre une nouvelle (30 min d'inactivité),
 * et une donnée d'accessibilité manquante sur la moitié des événements rendrait
 * toute segmentation fausse sans prévenir.
 */
function commonProperties(): EventProperties {
  return {
    environment: __DEV__ ? 'development' : 'production',
    ...a11y,
  };
}

/**
 * Recopie les mêmes propriétés en propriétés PERSISTANTES du SDK.
 *
 * Indispensable pour les événements que le SDK émet lui-même — « Application
 * Opened », « Application Backgrounded », `$identify` — qui ne passent pas par
 * track() et repartaient donc nus. Un entonnoir démarrant sur « Application
 * Opened » perdait sa première étape dès qu'on le filtrait sur `environment`,
 * et toute ventilation par accessibilité s'y effondrait sur un godet vide.
 *
 * `register` et non `registerForSession` : celles-ci sont écrites dans le
 * stockage et survivent aux rotations de session comme aux redémarrages.
 *
 * commonProperties() reste en place dans track() et trackScreen() : le SDK
 * donne la priorité aux propriétés de l'appel sur les persistantes, la double
 * pose est donc purement additive et ne peut rien écraser.
 *
 * Seul angle mort : au tout premier lancement d'une installation, « Application
 * Installed » et « Application Opened » sont mis en file par le constructeur
 * avant que ce register n'aboutisse. Un événement par personne, une seule fois.
 *
 * Piège d'entretien : register FUSIONNE. Retirer une clé de commonProperties()
 * ne la retirera pas des installations existantes, où elle restera figée à sa
 * dernière valeur. Une clé qu'on abandonne demande un unregister explicite.
 */
function registerCommonProperties() {
  if (!client) return;
  try {
    // register() est asynchrone, contrairement à capture() et reset() : un
    // try/catch seul ne rattraperait pas son rejet, qui remonterait en
    // « unhandled promise rejection » sous les yeux de l'utilisateur. Le .catch
    // est donc obligatoire ici, et le try ne couvre que l'appel lui-même.
    void client.register(commonProperties()).catch((e: unknown) => {
      console.warn('[analytics] register :', e);
    });
  } catch (e) {
    console.warn('[analytics] register :', e);
  }
}

/**
 * Clés persistantes abandonnées, à effacer du stockage des installations déjà
 * en service.
 *
 * `register` FUSIONNE : les retirer de commonProperties() ne suffit pas. Sur un
 * téléphone où l'app a déjà tourné, elles resteraient figées à leur dernière
 * valeur et continueraient de partir sur chaque événement émis par le SDK —
 * précisément la donnée de handicap qu'on veut cesser d'envoyer.
 *
 * `register` et `unregister` font tous deux une lecture-modification-écriture
 * synchrone sur le même objet en mémoire (voir posthog-core-stateless). L'ordre
 * des appels est donc l'ordre des effets, et un seul passage au démarrage
 * suffit : rien ne réécrit ces clés ensuite.
 *
 * Retirer ce bloc quand le parc aura tourné — disons septembre 2027.
 */
const RETIRED_PROPERTIES = ['screen_reader_enabled', 'invert_colors_enabled'] as const;

function unregisterRetiredProperties() {
  if (!client) return;
  for (const key of RETIRED_PROPERTIES) {
    try {
      void client.unregister(key).catch((e: unknown) => {
        console.warn(`[analytics] unregister « ${key} » :`, e);
      });
    } catch (e) {
      console.warn(`[analytics] unregister « ${key} » :`, e);
    }
  }
}

/** Émet un événement. Silencieux si la configuration manque. */
export function track(event: string, properties?: EventProperties) {
  if (!client) return;
  try {
    client.capture(event, { ...commonProperties(), ...properties });
  } catch (e) {
    console.warn(`[analytics] capture « ${event} » :`, e);
  }
}

/**
 * Vue d'écran.
 *
 * expo-router n'expose pas le NavigationContainer de react-navigation, donc la
 * capture automatique du SDK ne peut pas fonctionner : elle est désactivée et
 * les écrans sont émis à la main depuis RootLayoutNav.
 */
export function trackScreen(screenName: string, properties?: EventProperties) {
  if (!client) return;
  try {
    client.screen(screenName, { ...commonProperties(), ...properties });
  } catch (e) {
    console.warn('[analytics] capture d’écran :', e);
  }
}

/**
 * Rattache les événements au compte.
 *
 * L'identifiant est celui de Supabase — LE MÊME que l'App User ID passé à
 * RevenueCat (voir contexts/PurchasesContext.tsx). Sans cette égalité, les
 * événements d'abonnement remontés par l'intégration RevenueCat atterrissent
 * sur une personne différente de celle qui a traversé l'onboarding, et plus
 * aucun entonnoir ne se recoupe.
 */
export function identifyUser(userId: string, properties?: EventProperties) {
  if (!client) return;
  try {
    client.identify(userId, properties);
  } catch (e) {
    console.warn('[analytics] identify :', e);
  }
}

/**
 * Déconnexion : les événements suivants repartent sur une identité anonyme.
 *
 * reset() vide TOUT le stockage du SDK, propriétés persistantes comprises. Sans
 * le réenregistrement qui suit, les événements du SDK repartiraient sans
 * `environment` ni accessibilité jusqu'au prochain démarrage — configureAnalytics()
 * ne se rejoue pas, son garde `if (client) return` y veille.
 */
export function resetAnalytics() {
  if (!client) return;
  try {
    client.reset();
  } catch (e) {
    console.warn('[analytics] reset :', e);
  }
  registerCommonProperties();
}

/** Force l'envoi immédiat. Utile avant une action qui peut tuer l'app. */
export function flushAnalytics() {
  if (!client) return;
  try {
    client.flush();
  } catch {
    // Un envoi manqué se rattrape au prochain lot.
  }
}

/**
 * Surveille les bascules d'accessibilité pendant la vie de l'app.
 *
 * Encapsulé ici pour qu'aucun écran n'ait à importer AccessibilityInfo pour des
 * raisons de mesure. Retourne la fonction de désabonnement.
 */
export function watchAccessibilityChanges(): () => void {
  // Plus d'écoute de « screenReaderChanged » : ce réglage n'est plus collecté.
  const subscriptions = [
    AccessibilityInfo.addEventListener('reduceMotionChanged', () => {
      refreshAccessibilityProperties();
    }),
  ];
  return () => subscriptions.forEach((s) => s.remove());
}
