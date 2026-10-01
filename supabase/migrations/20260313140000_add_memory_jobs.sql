/*
  # Create memory_jobs table (mémoire Lucy étape 2.3)

  Note : le type purge_100 a été retiré du produit — contrainte et RPC à jour dans
  20260325120000_remove_purge_100_memory_jobs.sql

  1. New Table
    - `memory_jobs` — queue for async memory jobs (snapshot_50 ; purge_100 retiré ensuite)
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, FK -> conversations)
      - `user_id` (uuid, FK -> auth.users)
      - `job_type` (text, 'snapshot_50' or 'purge_100')
      - `trigger_user_msg_count` (integer) - user_msg_count that triggered this job
      - `status` (text, default 'pending') - pending | running | done | failed
      - `attempt_count` (integer, default 0)
      - `locked_at` (timestamptz, nullable) - set when worker picks up the job
      - `last_error` (text, nullable) - last failure message
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Constraints
    - UNIQUE(conversation_id, job_type, trigger_user_msg_count) for idempotence
    - CHECK(trigger_user_msg_count > 0) — jobs are created at 50, 100, etc.

  3. Indexes
    - Partial index on (created_at) WHERE status = 'pending' for worker polling

  4. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - Worker should SELECT pending jobs with FOR UPDATE SKIP LOCKED to avoid double processing
*/

CREATE TABLE IF NOT EXISTS memory_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('snapshot_50', 'purge_100')),
  trigger_user_msg_count integer NOT NULL CHECK (trigger_user_msg_count > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotence: one job per (conversation, type, trigger count)
ALTER TABLE memory_jobs
  ADD CONSTRAINT uq_memory_jobs_idempotent UNIQUE (conversation_id, job_type, trigger_user_msg_count);

-- Worker polls pending jobs ordered by creation time (partial index for efficiency)
CREATE INDEX IF NOT EXISTS idx_memory_jobs_pending ON memory_jobs(created_at) WHERE (status = 'pending');

-- Auto-update updated_at
CREATE TRIGGER update_memory_jobs_updated_at
  BEFORE UPDATE ON memory_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
