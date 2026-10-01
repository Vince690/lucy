/**
 * Porte du chat — le pré-essai à FREE_EXCHANGES_LIMIT échanges, puis l'abonnement.
 *
 * Décidé le 23 septembre 2026 : après l'onboarding, la personne entre dans la vraie
 * app et parle vraiment à Lucy. Elle dispose de FREE_EXCHANGES_LIMIT échanges, une
 * seule fois pour toujours (le compteur ne se remet jamais à zéro, ni le lendemain,
 * ni après une réinstallation, ni après une remise à zéro de la mémoire de Lucy).
 * Au-delà, seul un abonnement actif ouvre la porte.
 *
 * Un échange = une requête POST /chat, c'est-à-dire une rafale de messages de la
 * personne suivie d'une réponse de Lucy (l'app groupe une rafale en une requête).
 *
 * Ordre volontaire :
 *   1. consommer un échange offert, de façon atomique (RPC `chat_gate_consume`,
 *      un seul UPDATE conditionnel : deux requêtes simultanées ne passent pas
 *      toutes deux avec le même compteur) ;
 *   2. seulement si le quota est épuisé, demander à RevenueCat si la personne est
 *      abonnée. Les cinq premiers échanges ne coûtent donc aucun appel réseau, et
 *      un abonné consomme ses cinq échanges offerts sans que cela change rien.
 *
 * Le compteur vit sur `profiles`, PAR PERSONNE et non par conversation : une
 * remise à zéro de la mémoire crée une nouvelle conversation et remettrait un
 * compteur par conversation à zéro. La colonne est protégée par un trigger : le
 * client Supabase de l'app ne peut pas l'écrire, seule la clé de service le peut.
 *
 * Le premier refus 402 pose aussi `profiles.chat_wall_reached_at` : c'est ce
 * marqueur (renvoyé dans la réponse 402) qui, côté app, referme l'app derrière le
 * paywall à chaque ouverture. Le compteur seul ne suffit pas : le mur doit tomber
 * au sixième ENVOI, pas à la cinquième réponse.
 *
 * Un échange consommé dont le traitement échoue ensuite (LLM en panne, etc.) est
 * rendu (`refundFreeExchange`) : personne ne perd un échange offert sur une erreur
 * qui n'est pas la sienne.
 */

import { supabaseAdmin } from '../supabase.js';
import { FREE_EXCHANGES_LIMIT } from '../constants.js';
import { ChatServiceError } from './chatService.js';
import { hasActivePremium } from './subscriptionService.js';

export type ChatAccess = 'free' | 'premium';

export interface ChatAccessDecision {
  access: ChatAccess;
  /** Échanges offerts consommés, celui-ci compris quand `access` vaut `free`. */
  freeExchangesUsed: number;
  freeExchangesLimit: number;
}

export interface ConsumeResult {
  allowed: boolean;
  used: number;
}

/** Dépendances injectables, pour tester la décision sans base ni RevenueCat. */
export interface ChatGateDeps {
  consume: (userId: string, limit: number) => Promise<ConsumeResult>;
  isPremium: (userId: string) => Promise<boolean>;
  /** Pose le marqueur du mur ; renvoie l'instant retenu (ISO), ou null si impossible. */
  markWall: (userId: string) => Promise<string | null>;
}

const defaultDeps: ChatGateDeps = {
  consume: consumeFreeExchange,
  isPremium: hasActivePremium,
  markWall: markWallReached,
};

/**
 * Décide si ce POST /chat peut être traité.
 *
 * Lance ChatServiceError :
 *   - `free_exchanges_exhausted` (402) : quota épuisé et pas d'abonnement actif.
 *     La réponse porte les compteurs, pour que l'app affiche le mur.
 *   - `subscription_unverifiable` (503) : quota épuisé et RevenueCat injoignable.
 *     On bloque plutôt que de laisser passer (choix du 23 septembre 2026).
 */
export async function decideChatAccess(
  userId: string,
  deps: ChatGateDeps = defaultDeps
): Promise<ChatAccessDecision> {
  const { allowed, used } = await deps.consume(userId, FREE_EXCHANGES_LIMIT);
  if (allowed) {
    return { access: 'free', freeExchangesUsed: used, freeExchangesLimit: FREE_EXCHANGES_LIMIT };
  }

  let premium: boolean;
  try {
    premium = await deps.isPremium(userId);
  } catch (err) {
    throw new ChatServiceError(
      'subscription_unverifiable',
      "Impossible de vérifier l'abonnement pour le moment, réessaie dans un instant",
      err,
      503
    );
  }

  if (!premium) {
    const wallReachedAt = (await deps.markWall(userId)) ?? new Date().toISOString();
    throw new ChatServiceError(
      'free_exchanges_exhausted',
      'Les échanges offerts sont épuisés : un abonnement est nécessaire pour continuer',
      null,
      402,
      {
        free_exchanges_used: used,
        free_exchanges_limit: FREE_EXCHANGES_LIMIT,
        chat_wall_reached_at: wallReachedAt,
      }
    );
  }

  return { access: 'premium', freeExchangesUsed: used, freeExchangesLimit: FREE_EXCHANGES_LIMIT };
}

/**
 * Consomme un échange offert si le compteur est sous la limite. Atomique côté
 * Postgres (RPC réservée à la clé de service, voir la migration chat_gate).
 */
export async function consumeFreeExchange(userId: string, limit: number): Promise<ConsumeResult> {
  const { data, error } = await supabaseAdmin.rpc('chat_gate_consume', {
    p_user_id: userId,
    p_limit: limit,
  });

  if (error) {
    throw new ChatServiceError('db_error', 'Erreur lors du contrôle des échanges offerts', error);
  }

  const row = data as { allowed?: unknown; used?: unknown } | null;
  if (!row || typeof row.allowed !== 'boolean' || typeof row.used !== 'number') {
    throw new ChatServiceError('db_error', 'Réponse inattendue de chat_gate_consume');
  }
  return { allowed: row.allowed, used: row.used };
}

/**
 * Pose `profiles.chat_wall_reached_at` (première fois seulement). Ne lance jamais :
 * le refus 402 part de toute façon, l'app se rabat sur l'instant courant.
 */
export async function markWallReached(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('chat_gate_mark_wall', { p_user_id: userId });
    if (error) throw error;
    return typeof data === 'string' ? data : null;
  } catch (err) {
    console.error('[chatGate] marqueur du mur impossible à poser :', err);
    return null;
  }
}

/**
 * Rend un échange offert consommé dont le traitement a échoué. Ne lance jamais :
 * un échec ici ne doit pas masquer l'erreur d'origine.
 */
export async function refundFreeExchange(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('chat_gate_refund', { p_user_id: userId });
    if (error) throw error;
  } catch (err) {
    console.error('[chatGate] remboursement d’un échange offert impossible :', err);
  }
}
