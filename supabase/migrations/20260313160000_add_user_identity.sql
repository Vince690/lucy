/*
  # Create user_identity table (mémoire Lucy étape 2.5a)

  1. New Types
    - `user_gender` enum: male, female, other, prefer_not_to_say
    - `occupation_status` enum: study, work, none

  2. New Table
    - `user_identity` — one row per user, stores core identity + life-context fields
      - `user_id` (uuid, PK, FK -> auth.users)
      - `first_name` (text) — onboarding / settings only
      - `age` (integer, nullable) — onboarding / settings only
      - `gender` (user_gender, nullable) — onboarding / settings only
      - `location_general` (text, nullable) — settings + snapshots
      - `occupation_status` (occupation_status, nullable) — settings + snapshots
      - `occupation_position` (text, nullable) — settings + snapshots
      - `occupation_domain` (text, nullable) — settings + snapshots
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  3. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - One row per user enforced by PK on user_id
*/

-- Enum for gender (matches onboarding options)
CREATE TYPE user_gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- Enum for occupation status (matches spec III.3a)
CREATE TYPE occupation_status AS ENUM ('study', 'work', 'none');

-- user_identity table (1 row per user)
CREATE TABLE IF NOT EXISTS user_identity (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text,
  age integer CHECK (age > 0 AND age < 150),
  gender user_gender,
  location_general text,
  occupation_status occupation_status,
  occupation_position text,
  occupation_domain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER update_user_identity_updated_at
  BEFORE UPDATE ON user_identity
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
