/*
  # Create preference tables (mémoire Lucy étape 2.5e)

  1. New Types
    - `preference_value_type` enum: text, enum, bool

  2. New Tables (in dependency order)
    - `preference_categories` — static config: value_type + slot_limit per category
    - `preference_category_enum_values` — allowed enum values per category
    - `user_preferences` — one row per user preference

  3. Constraints
    - Partial UNIQUE indexes on user_preferences by value_type for deduplication
    - FK references to auth.users and preference_categories

  4. Seed data
    - All categories A–J from §III.3e with their value_type and slot_limit
    - All enum values for arts_preferred_forms and vibe_preferences

  5. Notes
    - RLS is NOT enabled here (planned for étape 2.8)
    - No existing tables are modified
    - Slot enforcement and deduplication logic handled by backend
*/

-- Value type enum shared by preference_categories and user_preferences
CREATE TYPE preference_value_type AS ENUM ('text', 'enum', 'bool');

--------------------------------------------------------------------------------
-- 1. preference_categories (static config, created first)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS preference_categories (
  category_key text PRIMARY KEY,
  value_type preference_value_type NOT NULL,
  slot_limit integer NOT NULL CHECK (slot_limit > 0)
);

--------------------------------------------------------------------------------
-- 2. preference_category_enum_values (depends on preference_categories)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS preference_category_enum_values (
  category_key text NOT NULL REFERENCES preference_categories(category_key) ON DELETE CASCADE,
  enum_value text NOT NULL,
  CONSTRAINT uq_pref_cat_enum_val UNIQUE (category_key, enum_value)
);

--------------------------------------------------------------------------------
-- 3. user_preferences (depends on preference_categories and auth.users)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_key text NOT NULL REFERENCES preference_categories(category_key),
  value_type preference_value_type NOT NULL,
  value_text text,
  value_enum text,
  value_bool boolean,
  value_key text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by user
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id
  ON user_preferences(user_id);

-- Slot eviction: oldest preference per (user, category)
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_cat_last_seen
  ON user_preferences(user_id, category_key, last_seen_at);

-- Deduplication safety nets (partial UNIQUE indexes by value_type)

-- text categories: one entry per normalized key per (user, category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_preferences_text
  ON user_preferences(user_id, category_key, value_key)
  WHERE value_type = 'text';

-- enum categories: one entry per enum value per (user, category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_preferences_enum
  ON user_preferences(user_id, category_key, value_enum)
  WHERE value_type = 'enum';

-- bool categories: one entry per (user, category)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_preferences_bool
  ON user_preferences(user_id, category_key)
  WHERE value_type = 'bool';

--------------------------------------------------------------------------------
-- 4. Seed: categories A–J (§III.3e lines 1332–1481)
--------------------------------------------------------------------------------

INSERT INTO preference_categories (category_key, value_type, slot_limit) VALUES
  -- A) Food / Drink
  ('food_favorites',        'text', 3),
  ('food_dislikes',         'text', 3),
  ('drink_favorites',       'text', 3),
  ('drink_dislikes',        'text', 3),
  -- B) Sport
  ('sports_liked',          'text', 4),
  ('sports_disliked',       'text', 3),
  -- C) Musique
  ('music_genres',          'text', 3),
  ('music_artists',         'text', 3),
  -- D) Audiovisuel
  ('movies_favorites',      'text', 5),
  ('series_favorites',      'text', 5),
  ('audiovisual_genres',    'text', 3),
  -- E) Lecture
  ('book_genres',           'text', 3),
  ('book_authors',          'text', 3),
  ('books_favorites',       'text', 5),
  -- F) Jeux
  ('videogames_favorites',  'text', 5),
  ('boardgames_favorites',  'text', 5),
  -- G) Arts / Culture
  ('arts_preferred_forms',  'enum', 2),
  -- H) Vibe
  ('vibe_preferences',      'enum', 2),
  -- I) Centres d'intérêt
  ('topics_interests',      'text', 3),
  -- J) Voyage
  ('travel_like',           'bool', 1),
  ('travel_places_liked',   'text', 3);

--------------------------------------------------------------------------------
-- 5. Seed: enum values for enum-type categories
--------------------------------------------------------------------------------

-- G) arts_preferred_forms
INSERT INTO preference_category_enum_values (category_key, enum_value) VALUES
  ('arts_preferred_forms', 'cinema'),
  ('arts_preferred_forms', 'music'),
  ('arts_preferred_forms', 'literature'),
  ('arts_preferred_forms', 'visual_arts'),
  ('arts_preferred_forms', 'theatre'),
  ('arts_preferred_forms', 'dance'),
  ('arts_preferred_forms', 'architecture');

-- H) vibe_preferences
INSERT INTO preference_category_enum_values (category_key, enum_value) VALUES
  ('vibe_preferences', 'calm'),
  ('vibe_preferences', 'lively'),
  ('vibe_preferences', 'crowded'),
  ('vibe_preferences', 'quiet'),
  ('vibe_preferences', 'outdoors'),
  ('vibe_preferences', 'indoors'),
  ('vibe_preferences', 'cozy');
