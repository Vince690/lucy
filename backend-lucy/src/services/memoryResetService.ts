/**
 * Reset mémoire complet (§VI) via RPC Postgres `reset_user_memory`.
 * Inclut conversations (cascade messages/jobs/snapshots), tables mémoire Lucy,
 * `mood_entries`, et insertion dans `user_memory_reset_log`.
 */

import { supabaseAdmin } from '../supabase.js';

export class MemoryResetError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown = null
  ) {
    super(message);
    this.name = 'MemoryResetError';
  }
}

export async function resetUserMemory(
  userId: string,
  reason: 'user_action' | 'admin_action' | 'system_migration' = 'user_action'
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabaseAdmin.rpc('reset_user_memory', {
    p_user_id: userId,
    p_reason: reason,
  });

  if (error) {
    throw new MemoryResetError(`reset_user_memory: ${error.message}`, error);
  }

  const row = data as { ok?: boolean; reason?: string } | null;
  if (!row?.ok) {
    throw new MemoryResetError('reset_user_memory: réponse inattendue');
  }

  return { ok: true, reason: row.reason ?? reason };
}
