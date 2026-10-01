/**
 * Erreurs partagées entre le worker et les handlers snapshot.
 *
 * Hiérarchie pour la politique de retry (§IV.5.3, §V.13) :
 *
 *   NonRetryableError  — erreur logique permanente ; retenter avec les mêmes
 *     données ne peut pas réussir (conversation introuvable, job_type inconnu,
 *     violation de contrainte schéma). Le worker marque le job `failed`
 *     immédiatement, sans consommer le budget WORKER_MAX_RETRIES.
 *
 *   Les erreurs réseau/LLM/DB transitoires utilisent leurs propres classes
 *   (LlmNetworkError, LlmParseError dans snapshotClient.ts ; pg DatabaseError
 *   avec codes 40001/40P01 pour deadlock/serialization failure).
 */

/**
 * Erreur non-retentable : inutile de relancer le même job avec les mêmes données.
 * Lancer depuis n'importe quel handler ou service utilisé par le worker.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
