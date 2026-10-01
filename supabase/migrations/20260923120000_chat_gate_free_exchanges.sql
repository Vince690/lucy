-- Porte du chat : pré-essai à 5 échanges offerts, puis abonnement (23 septembre 2026).
--
-- Contexte : jusqu'ici le paywall se dressait AVANT tout usage de l'app (faux chat
-- cloisonné). Désormais la personne entre dans la vraie app après l'onboarding, et
-- dispose de 5 échanges avec Lucy, une seule fois pour toujours. Le compteur vit sur
-- `profiles` (par personne, pas par conversation : une remise à zéro de la mémoire
-- crée une nouvelle conversation) et n'est écrit QUE par le backend, via la clé de
-- service. L'app lit la colonne (mesure), mais ne peut pas la modifier : le trigger
-- ci-dessous ignore toute écriture venant d'un JWT `authenticated` ou `anon`.
--
-- `chat_wall_reached_at` : l'instant où le mur est tombé (premier refus 402 du
-- backend). C'est CE marqueur, et non le compteur, qui referme l'app : le paywall
-- se présente au sixième envoi, jamais avant, puis revient à chaque ouverture tant
-- qu'aucun abonnement n'est actif. Sans lui, la racine renverrait au paywall dès la
-- cinquième réponse de Lucy, avant que la personne ait voulu écrire une sixième fois.
--
-- `onboarding_answers` : les réponses du questionnaire (clés d'options uniquement,
-- jamais de texte libre), écrites par l'app à la fin de l'onboarding et lues par le
-- backend pour que Lucy les connaisse dès le premier message. Le backend ne recopie
-- jamais ces valeurs telles quelles dans le prompt : chaque clé passe par une table
-- de libellés fixe, une clé inconnue est ignorée.
--
-- Les trois RPC sont réservées au rôle service_role : `chat_gate_refund` décrémente,
-- et une fonction décrémentante ouverte aux utilisateurs authentifiés rendrait le
-- quota infini.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_exchanges_used integer NOT NULL DEFAULT 0
    CHECK (free_exchanges_used >= 0),
  ADD COLUMN IF NOT EXISTS chat_wall_reached_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_answers jsonb;

-- ----------------------------------------------------------------------------
-- Protection des colonnes : seule la clé de service (ou un accès direct à la base)
-- peut changer free_exchanges_used et chat_wall_reached_at. Une écriture cliente
-- est silencieusement ignorée plutôt que rejetée : l'app met le profil à jour par
-- upsert de lignes partielles, et une exception ici casserait des mises à jour
-- légitimes.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_chat_gate_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role text := coalesce(auth.role(), '');
BEGIN
  IF v_role IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.free_exchanges_used := 0;
      NEW.chat_wall_reached_at := NULL;
    ELSE
      NEW.free_exchanges_used := OLD.free_exchanges_used;
      NEW.chat_wall_reached_at := OLD.chat_wall_reached_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_chat_gate_columns_trigger ON public.profiles;
CREATE TRIGGER protect_chat_gate_columns_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_chat_gate_columns();

-- ----------------------------------------------------------------------------
-- chat_gate_consume : consomme un échange offert si le compteur est sous la limite.
-- Un seul UPDATE conditionnel : deux requêtes simultanées ne passent pas toutes
-- deux avec le même compteur.
-- Retour : { allowed: bool, used: int }.
--   allowed = true  → l'échange est consommé, `used` compte celui-ci.
--   allowed = false → quota épuisé (ou profil introuvable), `used` = état courant.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.chat_gate_consume(
  p_user_id uuid,
  p_limit   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_used integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 0 THEN
    RAISE EXCEPTION 'chat_gate_invalid_limit' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET    free_exchanges_used = free_exchanges_used + 1
  WHERE  user_id = p_user_id
    AND  free_exchanges_used < p_limit
  RETURNING free_exchanges_used INTO v_used;

  IF FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'used', v_used);
  END IF;

  SELECT free_exchanges_used INTO v_used
  FROM   public.profiles
  WHERE  user_id = p_user_id;

  -- Profil introuvable : on ne peut rien offrir à un compte sans profil.
  RETURN jsonb_build_object('allowed', false, 'used', coalesce(v_used, p_limit));
END;
$$;

-- ----------------------------------------------------------------------------
-- chat_gate_refund : rend un échange consommé dont le traitement a échoué.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.chat_gate_refund(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.profiles
  SET    free_exchanges_used = greatest(free_exchanges_used - 1, 0)
  WHERE  user_id = p_user_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- chat_gate_mark_wall : le mur vient de tomber (refus 402). Idempotent : la
-- première date reste. Retourne l'instant retenu.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.chat_gate_mark_wall(p_user_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  UPDATE public.profiles
  SET    chat_wall_reached_at = coalesce(chat_wall_reached_at, now())
  WHERE  user_id = p_user_id
  RETURNING chat_wall_reached_at INTO v_at;
  RETURN v_at;
END;
$$;

-- Réservées au backend (clé de service). Sans ces REVOKE, PostgREST expose toute
-- fonction du schéma public aux rôles anon et authenticated.
REVOKE ALL ON FUNCTION public.chat_gate_consume(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_gate_refund(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_gate_mark_wall(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_gate_consume(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_gate_refund(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_gate_mark_wall(uuid) TO service_role;
