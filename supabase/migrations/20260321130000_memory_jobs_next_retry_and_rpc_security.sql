-- Colonne next_retry_at : après échec, le job repasse en pending mais ne peut être
-- reclamé avant cette date (backoff réel, évite boucles serrées dans le même run worker).

ALTER TABLE memory_jobs
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NULL;

COMMENT ON COLUMN memory_jobs.next_retry_at IS
  'Si défini dans le futur, un job pending n''est pas éligible à claim_next_memory_job avant cette date.';

-- RPC : filtre next_retry_at, nettoie au claim, search_path figé, privilèges restreints.
CREATE OR REPLACE FUNCTION claim_next_memory_job()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
BEGIN
  SELECT *
    INTO v_job
    FROM memory_jobs
   WHERE status = 'pending'
     AND (next_retry_at IS NULL OR next_retry_at <= now())
   ORDER BY
     CASE job_type WHEN 'snapshot_50' THEN 0 ELSE 1 END,
     created_at ASC
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_job IS NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  UPDATE memory_jobs
     SET status        = 'running',
         locked_at     = now(),
         attempt_count = attempt_count + 1,
         next_retry_at = NULL,
         updated_at    = now()
   WHERE id = v_job.id;

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

-- Sécurité : ne pas exposer cette RPC aux clients JWT ; uniquement service_role (backend worker).
REVOKE ALL ON FUNCTION claim_next_memory_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_next_memory_job() TO service_role;
