/*
  # Fix RLS Performance and Security Issues

  ## Overview
  This migration optimizes Row Level Security policies and addresses security concerns
  identified in the database audit.

  ## 1. RLS Performance Optimization
  
  ### Problem
  All RLS policies were calling `auth.uid()` directly, causing the function to be 
  re-evaluated for each row in query results. This creates significant performance 
  degradation at scale.
  
  ### Solution
  Replace `auth.uid()` with `(select auth.uid())` in all policies. The subquery 
  causes the function to be evaluated once and the result is cached for the entire 
  query execution.
  
  ### Affected Tables
  - `public.profiles` - 4 policies updated (SELECT, INSERT, UPDATE, DELETE)
  - `public.mood_entries` - 4 policies updated (SELECT, INSERT, UPDATE, DELETE)

  ## 2. Index Cleanup
  
  ### Unused Indexes Removed
  - `idx_mood_entries_user_id` - Redundant with composite index
  - `idx_mood_entries_user_date` - Will be recreated with proper naming
  
  ### New Index Created
  - Composite index on `mood_entries(user_id, date)` optimized for common queries
  
  ## 3. Security Enhancements
  
  The leaked password protection will need to be enabled via Supabase Dashboard:
  - Navigate to Authentication > Settings
  - Enable "Password Protection" to check against HaveIBeenPwned.org database
  
  ## 4. Important Notes
  
  - All policies maintain the same security logic, only performance is improved
  - No data is modified, only policy definitions are updated
  - The changes are backward compatible with existing queries
  - Performance improvement is significant for queries returning multiple rows
*/

-- ============================================================================
-- PROFILES TABLE: Update RLS Policies for Performance
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;

-- Recreate policies with optimized auth.uid() calls
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own profile"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- MOOD_ENTRIES TABLE: Update RLS Policies for Performance
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own mood entries" ON public.mood_entries;
DROP POLICY IF EXISTS "Users can insert own mood entries" ON public.mood_entries;
DROP POLICY IF EXISTS "Users can update own mood entries" ON public.mood_entries;
DROP POLICY IF EXISTS "Users can delete own mood entries" ON public.mood_entries;

-- Recreate policies with optimized auth.uid() calls
CREATE POLICY "Users can view own mood entries"
  ON public.mood_entries
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own mood entries"
  ON public.mood_entries
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own mood entries"
  ON public.mood_entries
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own mood entries"
  ON public.mood_entries
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- INDEX OPTIMIZATION: Remove Unused Indexes
-- ============================================================================

-- Drop redundant single-column index (composite index is more efficient)
DROP INDEX IF EXISTS public.idx_mood_entries_user_id;

-- Drop and recreate composite index to ensure it exists and is optimal
DROP INDEX IF EXISTS public.idx_mood_entries_user_date;
CREATE INDEX IF NOT EXISTS idx_mood_entries_user_date 
  ON public.mood_entries(user_id, date);

-- ============================================================================
-- VERIFICATION QUERIES (commented out, for manual verification if needed)
-- ============================================================================

-- To verify policies are working correctly, run these queries as a test user:
-- SELECT * FROM public.profiles WHERE user_id = auth.uid();
-- SELECT * FROM public.mood_entries WHERE user_id = auth.uid();

-- To verify index usage, run EXPLAIN ANALYZE on common queries:
-- EXPLAIN ANALYZE SELECT * FROM mood_entries WHERE user_id = auth.uid() AND date >= CURRENT_DATE - INTERVAL '30 days';
