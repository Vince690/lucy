-- §VI.4 + §VI.8 : inclure l’historique mood tracker (`mood_entries`) dans le reset mémoire,
-- aligné avec « tous les moods historiques sont supprimés » et le droit à l’effacement.

CREATE OR REPLACE FUNCTION reset_user_memory(
  p_user_id uuid,
  p_reason  text DEFAULT 'user_action'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason memory_reset_reason;
BEGIN
  v_reason := CASE lower(trim(coalesce(p_reason, '')))
    WHEN 'admin_action' THEN 'admin_action'::memory_reset_reason
    WHEN 'system_migration' THEN 'system_migration'::memory_reset_reason
    ELSE 'user_action'::memory_reset_reason
  END;

  PERFORM pg_advisory_xact_lock(884300, hashtext(p_user_id::text));

  DELETE FROM conversations WHERE user_id = p_user_id;

  DELETE FROM mood_entries WHERE user_id = p_user_id;

  DELETE FROM user_mood_stats WHERE user_id = p_user_id;
  DELETE FROM user_life_events WHERE user_id = p_user_id;
  DELETE FROM user_ephemeral_events WHERE user_id = p_user_id;
  DELETE FROM user_relations WHERE user_id = p_user_id;
  DELETE FROM user_preferences WHERE user_id = p_user_id;
  DELETE FROM user_traits WHERE user_id = p_user_id;
  DELETE FROM user_occupation_notes WHERE user_id = p_user_id;
  DELETE FROM user_identity_goals WHERE user_id = p_user_id;
  DELETE FROM user_identity WHERE user_id = p_user_id;

  INSERT INTO user_memory_reset_log (user_id, reset_at, reason)
  VALUES (p_user_id, now(), v_reason);

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'reason', v_reason::text
  );
END;
$$;

COMMENT ON FUNCTION reset_user_memory(uuid, text) IS
  'Effacement mémoire Lucy (§VI). Supprime conversations (cascade messages/jobs/snapshots), mood_entries, tables mémoire utilisateur, journal user_memory_reset_log.';

REVOKE ALL ON FUNCTION reset_user_memory(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_memory(uuid, text) TO service_role;
