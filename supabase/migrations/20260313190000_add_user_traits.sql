/*
  # Create user_traits table (mémoire Lucy étape 2.5d)

  1. New Types
    - `trait_key` enum: 10 closed-list personality traits
    - `trait_source` enum: onboarding, conversation

  2. New Table
    - `user_traits` — one row per (user, trait), strength updated over time
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK -> auth.users)
      - `trait_key` (trait_key enum) — closed list of 10 traits
      - `strength` (numeric(3,2)) — certainty degree in [0, 1]
      - `source` (trait_source enum) — origin of the trait
      - `last_seen_at` (timestamptz) — last interaction related to this trait
      - `created_at` (timestamptz)

  3. Constraints
    - UNIQUE(user_id, trait_key) for UPSERT logic
    - CHECK(strength >= 0 AND strength <= 1)

  4. Indexes
    - (user_id) for fetching all traits of a user

  5. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - priority_score is computed at query time by backend, not stored
*/

-- Closed list of 10 trait keys (§III.3d)
CREATE TYPE trait_key AS ENUM (
  'anxious',
  'joyful',
  'hypersensitive',
  'confident',
  'insecure',
  'ambitious',
  'optimistic',
  'introverted',
  'extroverted',
  'calm'
);

-- Source of a trait observation
CREATE TYPE trait_source AS ENUM ('onboarding', 'conversation');

-- user_traits table
CREATE TABLE IF NOT EXISTS user_traits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trait_key trait_key NOT NULL,
  strength numeric(3,2) NOT NULL CHECK (strength >= 0 AND strength <= 1),
  source trait_source NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- UPSERT safety: one trait per user
ALTER TABLE user_traits
  ADD CONSTRAINT uq_user_traits_user_trait_key UNIQUE (user_id, trait_key);

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS idx_user_traits_user_id
  ON user_traits(user_id);
