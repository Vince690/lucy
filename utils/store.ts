/**
 * La boutique qui vend l'abonnement, selon la plateforme.
 *
 * Aucun texte ne doit écrire « Apple » en dur là où il parle d'un achat : le
 * jour où l'app sort sur Android, la phrase serait fausse et personne n'y
 * penserait. Les traductions prennent `{{store}}`, et ce module donne le nom
 * et l'adresse de gestion des abonnements de la boutique du téléphone.
 */

import { Platform } from 'react-native';

const IS_ANDROID = Platform.OS === 'android';

/** Nom de la boutique tel qu'on le dit à la personne : « Apple » ou « Google Play ». */
export const STORE_NAME = IS_ANDROID ? 'Google Play' : 'Apple';

/**
 * Page de gestion des abonnements de la boutique. C'est là que la personne
 * résilie, et là que la boutique signale un paiement en attente et propose de
 * mettre à jour le moyen de paiement.
 */
export const STORE_SUBSCRIPTIONS_URL = IS_ANDROID
  ? 'https://play.google.com/store/account/subscriptions'
  : 'https://apps.apple.com/account/subscriptions';
