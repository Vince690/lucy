/**
 * Étapes 5.4–5.5 : TTL, memory_snapshots, application mémoire (ordre §V.10).
 * Doit être exécuté dans une transaction (withTransaction).
 */

import type { PoolClient } from 'pg';
import {
  ALLOWED_TRAIT_KEYS,
  type ValidatedSnapshot,
} from '../llm/snapshotSchema.js';
import { NonRetryableError } from '../errors.js';
import { computeSnapshotUserMsgSeqRange } from './seqBounds.js';
import { computeEphemeralExpiresAt, parseIsoToDate } from './ephemeralExpires.js';
import { buildNormFromBatch, collectNormalizeTexts } from './normalizeBatch.js';

export interface ApplySnapshotMemoryParams {
  conversationId: string;
  userId: string;
  triggerUserMsgCount: number;
  validated: ValidatedSnapshot;
}

type Norm = (s: string) => Promise<string>;

// ── 5.4 : advisory lock utilisateur + verrou conversation + TTL + snapshot ──

/**
 * Acquiert le même advisory lock transactionnel que `reset_user_memory`
 * (clé : 884300, hashtext(user_id)).
 *
 * Sérialise snapshot ↔ reset pour un utilisateur donné : si un reset est en cours,
 * le snapshot attend la libération du lock (COMMIT/ROLLBACK du reset), puis échoue
 * proprement via `lockConversationOrThrow` (la conversation aura été supprimée).
 * Inverse : un reset concurrent attend la fin du snapshot avant de supprimer les tables.
 *
 * Note : `pg_advisory_xact_lock` est libéré automatiquement à la fin de la transaction.
 * Le `statement_timeout` positionné dans `withTransaction` s'applique à cette attente.
 */
async function acquireUserAdvisoryLock(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(884300, hashtext($1::text))`,
    [userId]
  );
}

async function lockConversationOrThrow(
  client: PoolClient,
  conversationId: string,
  userId: string
): Promise<void> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [conversationId, userId]
  );
  if (!rowCount) {
    // Erreur logique permanente : retenter ne changera rien → NonRetryableError.
    throw new NonRetryableError(
      `Conversation ${conversationId} introuvable ou user_id ne correspond pas au job`
    );
  }
}

async function deleteExpiredEphemerals(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `DELETE FROM user_ephemeral_events
     WHERE user_id = $1
       AND expires_at IS NOT NULL
       AND expires_at <= now()`,
    [userId]
  );
}

async function upsertMemorySnapshot(
  client: PoolClient,
  p: ApplySnapshotMemoryParams,
  snapshotPayload: Record<string, unknown>
): Promise<void> {
  const { seqFrom, seqTo } = computeSnapshotUserMsgSeqRange(p.triggerUserMsgCount);
  await client.query(
    `INSERT INTO memory_snapshots (
       conversation_id, user_id, trigger_user_msg_count,
       seq_from_user_msg_count, seq_to_user_msg_count, snapshot_json
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (conversation_id, trigger_user_msg_count) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       seq_from_user_msg_count = EXCLUDED.seq_from_user_msg_count,
       seq_to_user_msg_count = EXCLUDED.seq_to_user_msg_count,
       snapshot_json = EXCLUDED.snapshot_json`,
    [
      p.conversationId,
      p.userId,
      p.triggerUserMsgCount,
      seqFrom,
      seqTo,
      JSON.stringify(snapshotPayload),
    ]
  );
}

// ── Section 1 : user_identity ─────────────────────────────────────────────

async function applyUserIdentity(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot
): Promise<void> {
  const sec = validated.user_identity;
  if (!sec?.identity_update) return;
  const upd = sec.identity_update;
  const keys = Object.keys(upd) as (keyof typeof upd)[];
  if (keys.length === 0) return;

  await client.query(
    `INSERT INTO user_identity (user_id) VALUES ($1::uuid)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const k of keys) {
    const v = upd[k];
    if (k === 'occupation_status') {
      sets.push(`occupation_status = $${i}::occupation_status`);
    } else {
      sets.push(`${k} = $${i}`);
    }
    vals.push(v ?? null);
    i++;
  }
  sets.push('updated_at = now()');
  vals.push(userId);
  await client.query(
    `UPDATE user_identity SET ${sets.join(', ')} WHERE user_id = $${i}::uuid`,
    vals
  );
}

// ── Section 2 : goals ─────────────────────────────────────────────────────

async function applyGoals(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot,
  norm: Norm
): Promise<void> {
  const sec = validated.user_identity_goals;
  if (!sec?.goal) return;
  const goal = sec.goal;
  if (!goal) return;

  const gk = await norm(goal.goal_text);
  const ex = await client.query(
    `SELECT id FROM user_identity_goals WHERE user_id = $1 AND goal_key = $2 FOR UPDATE`,
    [userId, gk]
  );
  if (ex.rows.length) {
    await client.query(`UPDATE user_identity_goals SET last_seen_at = now() WHERE id = $1`, [
      ex.rows[0].id,
    ]);
    return;
  }

  const cnt = await client.query(
    `SELECT count(*)::int AS c FROM user_identity_goals WHERE user_id = $1`,
    [userId]
  );
  const c = cnt.rows[0].c as number;
  if (c < 3) {
    await client.query(
      `INSERT INTO user_identity_goals (user_id, goal_text, goal_key, last_seen_at)
       VALUES ($1, $2, $3, now())`,
      [userId, goal.goal_text, gk]
    );
  } else {
    const old = await client.query(
      `SELECT id FROM user_identity_goals WHERE user_id = $1 ORDER BY last_seen_at ASC LIMIT 1 FOR UPDATE`,
      [userId]
    );
    await client.query(
      `UPDATE user_identity_goals SET goal_text = $2, goal_key = $3, last_seen_at = now() WHERE id = $1`,
      [old.rows[0].id, goal.goal_text, gk]
    );
  }
}

// ── Section 3 : occupation notes ──────────────────────────────────────────

async function applyOccupationNotes(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot,
  norm: Norm
): Promise<void> {
  const sec = validated.user_occupation_notes;
  if (!sec?.notes.length) return;

  const seen = new Set<string>();
  let ops = 0;
  for (const note of sec.notes) {
    if (ops >= 2) break;
    const nk = await norm(note.note_text);
    if (seen.has(nk)) continue;
    seen.add(nk);
    ops++;

    const ex = await client.query(
      `SELECT id FROM user_occupation_notes WHERE user_id = $1 AND note_key = $2 FOR UPDATE`,
      [userId, nk]
    );
    if (ex.rows.length) {
      await client.query(`UPDATE user_occupation_notes SET last_seen_at = now() WHERE id = $1`, [
        ex.rows[0].id,
      ]);
      continue;
    }

    const cnt = await client.query(
      `SELECT count(*)::int AS c FROM user_occupation_notes WHERE user_id = $1`,
      [userId]
    );
    if (cnt.rows[0].c < 7) {
      await client.query(
        `INSERT INTO user_occupation_notes (user_id, note_text, note_key, last_seen_at)
         VALUES ($1, $2, $3, now())`,
        [userId, note.note_text, nk]
      );
    } else {
      const old = await client.query(
        `SELECT id FROM user_occupation_notes WHERE user_id = $1 ORDER BY last_seen_at ASC LIMIT 1 FOR UPDATE`,
        [userId]
      );
      await client.query(
        `UPDATE user_occupation_notes SET note_text = $2, note_key = $3, last_seen_at = now() WHERE id = $1`,
        [old.rows[0].id, note.note_text, nk]
      );
    }
  }
}

// ── Section 4 : traits (§III.3d 5.3) ───────────────────────────────────────

type TraitRow = { trait_key: string; strength: string };

/** Exporté pour tests unitaires (dédup intra-snapshot, deny gagne). */
export function preprocessTraits(
  traits: Array<{ trait_key: string; status: 'affirm' | 'deny' }>
): Array<{ trait_key: string; status: 'affirm' | 'deny' }> {
  const map = new Map<string, 'affirm' | 'deny'>();
  for (const t of traits) {
    const prev = map.get(t.trait_key);
    if (!prev) {
      map.set(t.trait_key, t.status);
    } else if (prev === 'deny' || t.status === 'deny') {
      map.set(t.trait_key, 'deny');
    } else {
      map.set(t.trait_key, 'affirm');
    }
  }
  return Array.from(map.entries()).map(([trait_key, status]) => ({ trait_key, status }));
}

/**
 * Calcule la nouvelle force d'un trait après affirm/deny (§III.3d).
 * - affirm : +0.15, plafonné à 1.0
 * - deny   : −0.25, plancher à 0.0
 * Exporté pour tests unitaires.
 */
export function computeNewTraitStrength(current: number, status: 'affirm' | 'deny'): number {
  if (status === 'affirm') return Math.min(current + 0.15, 1.0);
  return Math.max(current - 0.25, 0.0);
}

/**
 * Fusionne deux événements éphémères de même clé normalisée (§III.3g).
 * Règle : event_at prend le dessus sur l'absence de date.
 * Exporté pour tests unitaires.
 */
export function mergeEphemeralForKey(
  prev: { event_text: string; event_at: string | null },
  next: { event_text: string; event_at: string | null }
): { event_text: string; event_at: string | null } {
  return !prev.event_at && next.event_at ? next : prev;
}

/**
 * Sélectionne au plus 2 événements éphémères parmi N après dédup (§III.3g : max 2 ops par snapshot).
 * Priorité : événements avec date > sans date ; à parité, ordre alphabétique sur event_text.
 * Exporté pour tests unitaires.
 */
export function selectTopEphemeralEvents(
  evs: Array<{ event_text: string; event_at: string | null }>
): Array<{ event_text: string; event_at: string | null }> {
  if (evs.length <= 2) return evs;
  return [...evs]
    .sort((a, b) => {
      const at = a.event_at ? 0 : 1;
      const bt = b.event_at ? 0 : 1;
      if (at !== bt) return at - bt;
      return a.event_text.localeCompare(b.event_text);
    })
    .slice(0, 2);
}

async function applyTraits(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot
): Promise<void> {
  const sec = validated.user_traits;
  if (!sec?.traits.length) return;

  const items = preprocessTraits(sec.traits);

  for (const item of items) {
    const r = await client.query(
      `SELECT trait_key::text, strength::float8 AS strength FROM user_traits
       WHERE user_id = $1 AND trait_key = $2::trait_key FOR UPDATE`,
      [userId, item.trait_key]
    );
    if (!r.rows.length) continue;

    const strength = computeNewTraitStrength(
      Number((r.rows[0] as TraitRow).strength),
      item.status
    );

    await client.query(
      `UPDATE user_traits SET strength = $2::numeric(3,2), last_seen_at = now()
       WHERE user_id = $1 AND trait_key = $3::trait_key`,
      [userId, strength.toFixed(2), item.trait_key]
    );

    if (strength < 0.4) {
      await client.query(
        `DELETE FROM user_traits WHERE user_id = $1 AND trait_key = $2::trait_key`,
        [userId, item.trait_key]
      );
    }
  }

  const existingKeys = new Set<string>();
  const ex2 = await client.query(
    `SELECT trait_key::text FROM user_traits WHERE user_id = $1`,
    [userId]
  );
  for (const row of ex2.rows) {
    existingKeys.add(row.trait_key as string);
  }

  const newAffirm: string[] = [];
  for (const item of items) {
    if (item.status === 'affirm' && !existingKeys.has(item.trait_key)) {
      newAffirm.push(item.trait_key);
    }
  }
  if (newAffirm.length === 0) return;

  newAffirm.sort(
    (a, b) => ALLOWED_TRAIT_KEYS.indexOf(a as (typeof ALLOWED_TRAIT_KEYS)[number]) -
      ALLOWED_TRAIT_KEYS.indexOf(b as (typeof ALLOWED_TRAIT_KEYS)[number])
  );
  const pick = newAffirm[0];

  await client.query(
    `INSERT INTO user_traits (user_id, trait_key, strength, source, last_seen_at)
     VALUES ($1::uuid, $2::trait_key, 0.75, 'conversation'::trait_source, now())
     ON CONFLICT (user_id, trait_key) DO NOTHING`,
    [userId, pick]
  );
}

// ── Section 5 : preferences ────────────────────────────────────────────────

interface CatMeta {
  category_key: string;
  value_type: 'text' | 'enum' | 'bool';
  slot_limit: number;
}

async function loadPreferenceCategories(client: PoolClient): Promise<Map<string, CatMeta>> {
  const { rows } = await client.query(
    `SELECT category_key, value_type::text AS value_type, slot_limit FROM preference_categories`
  );
  const m = new Map<string, CatMeta>();
  for (const row of rows) {
    m.set(row.category_key as string, {
      category_key: row.category_key as string,
      value_type: row.value_type as CatMeta['value_type'],
      slot_limit: Number(row.slot_limit),
    });
  }
  return m;
}

async function applyPreferences(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot,
  norm: Norm
): Promise<void> {
  const sec = validated.user_preferences;
  if (!sec?.preferences.length) return;

  const seenCat = new Set<string>();
  const cats = await loadPreferenceCategories(client);

  for (const pref of sec.preferences) {
    if (seenCat.has(pref.category_key)) continue;
    seenCat.add(pref.category_key);

    const meta = cats.get(pref.category_key);
    if (!meta) continue;

    if (meta.value_type === 'bool') {
      if (typeof pref.value !== 'boolean') continue;
      const ex = await client.query(
        `SELECT id FROM user_preferences WHERE user_id = $1 AND category_key = $2 AND value_type = 'bool' FOR UPDATE`,
        [userId, pref.category_key]
      );
      if (ex.rows.length) {
        await client.query(
          `UPDATE user_preferences SET value_bool = $2, last_seen_at = now() WHERE id = $1`,
          [ex.rows[0].id, pref.value]
        );
      } else {
        await client.query(
          `INSERT INTO user_preferences (user_id, category_key, value_type, value_bool, last_seen_at)
           VALUES ($1, $2, 'bool', $3, now())`,
          [userId, pref.category_key, pref.value]
        );
      }
      continue;
    }

    if (meta.value_type === 'enum') {
      if (typeof pref.value !== 'string') continue;
      const ok = await client.query(
        `SELECT 1 FROM preference_category_enum_values WHERE category_key = $1 AND enum_value = $2`,
        [pref.category_key, pref.value]
      );
      if (!ok.rows.length) continue;

      const ex = await client.query(
        `SELECT id FROM user_preferences WHERE user_id = $1 AND category_key = $2 AND value_type = 'enum' AND value_enum = $3 FOR UPDATE`,
        [userId, pref.category_key, pref.value]
      );
      if (ex.rows.length) {
        await client.query(`UPDATE user_preferences SET last_seen_at = now() WHERE id = $1`, [
          ex.rows[0].id,
        ]);
        continue;
      }
      const cnt = await client.query(
        `SELECT count(*)::int AS c FROM user_preferences WHERE user_id = $1 AND category_key = $2`,
        [userId, pref.category_key]
      );
      if (cnt.rows[0].c < meta.slot_limit) {
        await client.query(
          `INSERT INTO user_preferences (user_id, category_key, value_type, value_enum, last_seen_at)
           VALUES ($1, $2, 'enum', $3, now())`,
          [userId, pref.category_key, pref.value]
        );
      } else {
        const old = await client.query(
          `SELECT id FROM user_preferences WHERE user_id = $1 AND category_key = $2 ORDER BY last_seen_at ASC LIMIT 1 FOR UPDATE`,
          [userId, pref.category_key]
        );
        await client.query(
          `UPDATE user_preferences SET value_enum = $2, last_seen_at = now() WHERE id = $1`,
          [old.rows[0].id, pref.value]
        );
      }
      continue;
    }

    if (meta.value_type === 'text') {
      if (typeof pref.value !== 'string') continue;
      const vk = await norm(pref.value);
      const ex = await client.query(
        `SELECT id FROM user_preferences WHERE user_id = $1 AND category_key = $2 AND value_type = 'text' AND value_key = $3 FOR UPDATE`,
        [userId, pref.category_key, vk]
      );
      if (ex.rows.length) {
        await client.query(`UPDATE user_preferences SET last_seen_at = now() WHERE id = $1`, [
          ex.rows[0].id,
        ]);
        continue;
      }
      const cnt = await client.query(
        `SELECT count(*)::int AS c FROM user_preferences WHERE user_id = $1 AND category_key = $2`,
        [userId, pref.category_key]
      );
      if (cnt.rows[0].c < meta.slot_limit) {
        await client.query(
          `INSERT INTO user_preferences (user_id, category_key, value_type, value_text, value_key, last_seen_at)
           VALUES ($1, $2, 'text', $3, $4, now())`,
          [userId, pref.category_key, pref.value, vk]
        );
      } else {
        const old = await client.query(
          `SELECT id FROM user_preferences WHERE user_id = $1 AND category_key = $2 ORDER BY last_seen_at ASC LIMIT 1 FOR UPDATE`,
          [userId, pref.category_key]
        );
        await client.query(
          `UPDATE user_preferences SET value_text = $2, value_key = $3, last_seen_at = now() WHERE id = $1`,
          [old.rows[0].id, pref.value, vk]
        );
      }
    }
  }
}

// ── Section 6 : relations ───────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function applyRelations(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot,
  norm: Norm
): Promise<void> {
  const sec = validated.user_relations;
  if (!sec?.relation) return;
  const rel = sec.relation;
  if (!rel) return;

  if (rel.match_id && isUuid(rel.match_id)) {
    const row = await client.query(
      `SELECT id FROM user_relations WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [rel.match_id, userId]
    );
    if (!row.rows.length) {
      throw new Error(`match_id ${rel.match_id} introuvable pour cet utilisateur`);
    }
    const cur = await client.query(
      `SELECT relation_type::text FROM user_relations WHERE id = $1`,
      [rel.match_id]
    );
    const dbType = (cur.rows[0].relation_type as string) || 'unknown';
    let setType = false;
    if (rel.relation_type !== 'unknown' && dbType === 'unknown') {
      setType = true;
    }
    if (setType) {
      await client.query(
        `UPDATE user_relations SET relation_type = $2::relation_type, last_seen_at = now() WHERE id = $1`,
        [rel.match_id, rel.relation_type]
      );
    } else {
      await client.query(`UPDATE user_relations SET last_seen_at = now() WHERE id = $1`, [
        rel.match_id,
      ]);
    }
    return;
  }

  const rawName = rel.name_raw;
  if (!rawName) return;

  const nk = await norm(rawName);
  const ex = await client.query(
    `SELECT id FROM user_relations WHERE user_id = $1 AND name_key = $2 FOR UPDATE`,
    [userId, nk]
  );
  if (ex.rows.length) {
    const cur = await client.query(
      `SELECT relation_type::text FROM user_relations WHERE id = $1`,
      [ex.rows[0].id]
    );
    const dbType = (cur.rows[0].relation_type as string) || 'unknown';
    let setType = false;
    if (rel.relation_type !== 'unknown' && dbType === 'unknown') {
      setType = true;
    }
    if (setType) {
      await client.query(
        `UPDATE user_relations SET relation_type = $2::relation_type, last_seen_at = now() WHERE id = $1`,
        [ex.rows[0].id, rel.relation_type]
      );
    } else {
      await client.query(`UPDATE user_relations SET last_seen_at = now() WHERE id = $1`, [
        ex.rows[0].id,
      ]);
    }
    return;
  }

  const cnt = await client.query(
    `SELECT count(*)::int AS c FROM user_relations WHERE user_id = $1`,
    [userId]
  );
  if (cnt.rows[0].c < 10) {
    await client.query(
      `INSERT INTO user_relations (user_id, name_raw, name_key, relation_type, last_seen_at)
       VALUES ($1, $2, $3, $4::relation_type, now())`,
      [userId, rawName, nk, rel.relation_type]
    );
  } else {
    const old = await client.query(
      `SELECT id FROM user_relations WHERE user_id = $1 ORDER BY last_seen_at ASC LIMIT 1 FOR UPDATE`,
      [userId]
    );
    await client.query(
      `UPDATE user_relations SET name_raw = $2, name_key = $3, relation_type = $4::relation_type, last_seen_at = now() WHERE id = $1`,
      [old.rows[0].id, rawName, nk, rel.relation_type]
    );
  }
}

// ── Section 7 : ephemeral events ───────────────────────────────────────────

async function applyEphemeralEvents(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot,
  norm: Norm
): Promise<void> {
  const sec = validated.user_ephemeral_events;
  if (!sec?.events.length) return;

  const byKey = new Map<string, { event_text: string; event_at: string | null }>();
  for (const e of sec.events) {
    const nk = await norm(e.event_text);
    const prev = byKey.get(nk);
    byKey.set(nk, prev ? mergeEphemeralForKey(prev, e) : e);
  }
  let evs = selectTopEphemeralEvents(Array.from(byKey.values()));

  const nowMs = Date.now();
  for (const ev of evs) {
    const ek = await norm(ev.event_text);
    const snapAt = parseIsoToDate(ev.event_at);
    const ex = await client.query(
      `SELECT id, event_at, event_text FROM user_ephemeral_events WHERE user_id = $1 AND event_key = $2 FOR UPDATE`,
      [userId, ek]
    );

    if (ex.rows.length) {
      const row = ex.rows[0] as { id: string; event_at: Date | null; event_text: string };
      let finalAt: Date | null = row.event_at;
      if (snapAt !== null) {
        finalAt = snapAt;
      }
      const exp = computeEphemeralExpiresAt(finalAt, nowMs);
      if (!exp) continue;

      await client.query(
        `UPDATE user_ephemeral_events SET
           last_seen_at = now(),
           event_at = COALESCE($2::timestamptz, event_at),
           event_text = $3,
           expires_at = $4::timestamptz
         WHERE id = $1`,
        [row.id, snapAt, ev.event_text, exp]
      );
      continue;
    }

    const finalAt = snapAt;
    const exp = computeEphemeralExpiresAt(finalAt, nowMs);
    if (!exp) continue;

    const activeCnt = await client.query(
      `SELECT count(*)::int AS c FROM user_ephemeral_events WHERE user_id = $1 AND expires_at > now()`,
      [userId]
    );
    if (activeCnt.rows[0].c < 30) {
      await client.query(
        `INSERT INTO user_ephemeral_events (user_id, event_text, event_key, event_at, expires_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [userId, ev.event_text, ek, finalAt, exp]
      );
    } else {
      const old = await client.query(
        `SELECT id FROM user_ephemeral_events WHERE user_id = $1 AND expires_at > now() ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
        [userId]
      );
      if (!old.rows.length) continue;
      await client.query(
        `UPDATE user_ephemeral_events SET
           event_text = $2, event_key = $3, event_at = $4, expires_at = $5, last_seen_at = now()
         WHERE id = $1`,
        [old.rows[0].id, ev.event_text, ek, finalAt, exp]
      );
    }
  }
}

// ── Section 8 : life events ─────────────────────────────────────────────────

async function applyLifeEvents(
  client: PoolClient,
  userId: string,
  validated: ValidatedSnapshot,
  norm: Norm
): Promise<void> {
  const sec = validated.user_life_events;
  if (!sec?.events.length) return;
  const item = sec.events[0];
  const ek = await norm(item.event_text);
  const snapAt = parseIsoToDate(item.event_at);

  const ex = await client.query(
    `SELECT id, event_at FROM user_life_events WHERE user_id = $1 AND event_key = $2 FOR UPDATE`,
    [userId, ek]
  );

  if (ex.rows.length) {
    const id = ex.rows[0].id as string;
    const dbAt = ex.rows[0].event_at as Date | null;
    if (snapAt !== null && dbAt === null) {
      await client.query(
        `UPDATE user_life_events SET last_seen_at = now(), event_at = $2::timestamptz WHERE id = $1`,
        [id, snapAt]
      );
    } else {
      await client.query(`UPDATE user_life_events SET last_seen_at = now() WHERE id = $1`, [id]);
    }
    return;
  }

  const cnt = await client.query(
    `SELECT count(*)::int AS c FROM user_life_events WHERE user_id = $1`,
    [userId]
  );
  if (cnt.rows[0].c < 10) {
    await client.query(
      `INSERT INTO user_life_events (user_id, event_text, event_key, event_at, last_seen_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, item.event_text, ek, snapAt]
    );
  } else {
    const old = await client.query(
      `SELECT id FROM user_life_events WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [userId]
    );
    await client.query(
      `UPDATE user_life_events SET event_text = $2, event_key = $3, event_at = $4, last_seen_at = now() WHERE id = $1`,
      [old.rows[0].id, item.event_text, ek, snapAt]
    );
  }
}

// ── Orchestrateur ──────────────────────────────────────────────────────────

/**
 * Applique 5.4 + 5.5 dans le client de transaction déjà ouvert.
 */
export async function applySnapshotMemory(
  client: PoolClient,
  params: ApplySnapshotMemoryParams
): Promise<void> {
  const toNorm = collectNormalizeTexts(params.validated);
  const norm: Norm = await buildNormFromBatch(client, toNorm);

  // Advisory lock en premier : sérialise avec reset_user_memory (§VI.3).
  await acquireUserAdvisoryLock(client, params.userId);
  await lockConversationOrThrow(client, params.conversationId, params.userId);
  await deleteExpiredEphemerals(client, params.userId);

  const snapshotPayload = {
    ...params.validated,
    _applied_at: new Date().toISOString(),
    _conversation_id: params.conversationId,
    _trigger_user_msg_count: params.triggerUserMsgCount,
  };

  await upsertMemorySnapshot(client, params, snapshotPayload);

  await applyUserIdentity(client, params.userId, params.validated);
  await applyGoals(client, params.userId, params.validated, norm);
  await applyOccupationNotes(client, params.userId, params.validated, norm);
  await applyTraits(client, params.userId, params.validated);
  await applyPreferences(client, params.userId, params.validated, norm);
  await applyRelations(client, params.userId, params.validated, norm);
  await applyEphemeralEvents(client, params.userId, params.validated, norm);
  await applyLifeEvents(client, params.userId, params.validated, norm);
}
