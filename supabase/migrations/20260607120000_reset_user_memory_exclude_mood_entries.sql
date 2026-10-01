-- reset_user_memory ne supprime plus mood_entries.
-- L'historique d'humeur est distinct de la mémoire conversationnelle de Lucy.
-- La suppression de compte (via le backend) efface tout via CASCADE sur auth.users.

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

  -- mood_entries intentionnellement exclu : l'historique d'humeur est conservé.
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
  'Effacement mémoire Lucy (§VI). Supprime conversations (cascade messages/jobs/snapshots) et tables mémoire utilisateur. Ne supprime pas mood_entries (historique humeur conservé). La suppression de compte complète passe par auth.admin.deleteUser (cascade totale).';

REVOKE ALL ON FUNCTION reset_user_memory(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_user_memory(uuid, text) TO service_role;
