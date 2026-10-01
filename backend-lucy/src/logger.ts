/**
 * Logger structuré backend-lucy (plan §9.1).
 *
 * Émet une ligne JSON par événement sur stdout/stderr.
 * Compatible Datadog / CloudWatch / parsing via jq.
 *
 * Format de sortie :
 *   {"ts":"2026-03-29T12:00:00.000Z","level":"info","event":"chat.response","request_id":"...","duration_ms":1234,...}
 *
 * Événements principaux définis par §9.1 :
 *   "chat.response"   — un par appel POST /chat (succès ou erreur)
 *   "snapshot.done"   — un par job snapshot_50 terminé (succès ou erreur)
 *   "memory.reset"    — un par appel POST /memory/reset (succès ou erreur)
 *
 * Niveau minimum :
 *   LOG_LEVEL=debug|info|warn|error  (défaut: info)
 *   Quand NODE_ENV=test et LOG_LEVEL non défini : warn (réduit le bruit des tests).
 *
 * Règles de sécurité :
 *   - Ne jamais logger le contenu des messages utilisateur ni les tokens JWT.
 *   - Préférer des compteurs, durées et identifiants opaques.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const _envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
const _isTest = process.env.NODE_ENV === 'test';
const MIN_LEVEL: number =
  _envLevel && LEVEL_RANK[_envLevel] !== undefined
    ? LEVEL_RANK[_envLevel]
    : _isTest
      ? LEVEL_RANK.warn
      : LEVEL_RANK.info;

/**
 * Émet un événement structuré en JSON sur une ligne.
 *
 * @param level  Sévérité : debug | info | warn | error
 * @param event  Nom stable de l'événement (ex. "chat.response")
 * @param fields Champs additionnels — clés stables, pas de PII, valeurs scalaires ou tableaux simples
 */
export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (LEVEL_RANK[level] < MIN_LEVEL) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Tronque un message d’erreur pour les champs `err_msg` (évite lignes JSON énormes). */
export function truncateLogMessage(s: string, max = 500): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
