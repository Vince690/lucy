/*
  # Create user_ephemeral_events, user_life_events, user_mood_stats (mémoire Lucy étapes 2.5g–i)

  1. New Tables
    a) `user_ephemeral_events` — short-lived events with TTL (expires_at), 30 slots
    b) `user_life_events` — significant life events, 10 slots
    c) `user_mood_stats` — daily mood score (1–5), one entry per user per day

  2. Constraints
    - UNIQUE(user_id, event_key) on both event tables
    - UNIQUE(user_id, mood_date) on user_mood_stats
    - CHECK(mood_score BETWEEN 1 AND 5)

  3. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified (mood_entries is a separate table)
    - event_key is NOT auto-computed; backend calls normalize_text() before insert/update
    - expires_at, TTL cleanup, slot limits all handled by backend
*/

--------------------------------------------------------------------------------
-- 2.5g) user_ephemeral_events
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_ephemeral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_text text NOT NULL,
  event_key text NOT NULL,
  event_at timestamptz,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deduplication: one event per normalized key per user
ALTER TABLE user_ephemeral_events
  ADD CONSTRAINT uq_user_ephemeral_events_user_event_key UNIQUE (user_id, event_key);

-- Cleanup job: DELETE WHERE expires_at <= now()
CREATE INDEX IF NOT EXISTS idx_user_ephemeral_events_user_expires
  ON user_ephemeral_events(user_id, expires_at);

-- Slot eviction: oldest event per user
CREATE INDEX IF NOT EXISTS idx_user_ephemeral_events_user_created
  ON user_ephemeral_events(user_id, created_at);

--------------------------------------------------------------------------------
-- 2.5h) user_life_events
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_life_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_text text NOT NULL,
  event_key text NOT NULL,
  event_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deduplication: one event per normalized key per user
ALTER TABLE user_life_events
  ADD CONSTRAINT uq_user_life_events_user_event_key UNIQUE (user_id, event_key);

-- Fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_life_events_user_id
  ON user_life_events(user_id);

-- Slot eviction: oldest event per user (doc: ORDER BY created_at ASC LIMIT 1)
CREATE INDEX IF NOT EXISTS idx_user_life_events_user_created
  ON user_life_events(user_id, created_at);

--------------------------------------------------------------------------------
-- 2.5i) user_mood_stats
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_mood_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mood_score integer NOT NULL CHECK (mood_score >= 1 AND mood_score <= 5),
  mood_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One mood entry per user per day
ALTER TABLE user_mood_stats
  ADD CONSTRAINT uq_user_mood_stats_user_date UNIQUE (user_id, mood_date);

-- Query pattern: latest mood, 7-day rolling average (DESC for recent first)
CREATE INDEX IF NOT EXISTS idx_user_mood_stats_user_date_desc
  ON user_mood_stats(user_id, mood_date DESC);

-- Auto-update updated_at
CREATE TRIGGER update_user_mood_stats_updated_at
  BEFORE UPDATE ON user_mood_stats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
