/*
  # RPC function: write_user_message (plan §4.2)
  # Note : purge_100 retiré — voir 20251025120000_remove_purge_100_memory_jobs.sql

  Atomic transaction that performs the complete "Étape 1" of §IV.4:
    1. Resolve conversation (create if p_conversation_id is null)
    2. Lock conversation row (SELECT ... FOR UPDATE) — §IV.3
    3. Verify ownership (user_id must match)
    4. Reserve msg_seq from next_msg_seq — §IV.4 step 2
    5. Insert user message — §IV.4 step 3
    6. Increment next_msg_seq and user_msg_count — §IV.4 step 4
    7. Update updated_at — §IV.4 step 5
    8. Create memory jobs if threshold reached (idempotent) — §IV.4 step 6

  Returns a single JSON row with conversation + message data.

  All operations run in one transaction. The FOR UPDATE lock serializes
  concurrent writes on the same conversation (§IV.3), preventing
  double msg_seq or double job creation.
*/

CREATE OR REPLACE FUNCTION write_user_message(
  p_user_id       uuid,
  p_conversation_id uuid DEFAULT NULL,
  p_message_text  text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
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
    INSERT INTO conversations (user_id)
    VALUES (p_user_id)
    RETURNING id, created_at, updated_at
    INTO v_conv_id, v_conv_created_at, v_conv_updated_at;

    v_is_new_conv  := true;
    v_next_seq     := 1;  -- default from table definition
    v_user_msg_count := 0;
    v_conv_user_id := p_user_id;
  ELSE
    v_conv_id := p_conversation_id;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Lock conversation row (§IV.3 — SELECT ... FOR UPDATE)
  --    For new conversations this also validates the INSERT worked.
  -- ---------------------------------------------------------------
  SELECT user_id, next_msg_seq, user_msg_count, created_at, updated_at
  INTO   v_conv_user_id, v_next_seq, v_user_msg_count, v_conv_created_at, v_conv_updated_at
  FROM   conversations
  WHERE  id = v_conv_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found'
      USING ERRCODE = 'P0002'; -- no_data_found
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Verify ownership
  -- ---------------------------------------------------------------
  IF v_conv_user_id <> p_user_id THEN
    RAISE EXCEPTION 'conversation_forbidden'
      USING ERRCODE = 'P0003';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. Reserve msg_seq (§IV.4 step 2)
  -- ---------------------------------------------------------------
  -- v_next_seq already holds conversations.next_msg_seq

  -- ---------------------------------------------------------------
  -- 5. Insert user message (§IV.4 step 3)
  -- ---------------------------------------------------------------
  INSERT INTO messages (conversation_id, user_id, role, content, msg_seq)
  VALUES (v_conv_id, p_user_id, 'user', p_message_text, v_next_seq)
  RETURNING id, created_at
  INTO v_msg_id, v_msg_created_at;

  -- ---------------------------------------------------------------
  -- 6-7. Increment counters + update timestamp (§IV.4 steps 4-5)
  -- ---------------------------------------------------------------
  v_new_msg_count := v_user_msg_count + 1;

  UPDATE conversations
  SET next_msg_seq   = v_next_seq + 1,
      user_msg_count = v_new_msg_count
      -- updated_at is handled by the BEFORE UPDATE trigger
  WHERE id = v_conv_id;

  -- ---------------------------------------------------------------
  -- 8. Create memory jobs if thresholds reached (§IV.4 step 6)
  --    Idempotent: ON CONFLICT DO NOTHING (UNIQUE constraint)
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

  -- ---------------------------------------------------------------
  -- Return all data needed by the API response
  -- ---------------------------------------------------------------
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
