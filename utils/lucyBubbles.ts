/**
 * Découpage des réponses de Lucy en bulles, façon SMS.
 *
 * En base, une réponse de Lucy est UNE ligne de la table messages, avec ses retours à
 * la ligne (le serveur les conserve, voir backend-lucy/src/llm/cleanAssistantText.ts).
 * À l'écran, chaque ligne devient une bulle : la première apparaît dès que la réponse
 * arrive, les suivantes après un passage des trois points proportionnel à leur longueur.
 * La même règle s'applique en direct et au rechargement de l'historique, pour que le fil
 * ait toujours la même tête.
 *
 * Les messages de l'utilisateur ne sont pas découpés : ils s'affichent tels qu'ils ont
 * été envoyés, retours à la ligne compris.
 */

/** Une réponse de Lucy → ses bulles, dans l'ordre. Jamais vide. */
export function splitLucyBubbles(content: string): string[] {
  const parts = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return parts.length > 0 ? parts : [content];
}

/**
 * Identifiant stable d'une bulle : celui du message pour la première, suffixé pour les
 * suivantes. Sert de clé de liste et de cible pour l'appui long (copier).
 */
export function lucyBubbleId(messageId: string, index: number): string {
  return index === 0 ? messageId : `${messageId}#${index}`;
}

/** Pause entre l'affichage d'une bulle et le retour des trois points. */
export const LUCY_BUBBLE_GAP_MS = 400;

/**
 * Durée des trois points avant une bulle, liée à sa longueur : réglage « vif » choisi
 * le 6 septembre 2026 (0,6 s + 25 ms par caractère, plafond 2,5 s).
 */
export function lucyBubbleTypingDelayMs(text: string): number {
  return Math.min(600 + text.length * 25, 2500);
}

// ----------------------------------------------------------------------------
// Rafale de l'utilisateur
// ----------------------------------------------------------------------------
//
// Appuyer sur Envoyer ne lance pas la requête tout de suite : l'app attend un court
// délai de grâce. Si la personne retape pendant ce délai, la requête attend son prochain
// envoi, et ainsi de suite, jusqu'à un plafond compté depuis sa première frappe.
// Les messages retenus partent ensuite en une seule requête, séparés par un retour à la
// ligne : une seule ligne en base, une seule réponse de Lucy.

/**
 * Battement pendant lequel une frappe retient la requête. Il sert deux fois : juste
 * après un envoi, et après un champ vidé (lettres tapées par mégarde puis effacées). C'est
 * le temps de se remettre à taper, pas celui d'écrire le message suivant, et chaque message
 * paie ce délai avant que Lucy ne commence à répondre. Une seconde, testée le 6 septembre
 * 2026, était trop courte : deux rafales ratées sur une poignée d'échanges. Une seule
 * valeur pour les deux cas, par choix : pas cinquante réglages.
 */
export const LUCY_BURST_GRACE_MS = 1500;

/**
 * Plafond de rétention, compté depuis la première lettre du message suivant (pas depuis
 * l'envoi) : au-delà, la requête part même si la personne est encore en train de taper.
 * Lucy répond à ce qu'elle a, le reste partira après sa réponse. Huit secondes, testées le
 * 6 septembre 2026, obligeaient à écrire le second message au galop ; passé à douze le
 * 9 septembre. Un champ vidé puis retapé redonne un plafond entier.
 */
export const LUCY_BURST_MAX_HOLD_MS = 12000;
