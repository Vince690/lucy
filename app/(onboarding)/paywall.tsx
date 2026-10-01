/**
 * Paywall — hard paywall de fin d'onboarding, codé maison (réplique de la
 * maquette Figma « Lucy Paywall » validée).
 *
 * RevenueCat n'est plus utilisé pour l'UI (l'import Figma → RevenueCat Paywalls
 * a été abandonné) : il reste le MOTEUR — produits, achat, entitlement,
 * restauration. Étapes branchées progressivement :
 *   Étape 1 (fait) : UI fidèle au design, prix par défaut en dur.
 *   Étape 2 (fait) : prix dynamiques via Purchases.getOfferings() — priceString
 *             localisé, pricePerMonthString, badge « save % » et durée d'essai
 *             (introPrice) calculés depuis l'offering courant. Repli silencieux
 *             sur les prix par défaut si l'offering est indisponible.
 *   Étape 3 (fait) : achat réel (purchasePackage — annulation silencieuse,
 *             erreur signalée) + restauration (restorePurchases, ne complète
 *             l'onboarding que si l'entitlement premium est actif).
 *   Étape 4 (fait) : le paywall est réellement dur sur mobile. Si le package
 *             n'est pas chargé au moment de l'achat, on recharge l'offering une
 *             fois, puis on REFUSE — là où l'on complétait l'onboarding.
 *             Auparavant, une panne RevenueCat, une coupure réseau ou un
 *             produit pas encore prêt côté Apple ouvrait des comptes premium
 *             gratuits, silencieusement et sans trace. Le web garde la
 *             complétion directe : StoreKit n'y existe pas et rien n'y est
 *             vendu.
 *   Étape 5 (fait) : plus aucun prix écrit en dur sur mobile. Tant que le tarif
 *             réel n'est pas connu, son emplacement porte un bandeau de
 *             chargement. Avant, l'écran s'ouvrait sur « $59.99 » puis basculait
 *             sur « 59,99 € » — un Français voyait donc des dollars à chaque
 *             ouverture, et un échec de chargement les laissait à l'écran
 *             indéfiniment. Le web garde des montants indicatifs : l'offering
 *             n'y arrive jamais, des bandeaux figés y seraient pires.
 *   Étape 6 (ceci) : un achat en échec n'est plus une impasse. Apple a rejeté
 *             le build 10 en 2.1(b) le 18 août 2026, capture à l'appui : la
 *             seule alerte « The purchase could not be completed » pour une
 *             douzaine de causes distinctes — dont plusieurs qui ne sont même
 *             pas des échecs. Désormais un achat différé se dit tel quel, un
 *             double appui ne dit plus rien, un abonnement déjà possédé par le
 *             compte Apple déclenche une restauration silencieuse, et tout le
 *             reste vérifie d'abord auprès de RevenueCat que l'entitlement
 *             n'est pas actif avant de refuser. Ce qui échoue vraiment porte
 *             son code RevenueCat à l'écran : c'est la seule trace qui nous
 *             revienne d'un appareil d'App Review. La complétion de
 *             l'onboarding est enfin sortie du try d'achat — sa panne à elle
 *             s'affichait « l'achat n'a pas pu aboutir » à quelqu'un qui
 *             venait d'être débité.
 *
 * RESPONSIVE : l'écran doit tenir SANS scroll du iPhone SE au Pro Max. Toutes
 * les dimensions verticales passent par `rs()` — un facteur d'échelle dérivé de
 * la hauteur de l'écran (référence : 852 pt, iPhone 16). Le CTA, lui, garde sa
 * taille pleine sur tous les écrans (c'est l'élément à ne jamais rapetisser).
 * Le ScrollView reste en filet de sécurité (polices système agrandies, etc.).
 *
 *   Étape 7 (23 septembre 2026) : le paywall ne complète plus l'onboarding.
 *             Celui-ci se termine au bout du slider « faire connaissance »
 *             (utils/onboardingCompletion.ts) et la personne entre dans la
 *             vraie app avec cinq échanges offerts (constants/chatGate.ts). On
 *             arrive ici dans deux cas seulement : le MUR (sixième envoi, via
 *             cadeau → frise) et l'ABONNEMENT TERMINÉ. Après un achat ou une
 *             restauration, il n'y a plus qu'à relire l'état RevenueCat : c'est
 *             lui qui rouvre la porte (garde de la racine).
 *
 * Pas de croix pour le mur : le paywall revient à chaque ouverture, et seul un
 * abonnement rouvre l'app. La croix n'existe que pour un abonnement terminé.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Heart, MessageCircle, ShieldCheck, TrendingUp, X } from 'lucide-react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  PURCHASES_ERROR_CODE,
  PurchasesError,
  PurchasesIntroPrice,
  PurchasesPackage,
} from 'react-native-purchases';
import { hasBillingIssue, hasPremium, isPurchasesConfigured } from '@/utils/purchases';
import { track } from '@/utils/analytics';
import { usePurchases } from '@/contexts/PurchasesContext';
import { useAuth } from '@/contexts/AuthContext';
import { isPaywallRequired } from '@/constants/chatGate';
import { getPermissionStatus } from '@/utils/notificationService';
import { STORE_NAME } from '@/utils/store';
import { OnbColors, OnbRadius, OnbShadow, OnbSpacing } from '@/constants/onboardingTheme';
import { LUCY_AVATAR_CROP } from '@/constants/lucyAvatar';

/**
 * Données d'affichage d'une formule — prix formaté dans la devise de
 * l'utilisateur et durée d'essai. Le `pkg` (package RevenueCat) sert à
 * l'achat réel.
 *
 * `price` à `null` signifie « prix encore inconnu ». On affiche alors un
 * bandeau de chargement à sa place, JAMAIS un montant : un chiffre écrit en dur
 * ne peut pas être localisé, et en montrer un reviendrait à annoncer à un
 * Français un tarif en dollars qui ne lui sera jamais facturé.
 *
 * `trialDays` à `null` signifie « pas d'essai gratuit pour CETTE personne sur
 * CETTE formule ». Aucune valeur de repli : il n'existe pas de durée d'essai
 * plausible par défaut. Promettre des jours offerts qui ne seront pas accordés
 * est un bait-and-switch, nommé tel quel par la règle App Store 3.1.2(a).
 */
type PlanOffer = {
  price: string | null;
  pkg: PurchasesPackage | null;
  trialDays: number | null;
};

type LivePlans = {
  yearly: PlanOffer & { perMonth: string | null; savePercent: number };
  monthly: PlanOffer;
};

/**
 * Où en est le chargement de l'offering RevenueCat.
 *
 * `error` existe pour que l'écran puisse ÉCHOUER VISIBLEMENT. Sans cet état,
 * une panne laissait des bandeaux de chargement tourner indéfiniment : rien à
 * lire, rien à toucher, aucune sortie. Un testeur d'Apple tombé là-dedans ne
 * voit jamais l'application (règle 2.1).
 */
type OfferingsState = 'loading' | 'ready' | 'error';

/**
 * Délai au-delà duquel un offering qui n'est pas revenu est considéré perdu.
 * `getOfferings()` n'a pas de timeout propre : sur un réseau qui accepte la
 * connexion sans jamais répondre, la promesse ne se résout pas.
 */
const OFFERINGS_TIMEOUT_MS = 12_000;

/**
 * Idem pour le contrôle d'éligibilité à l'essai. Plus court que l'offering :
 * RevenueCat le calcule à partir d'informations qu'il détient déjà, et ce
 * contrôle s'ajoute à une attente déjà consentie. Dépassé, on n'écarte aucun
 * essai — voir productsWithSpentTrial().
 */
const ELIGIBILITY_TIMEOUT_MS = 5_000;

/**
 * Relecture de l'état RevenueCat après un achat abouti. Sans timeout propre, sur
 * un réseau qui accepte la connexion sans jamais répondre, l'overlay plein écran
 * resterait posé pour toujours — sur quelqu'un qui vient d'être débité. Le
 * dépassement se traverse en silence : le listener du SDK finira par remonter
 * l'état, et la garde de la racine ouvrira l'app.
 */
const SIDE_STEP_TIMEOUT_MS = 10_000;

/**
 * Rattrapages après un achat en échec apparent. Deux délais, parce que les deux
 * appels n'ont rien à voir.
 *
 * Le contrôle d'entitlement est TRÈS court : RevenueCat le sert de son cache
 * local, et il s'insère entre l'échec et le message d'erreur — c'est-à-dire
 * pendant que quelqu'un fixe un bouton qui tourne, sans rien savoir. Le tenir
 * là huit secondes rendrait l'échec pire qu'avant ce rattrapage : « rien ne
 * s'est passé quand nous avons appuyé » est exactement la formulation des
 * rejets 2.1(b) qu'on cherche à éviter.
 *
 * La restauration, elle, est une vraie opération réseau + StoreKit, et elle
 * n'intervient que là où elle est le geste attendu (abonnement déjà possédé) :
 * elle a droit à son temps.
 */
const ENTITLEMENT_CHECK_TIMEOUT_MS = 3_500;
const RESTORE_RECOVERY_TIMEOUT_MS = 8_000;

// DIAGNOSTIC — si le paywall affiche une devise inattendue, par exemple des
// dollars sur un appareil français, l'app n'y est pour rien : elle affiche
// `product.priceString`, la chaîne que StoreKit fabrique pour la boutique de
// l'utilisateur. Vérifier dans cet ordre :
//
//   1. EST-CE UN BUILD TESTFLIGHT OU BAC À SABLE ? C'est la cause la plus
//      fréquente, et elle ne concerne PAS la production. Dans ces
//      environnements, la requête de métadonnées produit renvoie souvent des
//      dollars quelle que soit la boutique. Un ingénieur d'Apple le confirme
//      sur developer.apple.com/forums/thread/705895 : « for Sandbox you can
//      create sandbox tester for any storefront, when signed in on the device
//      the responses will match their storefront priceLocale. » Autrement dit,
//      pour voir des euros en test, il faut un compte de test bac à sable dont
//      le pays est la France, connecté sur l'appareil.
//
//   2. Le pays du COMPTE Apple (Réglages → votre nom → Média et achats → Voir
//      le compte → Pays/Région). C'est lui qui fixe la boutique StoreKit, PAS
//      la langue ni la région de l'iPhone.
//
//   3. La grille de tarification par territoire, dans App Store Connect.
//
// Un bandeau de chargement qui ne se remplit jamais, lui, ne dit pas « mauvaise
// devise » mais « offering pas chargé » : voir les avertissements PRIX INCONNUS.

/** Prix inconnus : état de départ sur mobile, et état conservé si l'offering
 *  n'aboutit pas. Les montants apparaissent en bandeaux de chargement. */
const UNKNOWN_PLANS: LivePlans = {
  yearly: { price: null, perMonth: null, savePercent: 0, pkg: null, trialDays: null },
  monthly: { price: null, pkg: null, trialDays: null },
};

/** Web uniquement : StoreKit n'y existe pas, l'offering n'arrivera jamais et
 *  rien n'y est vendu. Des bandeaux figés y tiendraient lieu de prix pour
 *  toujours, ce qui serait pire qu'un montant indicatif. Ces valeurs ne sont
 *  jamais facturées à personne — c'est une maquette. */
const WEB_PREVIEW_PLANS: LivePlans = {
  yearly: { price: '$59.99', perMonth: '$5.00', savePercent: 67, pkg: null, trialDays: 7 },
  monthly: { price: '$14.99', pkg: null, trialDays: 7 },
};

const INITIAL_PLANS: LivePlans =
  Platform.OS === 'web' ? WEB_PREVIEW_PLANS : UNKNOWN_PLANS;

type PlanId = 'yearly' | 'monthly';

/**
 * Détail lisible d'une erreur RevenueCat, lu SANS supposer sa forme.
 *
 * `e as PurchasesError` est un transtypage, pas une vérification : si le pont
 * natif rejette une Error nue, ou si la déstructuration du résultat d'achat
 * échoue, `code` n'existe tout simplement pas et le filtre d'annulation devient
 * faux. On lit donc défensivement.
 *
 * Le code est aussi REMONTÉ À L'ÉCRAN. Le rejet App Store 2.1(b) du 18 août
 * 2026 est arrivé avec une capture de l'alerte générique « The purchase could
 * not be completed » : elle ne disait rien du motif, et rien dans la console
 * d'un examinateur ne nous revient. Un code affiché rend la prochaine capture
 * diagnostique.
 */
function describePurchasesError(e: unknown): {
  code: string | null;
  readable: string;
  message: string;
} {
  const err = (e ?? {}) as Partial<PurchasesError> & { message?: string };
  const code = typeof err.code === 'string' ? err.code : null;
  const readable =
    err.userInfo?.readableErrorCode ??
    err.readableErrorCode ??
    (code !== null ? `CODE_${code}` : 'NO_CODE');
  const message =
    [err.message, err.underlyingErrorMessage].filter(Boolean).join(' — ') || String(e);
  return { code, readable, message };
}

/** Borne une promesse sans timeout propre. Rejette au-delà du délai. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout après ${ms} ms`)), ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** Durée d'essai gratuit (en jours) portée par l'introPrice du produit, ou null
 *  si le produit n'a pas d'essai gratuit. */
function trialDaysFromIntro(intro: PurchasesIntroPrice | null): number | null {
  if (!intro || intro.price !== 0) return null;
  const units = intro.periodNumberOfUnits;
  switch (intro.periodUnit) {
    case 'DAY':
      return units;
    case 'WEEK':
      return units * 7;
    case 'MONTH':
      return units * 30;
    default:
      return null;
  }
}

/**
 * Écarte les essais gratuits que cette personne ne peut PLUS obtenir.
 *
 * `introPrice` décrit le produit, pas le droit de l'utilisateur : il reste
 * renseigné pour quelqu'un qui a déjà consommé ses jours offerts. Sans ce
 * filtre, cette personne relit « 7 jours offerts » puis se fait débiter au
 * premier appui — exactement le bait-and-switch que 3.1.2(a) proscrit.
 *
 * Retourne les identifiants produit à qui l'essai doit être RETIRÉ.
 *
 * Choix délibéré : on ne retire que sur un `INELIGIBLE` ferme. RevenueCat
 * conseille d'être plus strict et de retirer aussi sur `UNKNOWN`, mais
 * `UNKNOWN` signifie « je ne sais pas » (groupe d'abonnement incomplet, iOS
 * ancien) et non « pas droit » ; Android le renvoie même toujours. Traiter le
 * doute comme un refus effacerait l'essai chez des gens parfaitement éligibles.
 * Le cas qui expose vraiment — l'essai déjà consommé — remonte, lui, en
 * `INELIGIBLE` franc.
 */
async function productsWithSpentTrial(productIds: string[]): Promise<Set<string>> {
  const spent = new Set<string>();
  if (productIds.length === 0) return spent;

  try {
    // Borné, comme getOfferings : un appel au pont natif qui ne rappelle jamais
    // ne rejette pas non plus. Sans ce timeout, l'`await` bloquerait pour
    // toujours, `setPlans` ne serait jamais atteint et l'écran resterait sur des
    // bandeaux de chargement — précisément la panne muette que l'état d'erreur
    // est censé avoir supprimée.
    const eligibility = await withTimeout(
      Purchases.checkTrialOrIntroductoryPriceEligibility(productIds),
      ELIGIBILITY_TIMEOUT_MS,
    );
    for (const [productId, verdict] of Object.entries(eligibility)) {
      if (verdict?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE) {
        spent.add(productId);
      }
    }
  } catch (e) {
    // Injoignable : on ne retire rien. Voir le choix délibéré ci-dessus.
    console.warn('[paywall] éligibilité essai indisponible — essais laissés tels quels :', e);
  }

  return spent;
}

/** Hauteur de référence du design Figma (iPhone 16). */
const DESIGN_HEIGHT = 852;

/**
 * Souci de paiement : la fiche de compte monte d'elle-même par-dessus le
 * paywall, une fois celui-ci posé. Le délai laisse son fondu d'arrivée finir :
 * la personne voit le paywall, puis la fiche qui monte — pas deux écrans qui
 * se battent.
 */
const BILLING_SHEET_DELAY_MS = 700;

// Recadrage de l'avatar reproduit À L'IDENTIQUE depuis la maquette Figma
// (matrice du fill CROP), partagé avec le header du chat.
const AVATAR_CROP = LUCY_AVATAR_CROP;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Bandeau gris qui occupe la place d'un montant pas encore connu.
 *
 * Il fait la largeur qu'occupera le prix, si bien que rien ne bouge quand le
 * vrai montant s'y substitue — pas de saut de mise en page. C'est ce qui permet
 * de ne jamais afficher un chiffre en dur : mieux vaut une place réservée qu'un
 * tarif dans la mauvaise devise.
 */
function PriceSkeleton({
  width,
  height,
  boxHeight,
}: {
  width: number;
  height: number;
  /** Hauteur de la ligne de texte remplacée. Le bandeau y est centré, si bien
   *  que la carte garde exactement la même hauteur une fois le prix arrivé. */
  boxHeight?: number;
}) {
  const bar = (
    <View
      style={[styles.skeleton, { width, height, borderRadius: Math.round(height / 3) }]}
    />
  );
  if (boxHeight == null) return bar;
  return <View style={{ height: boxHeight, justifyContent: 'center' }}>{bar}</View>;
}

/**
 * Badge de confiance sous le bouton d'achat — la réponse aux deux peurs qui
 * font fermer l'écran : « je vais être facturé maintenant » et « je vais
 * oublier d'annuler ». Un seul élément, une seule ligne, un seul segment en
 * gras (balisé `__x__` dans la traduction), pour ne pas alourdir la page.
 *
 * Il REMPLACE l'ancienne ligne « 7 jours offerts, puis X. Annulable » : le prix
 * après l'essai descend dans le bloc légal juste dessous, où il reste écrit
 * (Apple demande que la durée de l'essai et le montant facturé ensuite soient
 * indiqués clairement) sans occuper le champ de vision principal.
 *
 * Le rappel n'est promis que si les notifications sont acceptées : sans
 * permission, aucun rappel ne partira, et l'on ne promet rien qu'on ne tient.
 */
function TrustBadge({ text }: { text: string }) {
  const parts = text.split('__');
  const nodes =
    parts.length === 3 ? (
      <>
        {parts[0]}
        <Text style={styles.trustBadgeStrong}>{parts[1]}</Text>
        {parts[2]}
      </>
    ) : (
      text
    );
  return (
    <View style={styles.trustBadge}>
      <ShieldCheck size={15} color={OnbColors.primaryDeep} strokeWidth={2.4} />
      {/* Pas de réduction automatique de police : sur iOS elle peut rendre
          un texte minuscule (voir le sous-titre). Si la phrase ne tient pas
          sur un petit écran, elle passe sur deux lignes, lisible. */}
      <Text style={styles.trustBadgeText} numberOfLines={2}>
        {nodes}
      </Text>
    </View>
  );
}

/**
 * CTA de vente — même ADN que OnboardingButton (dégradé, flèche, enfoncement,
 * haptique) mais « une couche au-dessus » : texte plus gras et dégradé diagonal
 * complet clair → foncé, comme sur la maquette Figma. Sa hauteur suit l'échelle
 * de l'écran pour garder les proportions de la maquette sur toutes les tailles.
 */
function PaywallCTA({
  label,
  height,
  fontSize,
  onPress,
  loading,
}: {
  label: string;
  height: number;
  fontSize: number;
  onPress: () => void;
  loading: boolean;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withTiming(0.97, { duration: 110 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 160 });
      }}
      onPress={() => {
        if (loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      disabled={loading}
      style={[styles.cta, { height }, OnbShadow.button, animatedStyle]}
    >
      <LinearGradient
        colors={['#FB923C', '#F97316', '#EA580C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.ctaGradient}
      />
      {loading ? (
        <ActivityIndicator color={OnbColors.white} />
      ) : (
        <View style={styles.ctaContent}>
          <Text style={[styles.ctaLabel, { fontSize }]}>{label}</Text>
          <ArrowRight size={19} color={OnbColors.white} strokeWidth={2.6} />
        </View>
      )}
    </AnimatedPressable>
  );
}

/**
 * Halo statique et très diffus (maquette Figma : ellipse floutée dans un coin).
 * Dégradé radial qui s'éteint vers 0 — aucune bordure de cercle visible.
 */
function Halo({
  id,
  size,
  color,
  opacity,
  style,
}: {
  id: string;
  size: number;
  color: string;
  opacity: number;
  style: ViewStyle;
}) {
  return (
    <View pointerEvents="none" style={[styles.halo, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="55%" stopColor={color} stopOpacity={opacity * 0.45} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { t } = useTranslation(['onboarding']);
  const { profile, loading: authLoading } = useAuth();
  const { customerInfo, customerInfoResolved, subscriptionLapsed, refreshCustomerInfo } =
    usePurchases();

  const [selectedPlan, setSelectedPlan] = useState<PlanId>('yearly');
  // Le badge ne promet un rappel que si la permission a été accordée sur
  // l'écran précédent (ou avant). Lu une fois au montage : elle ne change pas
  // pendant que cet écran est affiché.
  const [reminderOn, setReminderOn] = useState(false);
  useEffect(() => {
    getPermissionStatus()
      .then((status) => setReminderOn(status === 'granted'))
      .catch(() => {});
  }, []);
  const [plans, setPlans] = useState<LivePlans>(INITIAL_PLANS);
  // Le web n'interroge jamais StoreKit : ses montants de maquette sont déjà là.
  const [offeringsState, setOfferingsState] = useState<OfferingsState>(
    Platform.OS === 'web' ? 'ready' : 'loading',
  );
  const [submitting, setSubmitting] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const completedRef = useRef(false);
  const busy = submitting || purchasing || restoring;

  // Paiement refusé au renouvellement (RevenueCat : billingIssueDetectedAt) :
  // la personne veut payer, elle n'a pas à chercher la croix. La fiche de compte
  // s'ouvre seule, en variante « souci de paiement », avec le bouton vers les
  // abonnements Apple. Une seule fois par présentation du paywall : si elle la
  // referme d'un glissé, on ne la lui remonte pas sous le doigt. La ref n'est
  // posée qu'au moment de pousser, pour qu'un rendu intermédiaire (RevenueCat
  // qui répond en deux temps) ne consomme pas l'unique ouverture.
  const billingSheetShown = useRef(false);
  /**
   * Ouvre la fiche de compte. Toute ouverture — automatique ou par la croix /
   * le lien — pose la ref : une fiche déjà ouverte à la main n'en reçoit pas une
   * seconde par-dessus quand le délai automatique tombe.
   */
  const openAccount = useCallback(
    (params?: { trialDays: string; reminder: string }) => {
      billingSheetShown.current = true;
      router.push({ pathname: '/(onboarding)/account', params });
    },
    [router],
  );
  useEffect(() => {
    if (billingSheetShown.current || !subscriptionLapsed || !hasBillingIssue(customerInfo)) return;
    const timer = setTimeout(() => {
      track('paywall_billing_issue_shown');
      openAccount();
    }, BILLING_SHEET_DELAY_MS);
    return () => clearTimeout(timer);
  }, [subscriptionLapsed, customerInfo, openAccount]);

  // Mesure — le paywall du mur est DUR : il n'y a pas de croix à travers
  // laquelle sortir. L'abandon ne peut donc se lire qu'au moment où l'app passe
  // en arrière-plan, d'où le chrono ouvert dès le montage.
  const paywallShownAt = useRef(Date.now());
  const abandonReported = useRef(false);
  const viewReported = useRef(false);
  const planSwitches = useRef(0);

  // Étape 2 — prix réels et localisés depuis l'offering courant RevenueCat.
  // En cas d'indisponibilité (web, SDK non configuré, réseau), les prix par
  // défaut restent affichés : jamais d'écran vide.
  // Rendue appelable en dehors du montage : l'achat la rejoue une fois si le
  // paquet manque, plutôt que d'ouvrir l'accès sans achat (voir handlePurchase).
  const loadOfferings = useCallback(async (): Promise<LivePlans | null> => {
    if (!isPurchasesConfigured()) {
      console.warn('[paywall] RevenueCat non configuré — PRIX INCONNUS, état d\'erreur affiché');
      track('paywall_offerings_failed', { reason: 'not_configured' });
      setOfferingsState('error');
      return null;
    }
    setOfferingsState('loading');
    try {
      // `getOfferings()` ne porte pas de timeout : sur un réseau qui accepte la
      // connexion sans jamais répondre, la promesse ne se résout pas et l'écran
      // resterait en chargement pour toujours.
      const offerings = await withTimeout(Purchases.getOfferings(), OFFERINGS_TIMEOUT_MS);
      const current = offerings.current ?? null;

      // `offering.annual` et `offering.monthly` ne sont remplis QUE si les
      // paquets portent les identifiants réservés de RevenueCat ($rc_annual,
      // $rc_monthly). Un paquet créé avec un identifiant libre est de type
      // CUSTOM et laisse ces deux champs nuls — d'où un repli silencieux alors
      // que l'offering est parfaitement chargé. On rattrape donc par le type
      // de paquet, qui reste juste dans les deux cas.
      const byType = (type: string) =>
        current?.availablePackages.find((p) => p.packageType === type) ?? null;
      const annual = current?.annual ?? byType('ANNUAL');
      const monthly = current?.monthly ?? byType('MONTHLY');

      if (!annual || !monthly) {
        // On liste ce que RevenueCat a réellement renvoyé : sans cet
        // inventaire, « offering absent » et « paquets mal nommés » se
        // ressemblent trait pour trait, et l'écran est le même dans les deux
        // cas — des bandeaux qui ne se remplissent jamais.
        const inventaire = (current?.availablePackages ?? [])
          .map((p) => `${p.identifier}:${p.packageType}`)
          .join(', ');
        console.warn(
          '[paywall] offering incomplet — PRIX INCONNUS, état d\'erreur affiché. ' +
            `courant=${current?.identifier ?? 'AUCUN'} ` +
            `annual=${annual ? 'ok' : 'MANQUANT'} ` +
            `monthly=${monthly ? 'ok' : 'MANQUANT'} ` +
            `paquets=[${inventaire || 'vide'}]`,
        );
        // Offering chargé mais mal formé : un problème de configuration côté
        // RevenueCat, à ne pas confondre avec un réseau coupé.
        track('paywall_offerings_failed', {
          reason: 'incomplete_offering',
          has_annual: !!annual,
          has_monthly: !!monthly,
          package_count: current?.availablePackages.length ?? 0,
        });
        setOfferingsState('error');
        return null;
      }

      const yearlyPrice = annual.product.price;
      const monthlyPrice = monthly.product.price;
      const computedSave =
        monthlyPrice > 0
          ? Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100)
          : 0;

      // Essai lu sur CHAQUE formule, jamais recopié de l'une à l'autre : rien
      // ne garantit que l'annuel et le mensuel portent la même offre, et c'est
      // la formule sélectionnée qui sera facturée.
      const spentTrial = await productsWithSpentTrial(
        [annual.product.identifier, monthly.product.identifier].filter(Boolean),
      );
      const trialFor = (pkg: PurchasesPackage): number | null =>
        spentTrial.has(pkg.product.identifier)
          ? null
          : trialDaysFromIntro(pkg.product.introPrice);

      const live: LivePlans = {
        yearly: {
          price: annual.product.priceString,
          perMonth: annual.product.pricePerMonthString,
          savePercent: computedSave,
          pkg: annual,
          trialDays: trialFor(annual),
        },
        monthly: {
          price: monthly.product.priceString,
          pkg: monthly,
          trialDays: trialFor(monthly),
        },
      };
      setPlans(live);
      setOfferingsState('ready');
      return live;
    } catch (e) {
      console.warn('[paywall] getOfferings a échoué — PRIX INCONNUS, état d\'erreur affiché :', e);
      // Réseau, panne RevenueCat, ou dépassement du délai d'attente.
      track('paywall_offerings_failed', { reason: 'request_failed' });
      setOfferingsState('error');
      return null;
    }
  }, []);

  useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  // L'onboarding est terminé depuis le slider et ses réponses effacées : le
  // prénom vient du profil.
  const firstName = (profile?.first_name ?? '').trim();

  // Échelle verticale : compresse sur les petits écrans, plafonnée à 1 sur les
  // grands (où l'espace excédentaire est absorbé par les zones extensibles).
  const s = Math.min(Math.max(windowHeight / DESIGN_HEIGHT, 0.78), 1);
  const rs = (value: number) => Math.round(value * s);

  /**
   * Croix de sortie — visible UNIQUEMENT pour un abonnement terminé.
   *
   * Le paywall du mur (échanges offerts épuisés) est dur : pas de croix, le
   * paywall revient à chaque ouverture, seul un abonnement rouvre l'app. Règle
   * de Vincent du 23 septembre 2026, reprise de l'ancien paywall d'onboarding.
   *
   * `subscriptionLapsed` (= a déjà acheté, plus rien d'actif) est exactement la
   * cohorte visée, et il est faux pour qui vient d'acheter comme pour qui n'a
   * jamais acheté. Tant que RevenueCat n'a pas répondu il est faux aussi : la
   * croix arrive alors avec un temps de retard — sans conséquence, là où une
   * croix montrée à tort ouvrirait le paywall.
   */
  const canExit = subscriptionLapsed && !busy;

  // `source` sépare le mur (échanges offerts épuisés, première présentation) du
  // retour forcé après un abonnement terminé. Mélanger les deux dans un taux de
  // conversion le rendrait illisible : ce ne sont pas les mêmes personnes.
  const paywallSource = subscriptionLapsed ? 'lapsed' : 'wall';

  useEffect(() => {
    // `source` se lit dans l'état RevenueCat : émettre avant qu'il soit résolu
    // enregistrerait un ancien abonné comme un primo-arrivant, définitivement.
    // La ref garantit une seule émission malgré l'attente.
    if (authLoading || !customerInfoResolved || viewReported.current) return;
    viewReported.current = true;
    paywallShownAt.current = Date.now();
    track('paywall_viewed', { source: paywallSource });
  }, [authLoading, customerInfoResolved, paywallSource]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      // STRICTEMENT 'background' : iOS passe par 'inactive' dès qu'une feuille
      // système prend le focus — dont la feuille de paiement StoreKit. Compter
      // 'inactive' marquerait en abandon CHAQUE tentative d'achat, juste avant
      // qu'elle aboutisse, et le verrou `abandonReported` ferait ensuite taire
      // le vrai abandon.
      // `completedRef` écarte ceux qui viennent d'acheter : quitter l'app après
      // un achat abouti n'est pas un abandon.
      if (next === 'background' && !completedRef.current && !abandonReported.current) {
        abandonReported.current = true;
        track('paywall_abandoned', {
          source: paywallSource,
          time_on_paywall_ms: Date.now() - paywallShownAt.current,
          plan_selected: selectedPlan,
          offerings_state: offeringsState,
        });
      }
    });
    return () => subscription.remove();
  }, [paywallSource, selectedPlan, offeringsState]);

  // Naviguer dès que la porte est rouverte : c'est l'état RevenueCat qui fait
  // foi (garde de la racine, constants/chatGate.ts). La racine le fait aussi ;
  // ici on ne fait qu'aller plus vite, sans attendre son prochain rendu.
  useEffect(() => {
    if (!authLoading && profile?.onboarding_completed && !isPaywallRequired(customerInfo, profile)) {
      router.replace('/(app)');
    }
  }, [authLoading, profile, customerInfo, router]);

  /**
   * Après un achat abouti ou une restauration concluante : relire l'état
   * RevenueCat. C'est lui qui rouvre la porte — l'onboarding, lui, est terminé
   * depuis le slider. Rien à écrire dans le profil, rien à semer.
   */
  const finishPurchase = async () => {
    if (submitting || completedRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSubmitting(true);
    completedRef.current = true;
    try {
      await withTimeout(refreshCustomerInfo(), SIDE_STEP_TIMEOUT_MS);
    } catch (err) {
      console.warn('[paywall] refreshCustomerInfo :', err);
      // C'est cette relecture qui déclenche la navigation : on la relance sans
      // l'attendre, plutôt que de laisser quelqu'un sur le paywall devant un
      // overlay qui vient de se retirer.
      refreshCustomerInfo().catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  /** Message d'erreur suivi du code RevenueCat — voir describePurchasesError. */
  const withErrorCode = (message: string, readable: string) =>
    `${message}\n\n${t('onboarding:paywall.errorCode', { code: readable })}`;

  /**
   * L'entitlement premium est-il actif, en réalité ?
   *
   * `getCustomerInfo()` ne provoque AUCUNE feuille système : on peut donc
   * l'appeler après n'importe quel échec. Il répond à la seule question qui
   * compte quand un achat semble avoir raté — StoreKit a-t-il conclu pendant
   * que la synchronisation échouait ?
   */
  const premiumAccordingToRevenueCat = async (): Promise<boolean> => {
    try {
      return hasPremium(await withTimeout(Purchases.getCustomerInfo(), ENTITLEMENT_CHECK_TIMEOUT_MS));
    } catch (err) {
      console.warn('[paywall] rattrapage getCustomerInfo :', err);
      return false;
    }
  };

  /**
   * Restauration silencieuse. Réservée aux cas où le compte Apple possède
   * DÉJÀ l'abonnement : `restorePurchases()` peut demander le mot de passe
   * Apple, ce qui ne se justifie que là.
   */
  const premiumAfterSilentRestore = async (): Promise<boolean> => {
    try {
      return hasPremium(await withTimeout(Purchases.restorePurchases(), RESTORE_RECOVERY_TIMEOUT_MS));
    } catch (err) {
      console.warn('[paywall] rattrapage restorePurchases :', err);
      return premiumAccordingToRevenueCat();
    }
  };

  /**
   * Conduite à tenir après un `purchasePackage` en échec. Renvoie `true` si
   * l'accès doit tout de même s'ouvrir — l'achat était en réalité acquis.
   *
   * Écrit pour la revue App Store autant que pour les utilisateurs. Le rejet
   * 2.1(b) du 18 août 2026 (build 10) est arrivé avec une capture de l'alerte
   * générique : un seul message pour une douzaine de causes distinctes, dont
   * plusieurs n'étaient même pas des échecs. Chaque cas connu a désormais sa
   * conduite propre, et ce qui reste porte son code à l'écran.
   */
  const recoverFromPurchaseError = async (e: unknown): Promise<boolean> => {
    const { code, readable, message } = describePurchasesError(e);
    console.warn(
      `[paywall] purchasePackage a échoué — code=${code ?? 'aucun'} (${readable}) : ${message}`,
    );

    // Une annulation volontaire n'est pas une panne : la confondre avec un
    // échec technique ferait croire à un problème de paiement là où il n'y a
    // qu'un changement d'avis. Le message d'erreur, lui, n'est jamais envoyé —
    // seulement son code.
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      track('paywall_purchase_cancelled', { plan: selectedPlan, source: paywallSource });
    } else {
      track('paywall_purchase_failed', {
        plan: selectedPlan,
        source: paywallSource,
        error_code: readable,
      });
    }

    switch (code) {
      // Abandon volontaire, ou feuille StoreKit refermée. Rien à dire.
      case PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR:
        return false;

      // Une transaction est déjà en cours dans le SDK — typiquement un double
      // appui sur le CTA. Ce n'est pas un échec : le premier achat suit son
      // cours et c'est lui qui rendra la main.
      case PURCHASES_ERROR_CODE.OPERATION_ALREADY_IN_PROGRESS_ERROR:
        return false;

      // Achat DIFFÉRÉ : « Demander la permission d'acheter », validation
      // bancaire forte, ou achat interrompu simulé sur un compte bac à sable —
      // une option que les comptes de test d'Apple peuvent porter. Apple rendra
      // la main plus tard ; annoncer un échec ici serait faux.
      case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
        alert(t('onboarding:paywall.purchasePending'));
        return false;

      // Le compte Apple possède DÉJÀ cet abonnement : réinstallation, changement
      // d'appareil, ou examinateur qui retente après un premier échec. Le seul
      // geste juste est de restaurer — et de le faire nous-mêmes, plutôt que de
      // renvoyer vers un lien que personne ne lit dans ce moment-là.
      case PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR:
      case PURCHASES_ERROR_CODE.RECEIPT_ALREADY_IN_USE_ERROR:
      case PURCHASES_ERROR_CODE.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: {
        if (await premiumAfterSilentRestore()) return true;
        alert(withErrorCode(t('onboarding:paywall.purchaseAlreadyOwned', { store: STORE_NAME }), readable));
        return false;
      }

      default: {
        // Dernier filet. StoreKit a pu conclure alors que la synchronisation
        // RevenueCat échouait : on ne laisse jamais dehors quelqu'un qui a payé.
        if (await premiumAccordingToRevenueCat()) {
          console.warn('[paywall] achat en erreur mais premium actif — accès ouvert');
          return true;
        }
        alert(withErrorCode(t('onboarding:paywall.purchaseError'), readable));
        return false;
      }
    }
  };

  /**
   * Étape 3 — achat réel. L'annulation par l'utilisateur est silencieuse
   * (il reste simplement sur le paywall) ; une vraie erreur est signalée avec
   * son code. L'onboarding n'est complété qu'après un achat abouti — ou après
   * un rattrapage qui prouve que l'entitlement est bien actif.
   */
  const handlePurchase = async () => {
    if (busy || completedRef.current) return;

    // Le web n'a pas de StoreKit et rien n'y est vendu : aucun achat possible.
    if (Platform.OS === 'web') {
      console.warn('[paywall] achat impossible sur le web');
      return;
    }

    track('paywall_purchase_started', { plan: selectedPlan, source: paywallSource });

    setPurchasing(true);
    let purchased = false;
    try {
      // Le paquet peut manquer si l'offering n'a pas abouti au montage : réseau
      // coupé, panne RevenueCat, produits pas encore prêts côté Apple. On
      // recharge une fois.
      //
      // Et s'il manque toujours, on REFUSE l'accès au lieu de compléter
      // l'onboarding. C'est le resserrage : auparavant, la moindre panne
      // ouvrait des comptes premium gratuits, silencieusement et sans trace.
      // L'utilisateur reste sur le paywall, où « Restaurer mes achats » et une
      // nouvelle tentative restent à sa portée.
      let pkg = selectedPlan === 'yearly' ? plans.yearly.pkg : plans.monthly.pkg;
      if (!pkg) {
        const fresh = await loadOfferings();
        pkg =
          (selectedPlan === 'yearly' ? fresh?.yearly.pkg : fresh?.monthly.pkg) ?? null;
      }
      if (!pkg) {
        console.warn('[paywall] achat impossible : aucun paquet après rechargement');
        track('paywall_purchase_failed', {
          plan: selectedPlan,
          error_code: 'no_package_after_reload',
        });
        alert(t('onboarding:paywall.offeringsUnavailable'));
      } else {
        const { customerInfo: purchasedInfo } = await Purchases.purchasePackage(pkg);
        if (!hasPremium(purchasedInfo)) {
          // Achat abouti mais entitlement non rattaché : configuration dashboard
          // à vérifier. On ne bloque jamais un utilisateur qui vient de payer.
          console.warn('[paywall] achat validé mais entitlement premium inactif');
        }
        track('paywall_purchase_succeeded', {
          plan: selectedPlan,
          source: paywallSource,
          entitlement_active: hasPremium(purchasedInfo),
        });
        purchased = true;
      }
    } catch (e) {
      purchased = await recoverFromPurchaseError(e);
    }

    // La relecture de l'état est SORTIE du try d'achat : une panne ici ne doit
    // jamais s'afficher « l'achat n'a pas pu aboutir » à quelqu'un qui vient
    // d'être débité.
    try {
      if (purchased) await finishPurchase();
    } finally {
      setPurchasing(false);
    }
  };

  /** Restauration : ne rouvre la porte que si le premium est bien actif. */
  const handleRestore = async () => {
    if (busy || completedRef.current) return;

    if (!isPurchasesConfigured()) {
      track('paywall_restore_tapped', { result: 'not_configured' });
      alert(t('onboarding:paywall.restoreNone'));
      return;
    }

    setRestoring(true);
    try {
      const restored = await Purchases.restorePurchases();
      if (hasPremium(restored)) {
        track('paywall_restore_tapped', { result: 'found' });
        await finishPurchase();
      } else {
        track('paywall_restore_tapped', { result: 'none' });
        alert(t('onboarding:paywall.restoreNone'));
      }
    } catch (e) {
      // Même raison qu'à l'achat : sans le code, une capture d'écran d'App
      // Review ne nous apprend rien.
      const { code, readable, message } = describePurchasesError(e);
      console.warn(
        `[paywall] restorePurchases a échoué — code=${code ?? 'aucun'} (${readable}) : ${message}`,
      );
      alert(withErrorCode(t('onboarding:paywall.restoreError'), readable));
    } finally {
      setRestoring(false);
    }
  };

  const selectPlan = (plan: PlanId) => {
    // Une bascule répétée entre annuel et mensuel trahit une hésitation sur le
    // prix : c'est le compteur, pas le choix final, qui le dit.
    if (plan !== selectedPlan) planSwitches.current += 1;
    track('paywall_plan_selected', { plan, switch_count: planSwitches.current });
    setSelectedPlan(plan);
    Haptics.selectionAsync().catch(() => {});
  };

  /** Nouvelle tentative après un offering perdu (état d'erreur). */
  const handleRetryOfferings = () => {
    if (busy || offeringsState === 'loading') return;
    Haptics.selectionAsync().catch(() => {});
    loadOfferings();
  };

  // Taille du montant : sert aussi à dimensionner son bandeau de chargement,
  // pour que la substitution ne déplace rien.
  const priceFont = Math.max(19, rs(22));

  const selectedOffer = selectedPlan === 'yearly' ? plans.yearly : plans.monthly;
  const selectedPrice = selectedOffer.price;
  // Essai de la formule SÉLECTIONNÉE — c'est elle qui sera facturée.
  const selectedTrialDays = selectedOffer.trialDays;
  const trustPrice =
    selectedPlan === 'yearly'
      ? `${selectedPrice}${t('onboarding:paywall.perYearSuffix')}`
      : `${selectedPrice}${t('onboarding:paywall.perMonthSuffix')}`;

  // Aucun essai à annoncer : ni sur le bouton, ni dans la réassurance. Le seul
  // repli honnête est de ne rien promettre.
  const ctaLabel =
    selectedTrialDays != null
      ? t('onboarding:paywall.cta', { days: selectedTrialDays })
      : t('onboarding:paywall.ctaNoTrial');
  const trustBadgeLabel =
    selectedTrialDays == null
      ? t('onboarding:paywall.trustBadgeNoTrial')
      : reminderOn
        ? t('onboarding:paywall.trustBadgeReminder')
        : t('onboarding:paywall.trustBadge');
  // Ce que la fiche de compte doit savoir pour dire la même chose que le
  // paywall : l'essai de la formule choisie (vide si consommé ou prix inconnus)
  // et le rappel (promis seulement avec les notifications). Voir account.tsx.
  const accountParams = {
    trialDays: selectedTrialDays != null ? String(selectedTrialDays) : '',
    reminder: reminderOn ? '1' : '0',
  };
  // Le prix après l'essai vit dans le bloc légal ; sans prix connu, la mention
  // de reconduction reste seule.
  const renewalLabel =
    selectedPrice == null
      ? t('onboarding:paywall.renewalNotice')
      : selectedTrialDays != null
        ? t('onboarding:paywall.renewalNoticePrice', { price: trustPrice })
        : t('onboarding:paywall.renewalNoticePriceNoTrial', { price: trustPrice });

  const features = [
    { Icon: MessageCircle, label: t('onboarding:paywall.feature1') },
    { Icon: Heart, label: t('onboarding:paywall.feature2') },
    { Icon: TrendingUp, label: t('onboarding:paywall.feature3') },
  ];

  const avatarSize = rs(84);
  const bubbleSize = rs(36);

  return (
    <View style={styles.container}>
      {/* Halos de la maquette : lavis chauds dans deux coins opposés. */}
      <Halo
        id="halo-tl"
        size={520}
        color="#FDBA74"
        opacity={0.5}
        style={{ top: -200, left: -190 }}
      />
      <Halo
        id="halo-br"
        size={560}
        color="#FED7AA"
        opacity={0.55}
        style={{ bottom: -210, right: -200 }}
      />

      {/* Croix de sortie — voir `canExit`. Posée en absolu par-dessus le
          ScrollView : la mise en page verticale du paywall est calibrée au
          pixel près, elle ne doit rien recevoir de nouveau dans son flux. */}
      {canExit && (
        <Pressable
          onPress={() => {
            // Visible uniquement pour un abonnement terminé (voir canExit) :
            // un ancien abonné qui préfère la sortie au réabonnement.
            track('paywall_exit_tapped', {
              source: paywallSource,
              time_on_paywall_ms: Date.now() - paywallShownAt.current,
            });
            Haptics.selectionAsync().catch(() => {});
            openAccount(accountParams);
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding:account.close')}
          style={({ pressed }) => [
            styles.closeButton,
            { top: Math.max(insets.top, 24) + 4 },
            pressed && styles.closeButtonPressed,
          ]}
        >
          <X size={20} color={OnbColors.muted} strokeWidth={2.4} />
        </Pressable>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 24) + rs(14),
            paddingBottom: Math.max(insets.bottom, OnbSpacing.screenBottom) - 6,
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Zone extensible AVANT l'en-tête : sur les grands écrans, l'espace
            excédentaire se répartit entre ici et la zone médiane — le bloc du
            haut descend, l'écart points → cartes se resserre. Part réduite
            (0.7 contre 1) pour garder l'en-tête légèrement haut. */}
        <View style={[styles.grow, { flexGrow: 0.7, minHeight: rs(4) }]} />

        {/* En-tête : avatar Lucy + titre + sous-titre personnalisé */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(650)}
          style={[styles.header, { gap: rs(12) }]}
        >
          <View
            style={[
              styles.avatarRing,
              { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
            ]}
          >
            <Image
              source={require('../../assets/images/lucy-avatar.png')}
              style={{
                position: 'absolute',
                width: avatarSize * AVATAR_CROP.width,
                height: avatarSize * AVATAR_CROP.height,
                left: avatarSize * AVATAR_CROP.left,
                top: avatarSize * AVATAR_CROP.top,
              }}
              resizeMode="stretch"
            />
          </View>
          <Text style={[styles.title, { fontSize: Math.max(23, rs(28)) }]}>
            {t('onboarding:paywall.title')}
          </Text>
          <Text
            style={styles.subtitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {firstName
              ? t('onboarding:paywall.subtitle', { firstName })
              : t('onboarding:paywall.subtitleNoName')}
          </Text>
        </Animated.View>

        {/* Les 3 points de valeur */}
        <Animated.View
          entering={FadeInDown.delay(250).duration(650)}
          style={[styles.features, { marginTop: rs(26), gap: rs(14) }]}
        >
          {features.map(({ Icon, label }) => (
            <View key={label} style={styles.featureRow}>
              <View
                style={[
                  styles.featureBubble,
                  { width: bubbleSize, height: bubbleSize, borderRadius: bubbleSize / 2 },
                ]}
              >
                <Icon size={rs(19)} color={OnbColors.primaryDeep} strokeWidth={2.2} />
              </View>
              <Text
                style={styles.featureLabel}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {label}
              </Text>
            </View>
          ))}
        </Animated.View>

        {/* Zone extensible médiane (voir spacer du haut). */}
        <View style={[styles.grow, { minHeight: rs(10) }]} />

        {/* Cartes de prix */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(650)}
          style={[styles.plans, { gap: rs(12) }]}
        >
          <Pressable
            onPress={() => selectPlan('yearly')}
            style={[
              styles.planCard,
              { paddingVertical: rs(13) },
              selectedPlan === 'yearly' && styles.planCardSelected,
            ]}
          >
            {plans.yearly.savePercent > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>
                  {t('onboarding:paywall.badge', {
                    percent: plans.yearly.savePercent,
                  })}
                </Text>
              </View>
            )}
            <View style={styles.planInfo}>
              <Text style={styles.planLabel}>{t('onboarding:paywall.yearly')}</Text>
              <View style={styles.priceRow}>
                {plans.yearly.price != null ? (
                  <Text style={[styles.planPrice, { fontSize: priceFont }]}>
                    {plans.yearly.price}
                  </Text>
                ) : (
                  <PriceSkeleton width={priceFont * 3.6} height={priceFont * 0.78} />
                )}
                <Text style={styles.planPeriod}>{t('onboarding:paywall.perYearSuffix')}</Text>
              </View>
              {plans.yearly.perMonth != null ? (
                <Text style={styles.planPerMonth}>
                  {t('onboarding:paywall.perMonth', { price: plans.yearly.perMonth })}
                </Text>
              ) : (
                // 16 : hauteur de ligne d'un texte de 13 px, celui du « soit X
                // par mois » qui viendra prendre sa place.
                <PriceSkeleton width={104} height={9} boxHeight={16} />
              )}
            </View>
            <Radio selected={selectedPlan === 'yearly'} />
          </Pressable>

          <Pressable
            onPress={() => selectPlan('monthly')}
            style={[
              styles.planCard,
              { paddingVertical: rs(13) },
              selectedPlan === 'monthly' && styles.planCardSelected,
            ]}
          >
            <View style={styles.planInfo}>
              <Text style={styles.planLabel}>{t('onboarding:paywall.monthly')}</Text>
              <View style={styles.priceRow}>
                {plans.monthly.price != null ? (
                  <Text style={[styles.planPrice, { fontSize: priceFont }]}>
                    {plans.monthly.price}
                  </Text>
                ) : (
                  <PriceSkeleton width={priceFont * 3.6} height={priceFont * 0.78} />
                )}
                <Text style={styles.planPeriod}>{t('onboarding:paywall.perMonthSuffix')}</Text>
              </View>
            </View>
            <Radio selected={selectedPlan === 'monthly'} />
          </Pressable>
        </Animated.View>

        {/* CTA (jamais réduit) + réassurance + pied légal en un seul bloc */}
        <Animated.View
          entering={FadeInDown.delay(550).duration(650)}
          style={{ marginTop: rs(18) }}
        >
          <PaywallCTA
            label={ctaLabel}
            onPress={handlePurchase}
            loading={busy}
            height={rs(56)}
            fontSize={Math.max(15, rs(17))}
          />
          {selectedPrice != null ? (
            <View style={{ marginTop: rs(11), alignItems: 'center' }}>
              <TrustBadge text={trustBadgeLabel} />
            </View>
          ) : offeringsState === 'error' ? (
            // ÉCHEC VISIBLE. Auparavant, l'emplacement du prix gardait un
            // bandeau de chargement qui ne se remplissait jamais : aucune
            // explication, aucune sortie. On dit ce qui se passe et on rend la
            // main, sans jamais ouvrir l'accès sans achat.
            // Message et lien sur UNE ligne, à la place exacte de la phrase de
            // réassurance : le bloc garde sa hauteur (18), donc rien ne pousse
            // le pied de page. Empilés sur deux lignes, « Réessayer » passait
            // sous la ligne de flottaison de l'iPhone SE — le lien de secours
            // aurait demandé de faire défiler, sur l'écran même où l'on veut
            // qu'il saute aux yeux. Lien en Text imbriqué, comme les liens
            // légaux juste en dessous.
            <View style={{ marginTop: rs(11), alignItems: 'center' }}>
              <Text style={styles.trust} numberOfLines={2}>
                {t('onboarding:paywall.offeringsUnavailableShort')}
                {'  '}
                <Text
                  style={styles.retryLink}
                  onPress={handleRetryOfferings}
                  accessibilityRole="button"
                >
                  {t('onboarding:paywall.retry')}
                </Text>
              </Text>
            </View>
          ) : (
            // Le badge dépend de l'éligibilité à l'essai, connue en même temps
            // que le prix : un bandeau centré tient sa place et sa hauteur (18),
            // pour que le bloc légal en dessous ne remonte pas.
            <View style={{ marginTop: rs(11), alignItems: 'center' }}>
              <PriceSkeleton width={210} height={9} boxHeight={18} />
            </View>
          )}

          {/* Bloc légal unifié : disclaimer + liens, même taille, même couleur —
              nettement séparé de la trust line rattachée au CTA.
              Apple exige restauration + CGU + confidentialité près de l'achat. */}
          <View style={[styles.legalBlock, { marginTop: rs(18) }]}>
            {/* Reconduction : Apple n'exige dans le binaire que titre, durée,
                prix et les deux liens — tous présents. Cette ligne est là par
                prudence (certains examinateurs appliquent encore l'ancien
                Schedule 2 §3.8(b)) et parce que le droit européen de la
                consommation la demande. D'où sa forme courte, avec renvoi aux
                conditions qui portent déjà les termes complets : la contrainte
                réglementaire et la contrainte esthétique tirent ici du même
                côté. Volontairement SANS limite d'une ligne : tronquer une
                mention légale en « … » serait pire que deux lignes. */}
            <Text style={styles.legalText}>{renewalLabel}</Text>
            <Text
              style={styles.legalText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {t('onboarding:paywall.disclaimer')}
            </Text>
            <Text style={styles.legalText}>
              <Text style={styles.legalLink} onPress={handleRestore}>
                {t('onboarding:paywall.restore')}
              </Text>
              {/* Le mur n'a pas de croix : ce lien, dans la même ligne que la
                  restauration, ouvre l'écran de compte (déconnexion, suppression
                  — guideline 5.1.1(v)) sans ouvrir l'app. Un abonnement terminé
                  a déjà la croix, on ne double pas. */}
              {!subscriptionLapsed && (
                <>
                  {'  ·  '}
                  <Text
                    style={styles.legalLink}
                    onPress={() => {
                      if (busy) return;
                      track('paywall_exit_tapped', {
                        source: paywallSource,
                        time_on_paywall_ms: Date.now() - paywallShownAt.current,
                      });
                      Haptics.selectionAsync().catch(() => {});
                      openAccount(accountParams);
                    }}
                  >
                    {t('onboarding:paywall.manageAccount')}
                  </Text>
                </>
              )}
              {'  ·  '}
              <Text
                style={styles.legalLink}
                onPress={() =>
                  WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-terms')
                }
              >
                {t('onboarding:paywall.terms')}
              </Text>
              {'  ·  '}
              <Text
                style={styles.legalLink}
                onPress={() =>
                  WebBrowser.openBrowserAsync('https://yourfriendlucy.com/app-privacy')
                }
              >
                {t('onboarding:paywall.privacy')}
              </Text>
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      {submitting && (
        <View style={styles.completingOverlay}>
          <ActivityIndicator size="large" color={OnbColors.primary} />
          <Text style={styles.completingLabel}>{t('onboarding:completing')}</Text>
        </View>
      )}
    </View>
  );
}

function Radio({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {selected && <View style={styles.radioDot} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: OnbColors.bg,
  },
  halo: {
    position: 'absolute',
  },
  // Pastille claire : lisible par-dessus les halos orangés, sans attirer l'œil
  // plus que le CTA. zIndex pour passer devant le ScrollView.
  closeButton: {
    position: 'absolute',
    right: OnbSpacing.screenX - 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
    zIndex: 10,
  },
  closeButtonPressed: {
    opacity: 0.6,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: OnbSpacing.screenX,
  },
  header: {
    alignItems: 'center',
  },
  avatarRing: {
    borderWidth: 2.5,
    borderColor: OnbColors.primary,
    overflow: 'hidden',
    // Pas de fond : l'image est transparente, le halo transparaît derrière.
  },
  title: {
    fontWeight: '700',
    color: OnbColors.ink,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: OnbColors.muted,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  features: {},
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureBubble: {
    backgroundColor: OnbColors.bgWarmDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: OnbColors.inkSoft,
  },
  grow: {
    flexGrow: 1,
  },
  plans: {
    // Laisse la place au badge qui déborde au-dessus de la carte annuelle.
    paddingTop: 12,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: OnbColors.hairline,
    borderRadius: OnbRadius.card,
    paddingHorizontal: 18,
    backgroundColor: OnbColors.bg,
  },
  planCardSelected: {
    borderColor: OnbColors.primary,
    backgroundColor: OnbColors.selectedBg,
  },
  planInfo: {
    gap: 3,
  },
  planLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: OnbColors.muted,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  planPrice: {
    fontWeight: '700',
    color: OnbColors.ink,
  },
  planPeriod: {
    fontSize: 14,
    fontWeight: '500',
    color: OnbColors.muted,
  },
  planPerMonth: {
    fontSize: 13,
    fontWeight: '600',
    color: OnbColors.primaryDeep,
  },
  skeleton: {
    backgroundColor: OnbColors.hairline,
  },
  badge: {
    position: 'absolute',
    top: -12,
    right: 14,
    backgroundColor: OnbColors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    zIndex: 2,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: OnbColors.white,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: OnbColors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: OnbColors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: OnbColors.primary,
  },
  cta: {
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  ctaGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
  ctaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ctaLabel: {
    fontWeight: '700',
    letterSpacing: 0.2,
    color: OnbColors.white,
  },
  trust: {
    fontSize: 12.5,
    lineHeight: 18,
    color: OnbColors.muted,
    textAlign: 'center',
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Sans fond ni bordure : le bouton et le sélecteur d'offre sont déjà deux
    // formes pleines, une pilule de plus surchargeait. L'icône et le gras
    // suffisent à faire badge.
    minHeight: 18,
    paddingHorizontal: 8,
    maxWidth: '100%',
  },
  trustBadgeText: {
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: OnbColors.inkSoft,
    textAlign: 'center',
  },
  trustBadgeStrong: {
    fontWeight: '700',
    color: OnbColors.primaryDeep,
  },
  retryLink: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
    color: OnbColors.primaryDeep,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  legalBlock: {
    gap: 3,
  },
  legalText: {
    fontSize: 11.5,
    lineHeight: 16,
    color: OnbColors.mutedLight,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  legalLink: {
    fontWeight: '600',
  },
  completingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  completingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: OnbColors.ink,
  },
});
