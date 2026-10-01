-- RPC write_assistant_message : insertion transactionnelle du message assistant
-- avec verrou conversation et idempotence via msg_seq (plan §4.4, §IV.4 Étape 3).
--
-- Garanties :
--   1. Verrou conversation (SELECT ... FOR UPDATE) — sérialisation
--   2. Vérification d'appartenance (user_id)
--   3. Idempotence : si un message assistant avec le msg_seq attendu existe déjà,
--      retourne l'existant sans doublon
--   4. Vérification de cohérence : p_expected_msg_seq doit correspondre à next_msg_seq
--   5. Atomique : insert message + incrémentation next_msg_seq dans la même transaction

CREATE OR REPLACE FUNCTION write_assistant_message(
  p_conversation_id uuid,
  p_user_id uuid,
  p_content text,
  p_expected_msg_seq int
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_conv record;
  v_existing record;
  v_msg record;
BEGIN
  -- 1. Verrouiller la conversation (§IV.3)
  SELECT id, user_id, next_msg_seq, user_msg_count, created_at, updated_at
    INTO v_conv
    FROM conversations
   WHERE id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_not_found';
  END IF;

  IF v_conv.user_id != p_user_id THEN
    RAISE EXCEPTION 'conversation_forbidden';
  END IF;

  -- 2. Idempotence : vérifier si le message assistant existe déjà pour ce msg_seq
  SELECT id, conversation_id, user_id, role, content, msg_seq, created_at
    INTO v_existing
    FROM messages
   WHERE conversation_id = p_conversation_id
     AND msg_seq = p_expected_msg_seq
     AND role = 'assistant';

  IF FOUND THEN
    -- Retry détecté — retourner l'existant sans modifier la conversation
    RETURN jsonb_build_object(
      'message', jsonb_build_object(
        'id', v_existing.id,
        'conversation_id', v_existing.conversation_id,
        'user_id', v_existing.user_id,
        'role', v_existing.role,
        'content', v_existing.content,
        'msg_seq', v_existing.msg_seq,
        'created_at', v_existing.created_at
      ),
      'already_existed', true
    );
  END IF;

  -- 3. Vérifier la cohérence de séquence
  IF v_conv.next_msg_seq != p_expected_msg_seq THEN
    RAISE EXCEPTION 'msg_seq_mismatch: expected=%, actual=%',
      p_expected_msg_seq, v_conv.next_msg_seq;
  END IF;

  -- 4. Insérer le message assistant
  INSERT INTO messages (conversation_id, user_id, role, content, msg_seq)
  VALUES (p_conversation_id, p_user_id, 'assistant', p_content, p_expected_msg_seq)
  RETURNING id, conversation_id, user_id, role, content, msg_seq, created_at
  INTO v_msg;

  -- 5. Incrémenter next_msg_seq (PAS user_msg_count — c'est un message assistant)
  UPDATE conversations
     SET next_msg_seq = p_expected_msg_seq + 1,
         updated_at = now()
   WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_msg.id,
      'conversation_id', v_msg.conversation_id,
      'user_id', v_msg.user_id,
      'role', v_msg.role,
      'content', v_msg.content,
      'msg_seq', v_msg.msg_seq,
      'created_at', v_msg.created_at
    ),
    'already_existed', false
  );
END;
$$;
