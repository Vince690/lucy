/**
 * RevenueCat — initialisation du SDK et helpers d'abonnement.
 *
 * La clé API vient du .env (EXPO_PUBLIC_REVENUECAT_API_KEY) : test_… pointe sur
 * le Test Store (produits factices), appl_… pointera sur l'app iOS réelle.
 * L'identifiant d'entitlement doit correspondre AU CARACTÈRE PRÈS à celui du
 * dashboard RevenueCat.
 */

import { Platform } from 'react-native';
import Purchases, { CustomerInfo, LOG_LEVEL } from 'react-native-purchases';

export const PREMIUM_ENTITLEMENT_ID = 'Lucy Premium';

let configured = false;

export function configurePurchases(appUserID?: string) {
  if (configured || Platform.OS === 'web') return;

  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
  if (!apiKey) {
    console.warn('[purchases] EXPO_PUBLIC_REVENUECAT_API_KEY manquante dans .env — abonnements désactivés');
    return;
  }

  try {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
    Purchases.configure({ apiKey, appUserID });
    configured = true;
  } catch (e) {
    console.warn('[purchases] configuration RevenueCat impossible :', e);
  }
}

export function isPurchasesConfigured() {
  return configured;
}

export function hasPremium(customerInfo: CustomerInfo | null | undefined): boolean {
  return customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
}

/** A déjà acheté au moins une fois, que l'abonnement soit actif ou non. */
export function hasEverPurchased(customerInfo: CustomerInfo | null | undefined): boolean {
  return (customerInfo?.allPurchasedProductIdentifiers?.length ?? 0) > 0;
}

/**
 * Abonnement terminé : la personne a bien acheté un jour, mais plus aucun
 * entitlement n'est actif — essai laissé expirer, résiliation arrivée à terme,
 * ou échec de paiement au renouvellement.
 *
 * Le passé d'achat est exigé volontairement. Sans lui, la vérification
 * éjecterait aussi tous ceux qui sont entrés dans l'app SANS jamais acheter :
 * le compte de démonstration remis à Apple, les testeurs TestFlight, les
 * comptes ouverts avant la mise en place du paywall. Ceux-là gardent leur
 * accès ; c'est seulement l'accès qui SURVIT à un abonnement terminé que l'on
 * ferme.
 *
 * `customerInfo` absent (web, SDK non configuré, RevenueCat injoignable) donne
 * `false` : en cas de doute on n'enferme jamais personne dehors.
 */
export function isSubscriptionLapsed(customerInfo: CustomerInfo | null | undefined): boolean {
  if (!customerInfo) return false;
  return !hasPremium(customerInfo) && hasEverPurchased(customerInfo);
}

/**
 * Abonnement terminé sur un PAIEMENT REFUSÉ (carte sans fonds, expirée), et non
 * sur une résiliation. RevenueCat pose `billingIssueDetectedAt` quand Apple n'a
 * pas pu prélever ; il reste tant que le paiement n'est pas passé. Ne vaut que
 * combiné à isSubscriptionLapsed() : pendant le délai de grâce Apple, l'accès
 * continue et l'entitlement reste actif.
 */
export function hasBillingIssue(customerInfo: CustomerInfo | null | undefined): boolean {
  return customerInfo?.entitlements.all[PREMIUM_ENTITLEMENT_ID]?.billingIssueDetectedAt != null;
}
