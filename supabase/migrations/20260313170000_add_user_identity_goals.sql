/*
  # Create user_identity_goals table (mémoire Lucy étape 2.5b)

  1. New Table
    - `user_identity_goals` — user goals with deduplication via goal_key
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> auth.users)
      - `goal_text` (text) — raw display value
      - `goal_key` (text) — normalized key for deduplication (computed by backend)
      - `last_seen_at` (timestamptz) — updated when goal is seen again or deduplicated
      - `created_at` (timestamptz)

  2. Constraints
    - UNIQUE(user_id, goal_key) for deduplication safety net
    - Max 3 goals per user enforced by backend, not DB

  3. Indexes
    - (user_id, last_seen_at) for slot eviction query (oldest first)

  4. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - goal_key is NOT auto-computed; backend calls normalize_text() before insert/update
*/

CREATE TABLE IF NOT EXISTS user_identity_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_text text NOT NULL,
  goal_key text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deduplication: one goal per normalized key per user
ALTER TABLE user_identity_goals
  ADD CONSTRAINT uq_user_identity_goals_user_goal_key UNIQUE (user_id, goal_key);

-- Slot eviction: find oldest goal per user (ORDER BY last_seen_at ASC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_user_identity_goals_user_last_seen
  ON user_identity_goals(user_id, last_seen_at);
