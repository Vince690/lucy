/*
  # Create memory_snapshots table (mémoire Lucy étape 2.4)

  1. New Table
    - `memory_snapshots` — stores LLM-generated snapshot JSON for a conversation segment
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, FK -> conversations)
      - `user_id` (uuid, FK -> auth.users)
      - `trigger_user_msg_count` (integer) - user_msg_count that triggered this snapshot
      - `seq_from_user_msg_count` (integer) - start of analysed segment (inclusive)
      - `seq_to_user_msg_count` (integer) - end of analysed segment (inclusive)
      - `snapshot_json` (jsonb) - LLM-generated snapshot output
      - `created_at` (timestamptz)

  2. Constraints
    - UNIQUE(conversation_id, trigger_user_msg_count) for idempotence (no duplicate snapshot per trigger)
    - CHECK(trigger_user_msg_count > 0)
    - CHECK(seq_from_user_msg_count > 0)
    - CHECK(seq_to_user_msg_count >= seq_from_user_msg_count)

  3. Indexes
    - (conversation_id) for fast lookup by conversation

  4. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
*/

CREATE TABLE IF NOT EXISTS memory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_user_msg_count integer NOT NULL CHECK (trigger_user_msg_count > 0),
  seq_from_user_msg_count integer NOT NULL CHECK (seq_from_user_msg_count > 0),
  seq_to_user_msg_count integer NOT NULL CHECK (seq_to_user_msg_count >= seq_from_user_msg_count),
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotence: one snapshot per (conversation, trigger count)
ALTER TABLE memory_snapshots
  ADD CONSTRAINT uq_memory_snapshots_idempotent UNIQUE (conversation_id, trigger_user_msg_count);

-- Fast lookup by conversation
CREATE INDEX IF NOT EXISTS idx_memory_snapshots_conversation_id ON memory_snapshots(conversation_id);
