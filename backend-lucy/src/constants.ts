/**
 * Constantes de performance & coûts MVP (§VII algorithme-memoire-lucy.md).
 *
 * Source unique pour les deux limites critiques : modifier ici suffit.
 * Si tu changes ces valeurs, aligne aussi :
 *   - La variable v_snapshot_user_msg_period dans la dernière migration
 *     supabase/migrations/*write_user_message*.sql (voir test sqlSnapshotPeriodAlignment).
 *   - La section "Contraintes performance & coûts" du README.
 *   - Le document algorithme-memoire-lucy.md §VII.
 */

/**
 * Fenêtre de messages envoyés au LLM chat (§VII, 3300-3306).
 * Seuls les N derniers messages de la conversation sont injectés dans chaque appel.
 * 30 → 50 le 5 septembre 2026 : avec des messages de quelques mots, 30 messages
 * couvraient une seule soirée et Lucy répétait les mêmes phrases affectueuses.
 */
export const CONTEXT_MESSAGES_LIMIT = 50;

/**
 * Nombre de messages utilisateur dans le segment snapshot (§V.4).
 * Doit rester aligné avec v_snapshot_user_msg_period dans write_user_message (Postgres).
 */
export const SEGMENT_USER_MESSAGES = 50;

/**
 * Premier snapshot déclenché dès ce nombre de messages utilisateur, puis tous les
 * SEGMENT_USER_MESSAGES. Sans ce seuil, un utilisateur à 10 messages par jour n'avait
 * aucune mémoire avant le 5e jour de son essai de 7 jours.
 * Doit rester aligné avec v_snapshot_first_user_msg_count dans write_user_message.
 */
export const SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES = 15;

/**
 * Échanges offerts avant le mur d'abonnement (pré-essai, 23 septembre 2026).
 * Un échange = une requête POST /chat (une rafale de messages, une réponse de Lucy).
 * Une seule fois pour toujours : le compteur (`profiles.free_exchanges_used`) ne se
 * remet jamais à zéro. Voir services/chatGateService.ts. L'app porte la même valeur
 * dans constants/chatGate.ts, et préfère celle que le serveur renvoie.
 */
export const FREE_EXCHANGES_LIMIT = 5;
