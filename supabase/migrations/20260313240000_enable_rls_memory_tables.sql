/*
  # Enable RLS on all memory tables (mémoire Lucy étape 2.8)

  Activates Row-Level Security on every table created in étapes 2.2–2.6
  and defines per-user access policies for authenticated users.

  Pattern: (select auth.uid()) for performance (evaluated once per query),
  matching the convention established in 20251013164717_fix_rls_performance_and_security.sql.

  Backend Lucy uses service_role key and bypasses RLS entirely.

  Tables covered:
    - 14 tables with user_id column (SELECT/INSERT/UPDATE/DELETE restricted to own rows)
    - 2 reference tables without user_id (SELECT only for authenticated)
*/

-- ============================================================================
-- CONVERSATIONS
-- ============================================================================

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own conversations"
  ON conversations FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- MESSAGES
-- ============================================================================

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON messages FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own messages"
  ON messages FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own messages"
  ON messages FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own messages"
  ON messages FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- MEMORY_JOBS
-- ============================================================================

ALTER TABLE memory_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memory jobs"
  ON memory_jobs FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own memory jobs"
  ON memory_jobs FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own memory jobs"
  ON memory_jobs FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own memory jobs"
  ON memory_jobs FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- MEMORY_SNAPSHOTS
-- ============================================================================

ALTER TABLE memory_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memory snapshots"
  ON memory_snapshots FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own memory snapshots"
  ON memory_snapshots FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own memory snapshots"
  ON memory_snapshots FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own memory snapshots"
  ON memory_snapshots FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_IDENTITY
-- ============================================================================

ALTER TABLE user_identity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own identity"
  ON user_identity FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own identity"
  ON user_identity FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own identity"
  ON user_identity FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own identity"
  ON user_identity FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_IDENTITY_GOALS
-- ============================================================================

ALTER TABLE user_identity_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own goals"
  ON user_identity_goals FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own goals"
  ON user_identity_goals FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own goals"
  ON user_identity_goals FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own goals"
  ON user_identity_goals FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_OCCUPATION_NOTES
-- ============================================================================

ALTER TABLE user_occupation_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own occupation notes"
  ON user_occupation_notes FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own occupation notes"
  ON user_occupation_notes FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own occupation notes"
  ON user_occupation_notes FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own occupation notes"
  ON user_occupation_notes FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_TRAITS
-- ============================================================================

ALTER TABLE user_traits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own traits"
  ON user_traits FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own traits"
  ON user_traits FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own traits"
  ON user_traits FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own traits"
  ON user_traits FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_PREFERENCES
-- ============================================================================

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON user_preferences FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own preferences"
  ON user_preferences FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_RELATIONS
-- ============================================================================

ALTER TABLE user_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own relations"
  ON user_relations FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own relations"
  ON user_relations FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own relations"
  ON user_relations FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own relations"
  ON user_relations FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_EPHEMERAL_EVENTS
-- ============================================================================

ALTER TABLE user_ephemeral_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ephemeral events"
  ON user_ephemeral_events FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own ephemeral events"
  ON user_ephemeral_events FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own ephemeral events"
  ON user_ephemeral_events FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own ephemeral events"
  ON user_ephemeral_events FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_LIFE_EVENTS
-- ============================================================================

ALTER TABLE user_life_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own life events"
  ON user_life_events FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own life events"
  ON user_life_events FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own life events"
  ON user_life_events FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own life events"
  ON user_life_events FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_MOOD_STATS
-- ============================================================================

ALTER TABLE user_mood_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mood stats"
  ON user_mood_stats FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own mood stats"
  ON user_mood_stats FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own mood stats"
  ON user_mood_stats FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own mood stats"
  ON user_mood_stats FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- USER_MEMORY_RESET_LOG
-- ============================================================================

ALTER TABLE user_memory_reset_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reset log"
  ON user_memory_reset_log FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert own reset log"
  ON user_memory_reset_log FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own reset log"
  ON user_memory_reset_log FOR UPDATE TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete own reset log"
  ON user_memory_reset_log FOR DELETE TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================================
-- PREFERENCE_CATEGORIES (reference table — read-only for authenticated)
-- ============================================================================

ALTER TABLE preference_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read preference categories"
  ON preference_categories FOR SELECT TO authenticated
  USING (true);

-- ============================================================================
-- PREFERENCE_CATEGORY_ENUM_VALUES (reference table — read-only for authenticated)
-- ============================================================================

ALTER TABLE preference_category_enum_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read preference enum values"
  ON preference_category_enum_values FOR SELECT TO authenticated
  USING (true);
