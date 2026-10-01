-- RPC claim_next_memory_job : prise atomique d'un job mémoire par le worker.
-- Utilise FOR UPDATE SKIP LOCKED pour garantir qu'un seul worker traite un job donné.
-- Définition à jour (sans purge_100, ordre FIFO) : 20260325120000_remove_purge_100_memory_jobs.sql

CREATE OR REPLACE FUNCTION claim_next_memory_job()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job record;
BEGIN
  -- Sélectionner le prochain job pending avec verrouillage exclusif.
  -- Ordre CASE historique (deux types) ; un seul type après migration remove_purge_100.
  SELECT *
    INTO v_job
    FROM memory_jobs
   WHERE status = 'pending'
   ORDER BY
     CASE job_type WHEN 'snapshot_50' THEN 0 ELSE 1 END,
     created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  -- Aucun job disponible
  IF v_job IS NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  -- Passer le job en running : locked_at = now(), attempt_count++
  UPDATE memory_jobs
     SET status        = 'running',
         locked_at     = now(),
         attempt_count = attempt_count + 1,
         updated_at    = now()
   WHERE id = v_job.id;

  -- Retourner le job complet
  RETURN jsonb_build_object(
    'claimed',                  true,
    'id',                       v_job.id,
    'conversation_id',          v_job.conversation_id,
    'user_id',                  v_job.user_id,
    'job_type',                 v_job.job_type,
    'trigger_user_msg_count',   v_job.trigger_user_msg_count,
    'attempt_count',            v_job.attempt_count + 1,
    'created_at',               v_job.created_at
  );
END;
$$;
