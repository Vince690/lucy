/**
 * Recadrage de l'avatar Lucy dans un cercle, aligné sur le CADRAGE DE L'ICÔNE
 * de l'app : le visage est nettement décentré vers le bas à gauche, la mèche
 * déborde à gauche, le menton frôle le bas. Le cercle n'est pas un carré, le
 * décentrage est donc un peu moins marqué que sur l'icône, mais l'intention
 * est la même — Lucy n'est pas posée au milieu d'un rond.
 *
 * Ces valeurs viennent d'un rendu comparatif fait à partir de la boîte
 * englobante réelle du dessin dans lucy-avatar.png (encre sur x 0,091 → 0,773
 * et y 0,017 → 0,981). Le centre du VISAGE tombe à 27 % en largeur et 55 %
 * en hauteur du cercle. Pour retoucher, raisonner sur cette position-là plutôt
 * que sur les quatre nombres ci-dessous, qui n'en sont que la traduction.
 *
 * Un premier réglage à 24 % / 57,5 % coupait le menton net : on aurait dit
 * un visage tronqué plutôt qu'un cadrage choisi. Un cran vers la droite et
 * vers le haut, et le menton affleure — juste assez pour lire l'intention.
 *
 * Valeurs en fraction de la taille du cercle — l'image se pose en absolu dans
 * un conteneur rond à `overflow: 'hidden'` :
 *
 *   width:  size * LUCY_AVATAR_CROP.width,
 *   height: size * LUCY_AVATAR_CROP.height,
 *   left:   size * LUCY_AVATAR_CROP.left,
 *   top:    size * LUCY_AVATAR_CROP.top,   (resizeMode « stretch »)
 *
 * Même cadrage partout (paywall, création de compte, header du chat) : Lucy a
 * UN visage. Trois écrans changent d'un coup si on touche à ces valeurs.
 */
export const LUCY_AVATAR_CROP = {
  width: 1.1957,
  height: 1.1974,
  left: -0.2461,
  top: -0.0474,
} as const;
