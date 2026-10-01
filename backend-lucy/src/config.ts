/**
 * Configuration du backend Lucy (variables d'environnement).
 * Ne jamais commiter .env ; utiliser .env.example comme modèle.
 */

function required(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    throw new Error(`Variable d'environnement manquante: ${key}`);
  }
  return v;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Effort de raisonnement du LLM chat.
 *
 * Le raisonnement est facturé au tarif *output* et représente >90 % du coût par tour
 * (les réponses de Lucy font 2-3 phrases, le raisonnement plusieurs centaines de tokens).
 * Mesuré sur 50 réponses par palier avec le prompt réel : `low` tient exactement la même
 * adhérence aux CRITICAL RULES que le défaut `medium` (4 violations sur 50 dans les deux
 * cas), pour ~60 % de coût output en moins et ~moitié moins de latence. `minimal` dégrade
 * nettement (40 % de réponses fautives : dépassements de longueur, tirets cadratins).
 *
 * `default` (sentinelle) = ne pas envoyer le paramètre, donc laisser le défaut du modèle.
 * À utiliser pour revenir au comportement d'avant cette option sans toucher au code.
 *
 * ⚠️ Les valeurs acceptées dépendent du modèle : `gpt-5-mini` accepte `minimal` et refuse
 * `none` ; `gpt-5.6-luna` fait l'inverse. Une valeur refusée fait échouer CHAQUE appel
 * `/chat` avec une erreur 400 — d'où la validation au démarrage plutôt qu'en production.
 */
const REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high'] as const;
export type ReasoningEffortSetting = (typeof REASONING_EFFORTS)[number];

function reasoningEffort(key: string, defaultValue: ReasoningEffortSetting): ReasoningEffortSetting {
  const raw = (process.env[key] ?? defaultValue).trim().toLowerCase();
  if (!(REASONING_EFFORTS as readonly string[]).includes(raw)) {
    throw new Error(
      `${key} invalide : « ${raw} ». Valeurs acceptées : ${REASONING_EFFORTS.join(', ')}.`
    );
  }
  return raw as ReasoningEffortSetting;
}

export const config = {
  /** Supabase */
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  /**
   * Connexion Postgres pour transactions ACID (snapshots 5.4–5.5).
   * Priorité : variables individuelles PG_HOST/PG_USER/PG_PASSWORD/PG_DATABASE
   * Fallback : DATABASE_URL (URI complète).
   * Dashboard Supabase → Connect → Session pooler.
   */
  databaseUrl: optional('DATABASE_URL', ''),
  pgHost: optional('PG_HOST', ''),
  pgUser: optional('PG_USER', ''),
  pgPassword: optional('PG_PASSWORD', ''),
  pgDatabase: optional('PG_DATABASE', 'postgres'),
  pgPort: parseInt(optional('PG_PORT', '5432'), 10),
  /**
   * Chemin vers le certificat CA Supabase (prod-ca-2021.crt), pour vérifier
   * le certificat serveur (ssl.rejectUnauthorized: true). À télécharger depuis
   * Dashboard Supabase → Project Settings → Database → SSL Configuration.
   */
  pgSslCaPath: optional('PG_SSL_CA_PATH', ''),

  /** LLM Chat (GPT‑5 mini). Optionnel au démarrage ; requis pour les appels /chat réels. */
  llmApiKey: optional('LUCY_LLM_API_KEY', ''),
  llmModel: optional('LUCY_LLM_MODEL', 'gpt-5.6-luna'),
  /** Voir reasoningEffort() ci-dessus. `default` = laisser le modèle décider. */
  llmReasoningEffort: reasoningEffort('LUCY_LLM_REASONING_EFFORT', 'low'),

  /** LLM Snapshot (GPT‑5 nano) */
  snapshotLlmModel: optional('LUCY_SNAPSHOT_LLM_MODEL', 'gpt-5.6-luna'),
  /** Si absent, on utilise LUCY_LLM_API_KEY pour le snapshot aussi */
  snapshotLlmApiKey: optional('LUCY_SNAPSHOT_LLM_API_KEY', ''),

  /**
   * RevenueCat — vérification serveur de l'abonnement (services/subscriptionService.ts).
   * Clé SECRÈTE de l'API REST (sk_…, dashboard RevenueCat → API keys), jamais la clé
   * publique du SDK. Optionnelle au démarrage : sans elle, quiconque a épuisé ses
   * échanges offerts reçoit 503 (abonnement invérifiable), abonné compris.
   */
  revenueCatSecretApiKey: optional('REVENUECAT_SECRET_API_KEY', ''),
  /** Identifiant d'entitlement, AU CARACTÈRE PRÈS celui du dashboard (comme dans l'app). */
  revenueCatEntitlementId: optional('REVENUECAT_ENTITLEMENT_ID', 'Lucy Premium'),
  revenueCatApiBaseUrl: optional('REVENUECAT_API_BASE_URL', 'https://api.revenuecat.com/v1'),

  /** Environnement (dev / prod) pour les logs */
  env: optional('LUCY_ENV', 'dev'),

  /** Port du serveur HTTP */
  port: parseInt(optional('PORT', '4000'), 10),

  /** Protection API /chat (périmètre 4.1, sans impacter les étapes suivantes) */
  chatRateLimitWindowMs: parseInt(optional('CHAT_RATE_LIMIT_WINDOW_MS', '60000'), 10),
  chatRateLimitMaxRequests: parseInt(optional('CHAT_RATE_LIMIT_MAX_REQUESTS', '20'), 10),
  chatRouteTimeoutMs: parseInt(optional('CHAT_ROUTE_TIMEOUT_MS', '45000'), 10),

  /** Worker mémoire */
  workerMaxRetries: parseInt(optional('WORKER_MAX_RETRIES', '3'), 10),
  workerRetryBackoffMs: parseInt(optional('WORKER_RETRY_BACKOFF_MS', '60000'), 10),
  workerBatchSize: parseInt(optional('WORKER_BATCH_SIZE', '10'), 10),
  /**
   * Timeout (ms) au-delà duquel un job `running` est considéré comme orphelin (crash worker).
   * Doit être supérieur à la durée maximale d'un snapshot réel pour éviter double exécution.
   */
  workerStaleLockMs: parseInt(optional('WORKER_STALE_LOCK_MS', '900000'), 10),

  /**
   * Timeout SQL (ms) sur les connexions `pg` (snapshots 5.4–5.5).
   * Évite une transaction bloquée indéfiniment (annulation côté Postgres).
   */
  dbStatementTimeoutMs: parseInt(optional('DB_STATEMENT_TIMEOUT_MS', '120000'), 10),
} as const;

export function getSnapshotApiKey(): string {
  return config.snapshotLlmApiKey || config.llmApiKey;
}

/** Connexion Postgres pour transactions ACID (snapshot 5.4–5.5). */
export function requireDatabaseUrl(): string {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL est requise pour appliquer un snapshot (étapes 5.4–5.5). ' +
        'Utilise l’URI Postgres du projet Supabase (Settings → Database).'
    );
  }
  return config.databaseUrl;
}

export function hasLlmConfig(): boolean {
  return Boolean(config.llmApiKey);
}
