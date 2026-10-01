/**
 * TTL événements éphémères (§III.3g §9) — aligné sur le document algorithme.
 */

/** Retourne null si l’item doit être ignoré (expires_at <= maintenant). */
export function computeEphemeralExpiresAt(eventAt: Date | null, nowMs: number = Date.now()): Date | null {
  if (eventAt) {
    const exp = new Date(eventAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (exp.getTime() <= nowMs) return null;
    return exp;
  }
  const exp = new Date(nowMs + 14 * 24 * 60 * 60 * 1000);
  return exp;
}

export function parseIsoToDate(iso: string | null): Date | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
