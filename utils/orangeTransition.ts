/**
 * Le voile orange qui relie l'onboarding à l'app, et l'app au mur.
 *
 * Deux moments l'utilisent :
 *   - la fin du slider « faire connaissance » (meet) : l'écran se couvre d'orange,
 *     puis le chat apparaît DESSOUS et le voile se dissout (420 ms) ;
 *   - le sixième envoi dans le chat : un disque orange naît au centre du bouton
 *     Envoyer, couvre l'écran, puis l'écran cadeau apparaît dessous.
 *
 * Le disque et le voile d'arrivée vivent dans la mise en page du groupe (app)
 * (components/OrangeTransitionLayer.tsx), par-dessus le header comme le fil : un
 * disque dessiné dans l'écran de chat seul laisserait le header blanc dépasser.
 *
 * Aucun contexte React : un module, deux fonctions. Le chat demande le zoom et
 * sera rappelé une fois l'écran couvert ; meet demande un voile d'arrivée que la
 * couche consomme à son montage.
 */

export interface ZoomOrigin {
  /** Centre du disque, en coordonnées de fenêtre (measureInWindow). */
  x: number;
  y: number;
  /** Diamètre de départ, celui du bouton d'où il part. */
  size: number;
}

type ZoomListener = (origin: ZoomOrigin, onCovered: () => void) => void;

let zoomListener: ZoomListener | null = null;
let arrivalVeilPending = false;

/** La couche s'abonne au montage ; retourne la fonction de désabonnement. */
export function subscribeOrangeZoom(listener: ZoomListener): () => void {
  zoomListener = listener;
  return () => {
    if (zoomListener === listener) zoomListener = null;
  };
}

/**
 * Lance le disque depuis `origin`. `onCovered` est appelé quand l'écran est
 * entièrement orange : c'est le moment de naviguer. Sans couche montée (cas
 * théorique), on navigue tout de suite.
 */
export function startOrangeZoom(origin: ZoomOrigin, onCovered: () => void): void {
  if (zoomListener) zoomListener(origin, onCovered);
  else onCovered();
}

/** À appeler juste avant de naviguer vers un écran qui doit apparaître sous le voile. */
export function requestOrangeArrival(): void {
  arrivalVeilPending = true;
}

/** La couche consomme la demande à son montage : vrai une seule fois. */
export function consumeOrangeArrival(): boolean {
  const pending = arrivalVeilPending;
  arrivalVeilPending = false;
  return pending;
}
