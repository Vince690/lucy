/*
  # Create mood_entries table

  1. New Tables
    - `mood_entries`
      - `id` (uuid, primary key) - Unique identifier for each mood entry
      - `date` (date, unique) - The date of the mood entry (one entry per day)
      - `mood` (integer) - Mood value from 1-5 (1=very bad, 5=very good)
      - `modified` (boolean, default false) - Whether the entry has been modified after initial creation
      - `created_at` (timestamptz, default now()) - Timestamp when the entry was created
      - `updated_at` (timestamptz, default now()) - Timestamp when the entry was last updated

  2. Security
    - Enable RLS on `mood_entries` table
    - Add policy for anyone to read all mood entries (temporary - will be restricted per user when auth is added)
    - Add policy for anyone to insert new mood entries
    - Add policy for anyone to update mood entries
    
  3. Indexes
    - Create index on date for faster queries
    
  4. Important Notes
    - Currently using permissive policies for testing without authentication
    - When user authentication is added, policies should be updated to restrict access to user's own data only
    - The `date` column has a unique constraint to prevent multiple entries per day
*/

CREATE TABLE IF NOT EXISTS mood_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date UNIQUE NOT NULL,
  mood integer NOT NULL CHECK (mood >= 1 AND mood <= 5),
  modified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mood_entries_date ON mood_entries(date);

ALTER TABLE mood_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view mood entries"
  ON mood_entries
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert mood entries"
  ON mood_entries
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can update mood entries"
  ON mood_entries
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_mood_entries_updated_at'
  ) THEN
    CREATE TRIGGER update_mood_entries_updated_at 
      BEFORE UPDATE ON mood_entries 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
