/*
  # Create user_memory_reset_log table (mémoire Lucy étape 2.6)

  1. New Types
    - `memory_reset_reason` enum: user_action, admin_action, system_migration

  2. New Table
    - `user_memory_reset_log` — journal of memory resets
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> auth.users)
      - `reset_at` (timestamptz) — when the reset was executed
      - `reason` (memory_reset_reason) — cause of the reset
      - `created_at` (timestamptz)

  3. Indexes
    - (user_id) for listing resets per user

  4. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - Reset logic (data deletion, counter reset) is NOT in this migration
*/

-- Reason for a memory reset (§VI.6)
CREATE TYPE memory_reset_reason AS ENUM ('user_action', 'admin_action', 'system_migration');

-- Reset log table
CREATE TABLE IF NOT EXISTS user_memory_reset_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reset_at timestamptz NOT NULL,
  reason memory_reset_reason NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- List resets per user
CREATE INDEX IF NOT EXISTS idx_user_memory_reset_log_user_id
  ON user_memory_reset_log(user_id);
