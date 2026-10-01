/**
 * Point d’entrée unique pour les étapes 5.4–5.5 : une transaction ACID via `pg`.
 */

import type { ValidatedSnapshot } from '../llm/snapshotSchema.js';
import type { MemoryJob } from '../worker/memoryJobs.js';
import { withTransaction } from './db.js';
import { applySnapshotMemory } from './applySnapshotMemory.js';

export async function applySnapshot50Transaction(params: {
  job: MemoryJob;
  validated: ValidatedSnapshot;
}): Promise<void> {
  await withTransaction((client) =>
    applySnapshotMemory(client, {
      conversationId: params.job.conversation_id,
      userId: params.job.user_id,
      triggerUserMsgCount: params.job.trigger_user_msg_count,
      validated: params.validated,
    })
  );
}
