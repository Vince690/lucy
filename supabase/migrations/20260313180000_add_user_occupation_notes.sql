/*
  # Create user_occupation_notes table (mémoire Lucy étape 2.5c)

  1. New Table
    - `user_occupation_notes` — occupation-related notes with deduplication via note_key
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> auth.users)
      - `note_text` (text) — raw display value
      - `note_key` (text) — normalized key for deduplication (computed by backend)
      - `last_seen_at` (timestamptz) — updated when note is seen again or deduplicated
      - `created_at` (timestamptz)

  2. Constraints
    - UNIQUE(user_id, note_key) for deduplication safety net
    - Max 7 notes per user enforced by backend, not DB

  3. Indexes
    - (user_id) for fast user lookup
    - (user_id, last_seen_at) for slot eviction query (oldest first)

  4. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - note_key is NOT auto-computed; backend calls normalize_text() before insert/update
*/

CREATE TABLE IF NOT EXISTS user_occupation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  note_key text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deduplication: one note per normalized key per user
ALTER TABLE user_occupation_notes
  ADD CONSTRAINT uq_user_occupation_notes_user_note_key UNIQUE (user_id, note_key);

-- Fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_occupation_notes_user_id
  ON user_occupation_notes(user_id);

-- Slot eviction: find oldest note per user (ORDER BY last_seen_at ASC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_user_occupation_notes_user_last_seen
  ON user_occupation_notes(user_id, last_seen_at);
