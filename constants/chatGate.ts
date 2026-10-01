/**
 * Porte du chat — le pré-essai à FREE_EXCHANGES_LIMIT échanges, puis l'abonnement.
 *
 * Décidé le 23 septembre 2026. Après le slider « faire connaissance », la personne
 * entre dans la vraie app et parle vraiment à Lucy. Elle dispose de
 * FREE_EXCHANGES_LIMIT échanges (un échange = une rafale de messages suivie d'une
 * réponse de Lucy), une seule fois pour toujours. Au sixième envoi : flash orange
 * depuis le bouton Envoyer, puis les écrans cadeau → frise de l'essai → paywall.
 * Sans abonnement, le paywall revient ensuite à chaque ouverture, comme pour un
 * abonnement terminé, et rien d'autre n'est accessible.
 *
 * LE SERVEUR FAIT FOI. Le compteur (`profiles.free_exchanges_used`) et le marqueur
 * du mur (`profiles.chat_wall_reached_at`) sont écrits uniquement par le backend
 * (backend-lucy/src/services/chatGateService.ts) ; l'app ne peut pas les modifier
 * (trigger Postgres). Le sixième envoi part au serveur comme les autres : c'est
 * son refus (402) qui pose le marqueur, et le marqueur qui referme l'app aux
 * ouvertures suivantes. L'app, elle, PRÉVOIT seulement l'affichage : comme le
 * serveur lui a dit le quota à chaque réponse, elle lance le flash orange dès
 * l'appui du sixième envoi sans attendre le refus (depuis le 26 septembre 2026,
 * pour la fluidité), et envoie quand même. Un envoi refusé qu'elle n'avait pas
 * prévu passe par le même mur. Trafiquer l'app ne fait rien passer.
 *
 * La même limite est déclarée côté serveur (backend-lucy/src/constants.ts) ; l'app
 * préfère la valeur que le serveur renvoie dans chaque réponse.
 */

import type { CustomerInfo } from 'react-native-purchases';
import { hasEverPurchased, hasPremium, isPurchasesConfigured } from '@/utils/purchases';

export const FREE_EXCHANGES_LIMIT = 5;

/** Ce que la porte lit dans le profil. */
export interface ChatGateProfile {
  free_exchanges_used?: number | null;
  chat_wall_reached_at?: string | null;
}

/**
 * Le mur est-il déjà tombé ?
 *
 * C'est le MARQUEUR posé par le serveur au premier refus (sixième envoi), et non
 * le compteur, qui referme l'app : avec le compteur seul, la racine renverrait au
 * paywall dès la cinquième réponse de Lucy, avant que la personne ait voulu écrire
 * une sixième fois. Le compteur ne sert qu'à la mesure.
 */
export function hasReachedWall(profile: ChatGateProfile | null | undefined): boolean {
  const at = profile?.chat_wall_reached_at;
  return typeof at === 'string' && at.length > 0;
}

/**
 * Le paywall doit-il barrer l'app ?
 *
 * Deux cohortes, et seulement elles :
 *   - l'abonnement terminé (a acheté un jour, plus rien d'actif) — depuis toujours ;
 *   - le mur tombé (échanges offerts épuisés, sixième envoi refusé) sans abonnement
 *     — depuis le 23 septembre 2026.
 *
 * Un abonnement actif ouvre tout. Sans RevenueCat (web, SDK non configuré), la
 * porte reste ouverte côté app : StoreKit n'existe pas là, rien n'y est vendu, et
 * le serveur refuse quand même les messages au-delà du quota.
 *
 * `customerInfo` absent alors que RevenueCat est configuré : la personne n'a pas
 * (encore) d'état d'abonnement connu. La racine attend qu'il soit résolu avant de
 * décider (voir PurchasesContext.customerInfoResolved) ; une fois résolu mais
 * toujours absent (RevenueCat injoignable et rien en cache), on ferme : c'est le
 * choix de la sécurité, et le paywall garde « Restaurer mes achats ».
 */
export function isPaywallRequired(
  customerInfo: CustomerInfo | null | undefined,
  profile: ChatGateProfile | null | undefined,
): boolean {
  if (!isPurchasesConfigured()) return false;
  if (hasPremium(customerInfo)) return false;
  return hasEverPurchased(customerInfo) || hasReachedWall(profile);
}
