-- write_user_message : si p_conversation_id est NULL, réutiliser la conversation
-- la plus ancienne de l'utilisateur (un seul fil type WhatsApp). Sinon INSERT.
-- Verrou advisory par utilisateur sur cette branche pour éviter deux INSERT concurrents.
--
-- Idempotence reset : inchangé pour p_conversation_id non null.
-- purge_100 retiré du produit — définition canonique : 20260325120000_remove_purge_100_memory_jobs.sql

CREATE OR REPLACE FUNCTION write_user_message(
  p_user_id       uuid,
  p_conversation_id uuid DEFAULT NULL,
  p_message_text  text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_conv_id         uuid;
  v_conv_user_id    uuid;
  v_next_seq        integer;
  v_user_msg_count  integer;
  v_new_msg_count   integer;
  v_is_new_conv     boolean := false;
  v_msg_id          uuid;
  v_msg_created_at  timestamptz;
  v_conv_created_at timestamptz;
  v_conv_updated_at timestamptz;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Resolve conversation
  -- ---------------------------------------------------------------
  IF p_conversation_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(884299, hashtext(p_user_id::text));

    SELECT c.id, c.user_id, c.next_msg_seq, c.user_msg_count, c.created_at, c.updated_at
    INTO   v_conv_id, v_conv_user_id, v_next_seq, v_user_msg_count, v_conv_created_at, v_conv_updated_at
    FROM   conversations c
    WHERE  c.user_id = p_user_id
    ORDER  BY c.created_at ASC
    LIMIT  1
    FOR UPDATE;

    IF FOUND THEN
      v_is_new_conv := false;
    ELSE
      INSERT INTO conversations (user_id)
      VALUES (p_user_id)
      RETURNING id, user_id, next_msg_seq, user_msg_count, created_at, updated_at
      INTO v_conv_id, v_conv_user_id, v_next_seq, v_user_msg_count, v_conv_created_at, v_conv_updated_at;

      v_is_new_conv := true;
    END IF;
  ELSE
    v_conv_id := p_conversation_id;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Lock conversation row (§IV.3) — déjà verrouillée si branche NULL + existante
  -- ---------------------------------------------------------------
  IF p_conversation_id IS NOT NULL THEN
    SELECT user_id, next_msg_seq, user_msg_count, created_at, updated_at
    INTO   v_conv_user_id, v_next_seq, v_user_msg_count, v_conv_created_at, v_conv_updated_at
    FROM   conversations
    WHERE  id = v_conv_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'conversation_not_found'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Verify ownership
  -- ---------------------------------------------------------------
  IF v_conv_user_id <> p_user_id THEN
    RAISE EXCEPTION 'conversation_forbidden'
      USING ERRCODE = 'P0003';
  END IF;

  -- ---------------------------------------------------------------
  -- 4–5. Insert user message
  -- ---------------------------------------------------------------
  INSERT INTO messages (conversation_id, user_id, role, content, msg_seq)
  VALUES (v_conv_id, p_user_id, 'user', p_message_text, v_next_seq)
  RETURNING id, created_at
  INTO v_msg_id, v_msg_created_at;

  -- ---------------------------------------------------------------
  -- 6–7. Counters
  -- ---------------------------------------------------------------
  v_new_msg_count := v_user_msg_count + 1;

  UPDATE conversations
  SET next_msg_seq   = v_next_seq + 1,
      user_msg_count = v_new_msg_count
  WHERE id = v_conv_id;

  -- ---------------------------------------------------------------
  -- 8. memory_jobs seuils
  -- ---------------------------------------------------------------
  IF v_new_msg_count > 0 AND v_new_msg_count % 50 = 0 THEN
    INSERT INTO memory_jobs (conversation_id, user_id, job_type, trigger_user_msg_count, status)
    VALUES (v_conv_id, p_user_id, 'snapshot_50', v_new_msg_count, 'pending')
    ON CONFLICT (conversation_id, job_type, trigger_user_msg_count) DO NOTHING;
  END IF;

  IF v_new_msg_count > 0 AND v_new_msg_count % 100 = 0 THEN
    INSERT INTO memory_jobs (conversation_id, user_id, job_type, trigger_user_msg_count, status)
    VALUES (v_conv_id, p_user_id, 'purge_100', v_new_msg_count, 'pending')
    ON CONFLICT (conversation_id, job_type, trigger_user_msg_count) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'conversation', jsonb_build_object(
      'id',             v_conv_id,
      'user_id',        p_user_id,
      'next_msg_seq',   v_next_seq + 1,
      'user_msg_count', v_new_msg_count,
      'created_at',     v_conv_created_at,
      'updated_at',     now(),
      'is_new',         v_is_new_conv
    ),
    'message', jsonb_build_object(
      'id',              v_msg_id,
      'conversation_id', v_conv_id,
      'user_id',         p_user_id,
      'role',            'user',
      'content',         p_message_text,
      'msg_seq',         v_next_seq,
      'created_at',      v_msg_created_at
    )
  );
END;
$$;
