/**
 * Bornes du segment « 50 derniers messages utilisateur » en numéros de compteur user (§V.4–V.5).
 * trigger_user_msg_count = T → le segment couvre les messages utilisateur d’index T-49 … T (bornes incluses), avec plancher à 1.
 */

export function computeSnapshotUserMsgSeqRange(triggerUserMsgCount: number): {
  seqFrom: number;
  seqTo: number;
} {
  const t = triggerUserMsgCount;
  if (!Number.isInteger(t) || t < 1) {
    throw new Error(`trigger_user_msg_count invalide: ${triggerUserMsgCount}`);
  }
  return {
    seqFrom: Math.max(1, t - 49),
    seqTo: t,
  };
}
