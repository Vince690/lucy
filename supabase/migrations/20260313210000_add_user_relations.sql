/*
  # Create user_relations table (mémoire Lucy étape 2.5f)

  1. New Types
    - `relation_type` enum: unknown, family, friend, partner, coworker, classmate, roommate

  2. New Table
    - `user_relations` — important people in the user's life, one row per person
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> auth.users)
      - `name_raw` (text) — display name / nickname
      - `name_key` (text) — normalized key for deduplication (computed by backend)
      - `relation_type` (relation_type enum, default unknown)
      - `last_seen_at` (timestamptz)
      - `created_at` (timestamptz)

  3. Constraints
    - UNIQUE(user_id, name_key) for deduplication safety net
    - Max 10 relations per user enforced by backend, not DB

  4. Indexes
    - (user_id) for fast user lookup
    - (user_id, last_seen_at) for slot eviction query (oldest first)

  5. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - name_key is NOT auto-computed; backend calls normalize_text() before insert/update
*/

-- Relation type enum (§III.3f §2)
CREATE TYPE relation_type AS ENUM (
  'unknown',
  'family',
  'friend',
  'partner',
  'coworker',
  'classmate',
  'roommate'
);

-- user_relations table
CREATE TABLE IF NOT EXISTS user_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name_raw text NOT NULL,
  name_key text NOT NULL,
  relation_type relation_type NOT NULL DEFAULT 'unknown',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deduplication: one person per normalized name per user
ALTER TABLE user_relations
  ADD CONSTRAINT uq_user_relations_user_name_key UNIQUE (user_id, name_key);

-- Fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_relations_user_id
  ON user_relations(user_id);

-- Slot eviction: find oldest relation per user
CREATE INDEX IF NOT EXISTS idx_user_relations_user_last_seen
  ON user_relations(user_id, last_seen_at);
