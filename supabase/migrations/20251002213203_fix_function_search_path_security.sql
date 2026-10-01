/*
  # Fix Function Search Path Security Issue

  1. Changes
    - Drop the existing trigger first
    - Drop the existing update_updated_at_column function
    - Recreate the function with SECURITY DEFINER and explicit schema-qualified search_path
    - Recreate the trigger
    - This prevents potential SQL injection attacks through search_path manipulation
    
  2. Security Notes
    - Setting search_path explicitly ensures the function always uses the correct schema
    - SECURITY DEFINER with proper search_path prevents privilege escalation
    - Function now references pg_catalog explicitly for built-in functions
*/

DROP TRIGGER IF EXISTS update_mood_entries_updated_at ON mood_entries;

DROP FUNCTION IF EXISTS public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
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

CREATE TRIGGER update_mood_entries_updated_at 
  BEFORE UPDATE ON mood_entries 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();
