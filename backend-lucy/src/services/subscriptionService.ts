/**
 * Abonnement — vérification côté serveur auprès de RevenueCat.
 *
 * Jusqu'au 23 septembre 2026, le backend ne vérifiait AUCUN abonnement : l'app seule
 * décidait qui pouvait écrire à Lucy. Avec le pré-essai (voir chatGateService.ts),
 * tout le monde entre dans l'app sans payer ; la limite doit donc être tenue ici,
 * sinon elle se contourne en rejouant les requêtes.
 *
 * Source de vérité : l'API REST v1 de RevenueCat, `GET /subscribers/{app_user_id}`,
 * avec la clé SECRÈTE (jamais la clé publique du SDK). L'identifiant RevenueCat est
 * l'identifiant Supabase de la personne (Purchases.logIn(user.id) côté app), ce qui
 * rattache l'abonnement au compte et non à l'appareil.
 *
 * Cache en mémoire par utilisateur : un « oui » vaut quelques minutes (l'expiration
 * d'un abonnement se voit avec ce retard, sans conséquence) ; un « non » ne vaut
 * que quelques secondes, parce qu'il précède souvent un achat : quelqu'un qui vient
 * de payer et renvoie son message doit passer.
 *
 * Bac à sable : l'API v1 ne renvoie les achats sandbox (TestFlight, comptes de test
 * Apple) qu'avec l'en-tête `X-Is-Sandbox: true`. On interroge d'abord la production ;
 * si rien n'est actif, on redemande avec cet en-tête. Le SDK de l'app, lui, tient
 * déjà un achat sandbox pour un vrai abonnement : le serveur fait pareil, sinon les
 * testeurs TestFlight et le relecteur Apple seraient bloqués au mur après achat.
 *
 * Un doute (clé absente, RevenueCat injoignable, réponse illisible) est une ERREUR,
 * jamais un « non » ni un « oui » : l'appelant décide, et la route /chat répond 503
 * plutôt que d'ouvrir ou de fermer la porte au hasard. Décision de Vincent du
 * 23 septembre 2026 : bloquer avec « réessaie » plutôt que laisser passer.
 */

import { config } from '../config.js';

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 3_000;
const FETCH_TIMEOUT_MS = 6_000;

export class SubscriptionCheckError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown = null
  ) {
    super(message);
    this.name = 'SubscriptionCheckError';
  }
}

interface CacheEntry {
  premium: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function hasRevenueCatConfig(): boolean {
  return Boolean(config.revenueCatSecretApiKey);
}

/** Vide le cache (tests, ou après un événement d'abonnement). */
export function clearSubscriptionCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Lit la réponse `GET /v1/subscribers/{id}` de RevenueCat et dit si l'entitlement
 * est actif à l'instant `nowMs`. Fonction pure, exportée pour les tests.
 *
 * Forme attendue : `{ subscriber: { entitlements: { "<id>": { expires_date, ... } } } }`.
 * `expires_date` à null = accès à vie. Tout ce qui ne ressemble pas à ça vaut « non ».
 */
export function entitlementActiveFromSubscriber(
  payload: unknown,
  entitlementId: string,
  nowMs: number
): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const subscriber = (payload as { subscriber?: unknown }).subscriber;
  if (!subscriber || typeof subscriber !== 'object') return false;
  const entitlements = (subscriber as { entitlements?: unknown }).entitlements;
  if (!entitlements || typeof entitlements !== 'object') return false;
  const entitlement = (entitlements as Record<string, unknown>)[entitlementId];
  if (!entitlement || typeof entitlement !== 'object') return false;
  const expires = (entitlement as { expires_date?: unknown }).expires_date;
  if (expires === null || expires === undefined) return true;
  if (typeof expires !== 'string') return false;
  const expiresMs = Date.parse(expires);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

/** Un appel `GET /subscribers/{id}`, en production ou en bac à sable. */
async function fetchEntitlementActive(
  userId: string,
  apiKey: string,
  sandbox: boolean,
  nowMs: number
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${config.revenueCatApiBaseUrl}/subscribers/${encodeURIComponent(userId)}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };
    if (sandbox) headers['X-Is-Sandbox'] = 'true';
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });

    if (res.status === 404) {
      // Inconnu de RevenueCat : n'a jamais ouvert l'app avec le SDK, donc jamais acheté.
      return false;
    }
    if (!res.ok) {
      throw new SubscriptionCheckError(`RevenueCat a répondu ${res.status}`);
    }
    const payload: unknown = await res.json();
    return entitlementActiveFromSubscriber(payload, config.revenueCatEntitlementId, nowMs);
  } catch (err) {
    if (err instanceof SubscriptionCheckError) throw err;
    throw new SubscriptionCheckError('RevenueCat injoignable', err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * L'utilisateur a-t-il l'entitlement premium actif ?
 *
 * Lance SubscriptionCheckError quand on ne peut pas savoir. Ne lance jamais pour
 * un « non » franc (abonnement expiré, jamais acheté, inconnu de RevenueCat).
 */
export async function hasActivePremium(userId: string, nowMs: number = Date.now()): Promise<boolean> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > nowMs) return cached.premium;

  const apiKey = config.revenueCatSecretApiKey;
  if (!apiKey) {
    throw new SubscriptionCheckError('REVENUECAT_SECRET_API_KEY manquante : abonnement invérifiable');
  }

  let premium = await fetchEntitlementActive(userId, apiKey, false, nowMs);
  if (!premium) {
    premium = await fetchEntitlementActive(userId, apiKey, true, nowMs);
  }

  cache.set(userId, {
    premium,
    expiresAt: nowMs + (premium ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return premium;
}
