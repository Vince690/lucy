/**
 * Nettoyage déterministe des réponses de Lucy avant persistance et envoi à l'app.
 *
 * Pourquoi dans le code et pas dans le prompt : sur 17 réponses d'une session de test
 * (5 septembre 2026), 17 contenaient un tiret cadratin malgré une interdiction explicite.
 * Le tiret est un réflexe d'entraînement des modèles OpenAI (fréquence volontairement
 * relevée dans ChatGPT) qu'aucune consigne ne supprime de façon fiable ; le mentionner
 * dans le prompt le met même sous les yeux du modèle. Un SMS n'a ni tirets de
 * ponctuation, ni puces, ni titres : on les retire ici, quel que soit le modèle.
 *
 * Retours à la ligne : ils sont CONSERVÉS. Depuis le 6 septembre 2026, l'app affiche
 * chaque ligne d'une réponse comme une bulle séparée, façon SMS (voir
 * utils/lucyBubbles.ts côté app). La base garde donc le texte tel que le modèle l'a
 * écrit, lignes vides retirées, sans plafond : autant de bulles que de lignes.
 *
 * Ce que la fonction ne fait pas : elle ne raccourcit pas, ne reformule pas, ne touche
 * pas aux traits d'union ordinaires (« peut-être », « dis-moi » restent intacts).
 */

/** Traits d'union « spéciaux » que le modèle glisse à la place du trait d'union simple. */
const EXOTIC_HYPHENS = /[‐‑‒]/g;

/** Puce ou tiret en tête de ligne (reste de liste). */
const LEADING_BULLET = /^[ \t]*(?:[-*••]|\d+[.)])[ \t]+/gm;

/** Dièses de titre Markdown en tête de ligne (« ## Plan »). */
const LEADING_HEADING = /^[ \t]*#{1,6}[ \t]+/gm;

export function cleanAssistantText(raw: string): string {
  let text = raw.replace(EXOTIC_HYPHENS, '-');

  // Entre deux nombres (« 12–15 km », « 18h–19h »), le tiret est une fourchette : slash.
  text = text.replace(/(\d[hH]?)[ \t]*[—–―][ \t]*(?=\d)/g, '$1/');

  // Tirets de ponctuation → virgule. « ok badass cuir — top » devient « ok badass cuir, top ».
  // Un tiret en fin de phrase (avant un point ou une ligne) disparaît simplement.
  text = text.replace(/[ \t]*[—–―]+[ \t]*(?=[.!?…,;:)]|\n|$)/g, '');
  text = text.replace(/[ \t]*[—–―]+[ \t]*/g, ', ');
  text = text.replace(/[ \t]*,[ \t]*,+/g, ',');
  text = text.replace(/,[ \t]*(?=[.!?…;:])/g, '');
  text = text.replace(/^[ \t]*,[ \t]*/gm, '');

  // Titres et puces en début de ligne : on garde le texte, on retire le marqueur.
  text = text.replace(LEADING_HEADING, '');
  text = text.replace(LEADING_BULLET, '');

  // Une ligne = une bulle. Lignes vides et espaces superflus retirés, retours simples gardés.
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}
