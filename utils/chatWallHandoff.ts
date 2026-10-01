/**
 * Le relais du marqueur du mur, entre le chat et l'écran cadeau.
 *
 * Au sixième envoi, le chat part sous le disque orange vers l'écran cadeau, et
 * le profil en mémoire doit recevoir `chat_wall_reached_at` pour que la racine
 * referme l'app et que le paywall tienne. Mais pas TROP TÔT : si le profil
 * change alors que la racine croit encore être dans le groupe (app), sa garde
 * remplace tout par le paywall sur-le-champ — c'est exactement ce que montrait
 * la vidéo de Vincent du 25 septembre 2026 : cadeau et frise sautés.
 *
 * Donc le chat ne touche pas au profil. Il dépose la retouche ici ; l'écran
 * cadeau, une fois monté (la racine le connaît alors comme écran qui garde la
 * main), la récupère et l'applique. Ce qui arrive ensuite — la réponse du
 * serveur au sixième envoi, par exemple — va directement à l'écran cadeau tant
 * qu'il est là, sinon attend le suivant.
 */

import type { Profile } from '@/contexts/AuthContext';

type WallPatch = Partial<Pick<Profile, 'chat_wall_reached_at' | 'free_exchanges_used'>>;
type Sink = (patch: WallPatch) => void;

let pending: WallPatch | null = null;
let sink: Sink | null = null;

/** Le chat dépose la retouche du profil ; appliquée dès qu'un écran l'attend. */
export function handOffWallPatch(patch: WallPatch): void {
  if (sink) {
    sink(patch);
    return;
  }
  pending = { ...(pending ?? {}), ...patch };
}

/**
 * L'écran cadeau s'abonne à son montage : il reçoit ce qui attend, puis ce qui
 * suit. Retourne la fonction de désabonnement.
 */
export function attachWallPatchSink(apply: Sink): () => void {
  sink = apply;
  if (pending) {
    const patch = pending;
    pending = null;
    apply(patch);
  }
  return () => {
    if (sink === apply) sink = null;
  };
}
