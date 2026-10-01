/**
 * La dernière migration qui redéfinit write_user_message doit déclarer
 *   v_snapshot_user_msg_period constant integer := N
 * avec N === SEGMENT_USER_MESSAGES (constants.ts).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEGMENT_USER_MESSAGES, SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES } from '../../constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

describe('Alignement période snapshot SQL ↔ SEGMENT_USER_MESSAGES', () => {
  it('la dernière définition write_user_message déclare la même période que constants.ts', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let lastSql: string | null = null;
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      if (sql.includes('CREATE OR REPLACE FUNCTION write_user_message(')) {
        lastSql = sql;
      }
    }

    expect(lastSql).toBeTruthy();
    const m = lastSql!.match(
      /v_snapshot_user_msg_period\s+constant\s+integer\s*:=\s*(\d+)\s*;/,
    );
    expect(
      m,
      'v_snapshot_user_msg_period manquant dans la dernière migration write_user_message',
    ).toBeTruthy();
    expect(Number(m![1])).toBe(SEGMENT_USER_MESSAGES);

    const first = lastSql!.match(
      /v_snapshot_first_user_msg_count\s+constant\s+integer\s*:=\s*(\d+)\s*;/,
    );
    expect(
      first,
      'v_snapshot_first_user_msg_count manquant dans la dernière migration write_user_message',
    ).toBeTruthy();
    expect(Number(first![1])).toBe(SNAPSHOT_FIRST_TRIGGER_USER_MESSAGES);
  });
});
