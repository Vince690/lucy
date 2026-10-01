/*
  # Create User Profiles and Update Mood Entries

  ## 1. New Tables
    - `profiles`
      - `id` (uuid, primary key) - Unique identifier, matches auth.users.id
      - `user_id` (uuid, foreign key) - References auth.users.id
      - `first_name` (text) - User's first name
      - `date_of_birth` (date) - User's date of birth for age calculation
      - `gender` (text, nullable) - User's gender (optional)
      - `timezone` (text) - User's timezone for notifications
      - `notification_preferences` (jsonb) - JSON object storing notification settings
      - `avatar_url` (text, nullable) - URL to user's avatar image
      - `onboarding_completed` (boolean, default false) - Tracks if user completed onboarding
      - `created_at` (timestamptz) - Profile creation timestamp
      - `updated_at` (timestamptz) - Last profile update timestamp

  ## 2. Changes to Existing Tables
    - Add `user_id` column to `mood_entries` table
    - Create foreign key constraint linking mood_entries to auth.users
    - Update existing mood_entries to set user_id to NULL (will be cleaned up manually)

  ## 3. Security - Row Level Security (RLS)
    - Enable RLS on `profiles` table
    - Policy: Users can only view their own profile
    - Policy: Users can only insert their own profile
    - Policy: Users can only update their own profile
    - Policy: Users can only delete their own profile
    
    - Update RLS on `mood_entries` table
    - Policy: Users can only view their own mood entries
    - Policy: Users can only insert mood entries for themselves
    - Policy: Users can only update their own mood entries
    - Policy: Users can only delete their own mood entries

  ## 4. Triggers
    - Create trigger to automatically create a profile when a new user signs up
    - Create trigger to update updated_at timestamp on profile changes

  ## 5. Indexes
    - Create index on profiles.user_id for faster queries
    - Create index on mood_entries.user_id for faster queries
    - Create composite index on mood_entries(user_id, date) for optimal query performance

  ## 6. Important Security Notes
    - All policies use auth.uid() to ensure users can only access their own data
    - Profiles are automatically created via trigger when users sign up
    - No user can access another user's profile or mood entries
    - The notification_preferences column stores JSON for flexibility
    - Default timezone is set but can be updated by the user
*/

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  first_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text,
  timezone text NOT NULL DEFAULT 'UTC',
  notification_preferences jsonb DEFAULT '{"enabled": true, "daily_reminder": true, "weekly_summary": true}'::jsonb,
  avatar_url text,
  onboarding_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes on profiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

-- Add user_id column to mood_entries if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' 
    AND table_name = 'mood_entries' 
    AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.mood_entries ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create indexes on mood_entries
CREATE INDEX IF NOT EXISTS idx_mood_entries_user_id ON public.mood_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_mood_entries_user_date ON public.mood_entries(user_id, date);

-- Update the unique constraint on mood_entries to include user_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'mood_entries' 
    AND constraint_name = 'mood_entries_date_key'
  ) THEN
    ALTER TABLE public.mood_entries DROP CONSTRAINT mood_entries_date_key;
  END IF;
END $$;

-- Add new unique constraint for user_id + date combination
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema = 'public' 
    AND table_name = 'mood_entries' 
    AND constraint_name = 'mood_entries_user_id_date_key'
  ) THEN
    ALTER TABLE public.mood_entries ADD CONSTRAINT mood_entries_user_id_date_key UNIQUE(user_id, date);
  END IF;
END $$;

-- Enable RLS on profiles table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop old permissive policies on mood_entries
DROP POLICY IF EXISTS "Anyone can view mood entries" ON public.mood_entries;
DROP POLICY IF EXISTS "Anyone can insert mood entries" ON public.mood_entries;
DROP POLICY IF EXISTS "Anyone can update mood entries" ON public.mood_entries;

-- Create RLS policies for profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create RLS policies for mood_entries
CREATE POLICY "Users can view own mood entries"
  ON public.mood_entries
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mood entries"
  ON public.mood_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mood entries"
  ON public.mood_entries
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mood entries"
  ON public.mood_entries
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, first_name, date_of_birth, timezone, onboarding_completed)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', 'User'),
    COALESCE((NEW.raw_user_meta_data->>'date_of_birth')::date, CURRENT_DATE),
    COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC'),
    false
  );
  RETURN NEW;
END;
$$;

-- Create trigger to call handle_new_user function
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- Create function to update updated_at on profiles
CREATE OR REPLACE FUNCTION public.update_profiles_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_catalog
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for profiles updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at_trigger'
  ) THEN
    CREATE TRIGGER update_profiles_updated_at_trigger
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.update_profiles_updated_at();
  END IF;
END $$;