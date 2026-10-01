/**
 * Normalisation par lot (D) : un aller-retour Postgres pour N chaînes distinctes.
 */

import type { PoolClient } from 'pg';
import type { ValidatedSnapshot } from '../llm/snapshotSchema.js';

/** Textes du snapshot qui passent par normalize_text() côté SQL. */
export function collectNormalizeTexts(validated: ValidatedSnapshot): string[] {
  const out: string[] = [];

  const goal = validated.user_identity_goals?.goal;
  if (goal?.goal_text) out.push(goal.goal_text);

  for (const n of validated.user_occupation_notes?.notes ?? []) {
    out.push(n.note_text);
  }

  for (const p of validated.user_preferences?.preferences ?? []) {
    if (typeof p.value === 'string') out.push(p.value);
  }

  const rel = validated.user_relations?.relation;
  if (rel?.name_raw) out.push(rel.name_raw);

  for (const e of validated.user_ephemeral_events?.events ?? []) {
    out.push(e.event_text);
  }

  for (const e of validated.user_life_events?.events ?? []) {
    out.push(e.event_text);
  }

  return out;
}

export type NormFn = (s: string) => Promise<string>;

/**
 * Construit une map normalize_text pour les chaînes uniques, puis une fonction Norm
 * avec repli SQL si une chaîne n’était pas dans le lot (ne devrait pas arriver).
 */
export async function buildNormFromBatch(
  client: PoolClient,
  texts: string[]
): Promise<NormFn> {
  const unique = [...new Set(texts.filter((t) => t.length > 0))];
  const map = new Map<string, string>();

  if (unique.length > 0) {
    const { rows } = await client.query<{ txt: string; n: string }>(
      `SELECT u AS txt, normalize_text(u) AS n
       FROM unnest($1::text[]) AS u`,
      [unique]
    );
    for (const row of rows) {
      map.set(row.txt, String(row.n));
    }
  }

  return async (text: string) => {
    const hit = map.get(text);
    if (hit !== undefined) return hit;
    const { rows } = await client.query('SELECT normalize_text($1) AS n', [text]);
    return String(rows[0].n);
  };
}
