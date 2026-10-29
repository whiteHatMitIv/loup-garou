
-- ============================================================
-- NOCTURNE : vote du village, second scrutin et points
-- Colonnes conformes au schéma actuel :
-- game_phases.phase_key, player_roles.role_key, votes.vote_kind
-- ============================================================

-- 1. Le maître ouvre le premier scrutin.
CREATE OR REPLACE FUNCTION public.start_village_vote(
  p_game_id uuid,
  p_master_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_round integer;
  v_next_phase_number integer;
  v_phase_id uuid;
BEGIN
  SELECT g.status, g.round_number
  INTO v_status, v_round
  FROM public.games AS g
  WHERE g.id = p_game_id
    AND g.master_id = p_master_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable ou accès refusé.';
  END IF;

  IF v_status <> 'day_discussion' THEN
    RAISE EXCEPTION 'Le débat du village doit être en cours pour ouvrir le scrutin.';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.game_players AS gp
    WHERE gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
  ) < 2 THEN
    RAISE EXCEPTION 'Il faut au moins deux joueurs vivants pour voter.';
  END IF;

  UPDATE public.game_phases
  SET
    status = 'resolved',
    closed_at = now(),
    resolved_at = now()
  WHERE game_id = p_game_id
    AND phase_key = 'day_discussion'
    AND status = 'open';

  SELECT COALESCE(MAX(gp.phase_number), 0) + 1
  INTO v_next_phase_number
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id;

  INSERT INTO public.game_phases (
    game_id,
    phase_key,
    day_number,
    phase_number,
    status,
    metadata,
    opened_at
  )
  VALUES (
    p_game_id,
    'village_vote_1',
    GREATEST(v_round, 1),
    v_next_phase_number,
    'open',
    jsonb_build_object('ballot_number', 1),
    now()
  )
  RETURNING id INTO v_phase_id;

  UPDATE public.games
  SET status = 'village_vote_1'
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'phase_key', 'village_vote_1',
    'phase_id', v_phase_id
  );
END;
$$;


-- 2. Un joueur vivant vote.
-- Au second tour, il ne peut choisir que parmi les cibles à égalité.
CREATE OR REPLACE FUNCTION public.submit_village_vote(
  p_game_id uuid,
  p_player_id uuid,
  p_target_player_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_phase public.game_phases%ROWTYPE;
BEGIN
  SELECT g.status
  INTO v_status
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable.';
  END IF;

  IF v_status NOT IN ('village_vote_1', 'village_vote_2') THEN
    RAISE EXCEPTION 'Aucun scrutin du village n’est ouvert.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_players AS gp
    WHERE gp.id = p_player_id
      AND gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
  ) THEN
    RAISE EXCEPTION 'Seul un joueur validé et vivant peut voter.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_players AS gp
    WHERE gp.id = p_target_player_id
      AND gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
  ) THEN
    RAISE EXCEPTION 'La cible doit être un joueur vivant et validé.';
  END IF;

  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = v_status
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase de vote ouverte introuvable.';
  END IF;

  IF v_status = 'village_vote_2'
     AND NOT COALESCE(
       v_phase.metadata -> 'eligible_target_ids'
         ? p_target_player_id::text,
       false
     )
  THEN
    RAISE EXCEPTION 'Au second tour, vote uniquement parmi les joueurs à égalité.';
  END IF;

  INSERT INTO public.votes (
    game_id,
    phase_id,
    voter_player_id,
    target_player_id,
    vote_kind,
    submitted_at
  )
  VALUES (
    p_game_id,
    v_phase.id,
    p_player_id,
    p_target_player_id,
    'village',
    now()
  )
  ON CONFLICT (phase_id, voter_player_id)
  DO UPDATE SET
    target_player_id = EXCLUDED.target_player_id,
    vote_kind = EXCLUDED.vote_kind,
    submitted_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Vote enregistré.'
  );
END;
$$;


-- 3. Le maître clôt le scrutin.
-- Premier tour à égalité : ouvre le second tour.
-- Second tour à égalité : départage par ordre alphabétique.
CREATE OR REPLACE FUNCTION public.resolve_village_vote(
  p_game_id uuid,
  p_master_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_round integer;
  v_phase public.game_phases%ROWTYPE;
  v_next_phase_number integer;

  v_max_votes integer := 0;
  v_top_ids uuid[];
  v_target_id uuid;
  v_target_role_key text;
  v_target_name text;
  v_tally jsonb := '[]'::jsonb;
  v_final_phase_id uuid;
  v_second_ballot boolean := false;
  v_tie_break boolean := false;
  v_tied_count integer := 0;
  v_alive_wolves integer := 0;
BEGIN
  SELECT g.status, g.round_number
  INTO v_status, v_round
  FROM public.games AS g
  WHERE g.id = p_game_id
    AND g.master_id = p_master_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable ou accès refusé.';
  END IF;

  IF v_status NOT IN ('village_vote_1', 'village_vote_2') THEN
    RAISE EXCEPTION 'Aucun scrutin du village ne peut être clôturé.';
  END IF;

  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = v_status
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase de vote ouverte introuvable.';
  END IF;

  v_final_phase_id := v_phase.id;
  v_second_ballot := (v_status = 'village_vote_2');

  -- Premier tour : compter les voix reçues par chaque cible.
  IF v_status = 'village_vote_1' THEN

    WITH counts AS (
      SELECT
        target.id AS target_id,
        target.normalized_name,
        COUNT(v.id)::integer AS vote_count
      FROM public.votes AS v
      JOIN public.game_players AS voter
        ON voter.id = v.voter_player_id
       AND voter.game_id = v.game_id
      JOIN public.game_players AS target
        ON target.id = v.target_player_id
       AND target.game_id = v.game_id
      WHERE v.game_id = p_game_id
        AND v.phase_id = v_phase.id
        AND v.vote_kind = 'village'
        AND voter.registration_status = 'approved'
        AND voter.life_status = 'alive'
        AND target.registration_status = 'approved'
        AND target.life_status = 'alive'
      GROUP BY target.id, target.normalized_name
    )
    SELECT COALESCE(MAX(counts.vote_count), 0)
    INTO v_max_votes
    FROM counts;

    IF v_max_votes > 0 THEN
      WITH counts AS (
        SELECT
          target.id AS target_id,
          target.normalized_name,
          COUNT(v.id)::integer AS vote_count
        FROM public.votes AS v
        JOIN public.game_players AS voter
          ON voter.id = v.voter_player_id
         AND voter.game_id = v.game_id
        JOIN public.game_players AS target
          ON target.id = v.target_player_id
         AND target.game_id = v.game_id
        WHERE v.game_id = p_game_id
          AND v.phase_id = v_phase.id
          AND v.vote_kind = 'village'
          AND voter.registration_status = 'approved'
          AND voter.life_status = 'alive'
          AND target.registration_status = 'approved'
          AND target.life_status = 'alive'
        GROUP BY target.id, target.normalized_name
      )
      SELECT array_agg(counts.target_id ORDER BY counts.normalized_name)
      INTO v_top_ids
      FROM counts
      WHERE counts.vote_count = v_max_votes;
    ELSE
      v_top_ids := ARRAY[]::uuid[];
    END IF;

    v_tied_count := COALESCE(cardinality(v_top_ids), 0);

    -- Une égalité au premier tour provoque un second scrutin.
    IF v_max_votes > 0 AND v_tied_count > 1 THEN

      WITH counts AS (
        SELECT
          target.id AS target_id,
          target.display_name,
          target.normalized_name,
          COUNT(v.id)::integer AS vote_count
        FROM public.votes AS v
        JOIN public.game_players AS voter
          ON voter.id = v.voter_player_id
         AND voter.game_id = v.game_id
        JOIN public.game_players AS target
          ON target.id = v.target_player_id
         AND target.game_id = v.game_id
        WHERE v.game_id = p_game_id
          AND v.phase_id = v_phase.id
          AND v.vote_kind = 'village'
          AND voter.registration_status = 'approved'
          AND voter.life_status = 'alive'
          AND target.registration_status = 'approved'
          AND target.life_status = 'alive'
        GROUP BY target.id, target.display_name, target.normalized_name
      )
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'target_player_id', target_id,
            'target_name', display_name,
            'votes', vote_count
          )
          ORDER BY vote_count DESC, normalized_name ASC
        ),
        '[]'::jsonb
      )
      INTO v_tally
      FROM counts;

      UPDATE public.game_phases
      SET
        status = 'resolved',
        metadata = COALESCE(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'tally', v_tally,
            'result', 'tie',
            'second_ballot_opened', true
          ),
        closed_at = now(),
        resolved_at = now()
      WHERE id = v_phase.id;

      SELECT COALESCE(MAX(gp.phase_number), 0) + 1
      INTO v_next_phase_number
      FROM public.game_phases AS gp
      WHERE gp.game_id = p_game_id;

      INSERT INTO public.game_phases (
        game_id,
        phase_key,
        day_number,
        phase_number,
        status,
        metadata,
        opened_at
      )
      VALUES (
        p_game_id,
        'village_vote_2',
        GREATEST(v_round, 1),
        v_next_phase_number,
        'open',
        jsonb_build_object(
          'ballot_number', 2,
          'eligible_target_ids', to_jsonb(v_top_ids),
          'first_ballot_phase_id', v_phase.id
        ),
        now()
      );

      UPDATE public.games
      SET status = 'village_vote_2'
      WHERE id = p_game_id;

      RETURN jsonb_build_object(
        'success', true,
        'next_phase', 'village_vote_2',
        'tied_target_ids', to_jsonb(v_top_ids),
        'tally', v_tally,
        'message', 'Égalité : le second scrutin est ouvert.'
      );
    END IF;

    -- Pas de vote : aucun joueur ne sera éliminé sur ce scrutin.
    IF v_tied_count = 1 THEN
      v_target_id := v_top_ids[1];
    ELSE
      v_target_id := NULL;
    END IF;

  ELSE
    -- Second tour : les cibles admissibles sont celles stockées
    -- dans les métadonnées de cette phase.
    v_tie_break := false;

    WITH eligible AS (
      SELECT jsonb_array_elements_text(
        COALESCE(v_phase.metadata -> 'eligible_target_ids', '[]'::jsonb)
      )::uuid AS target_id
    ),
    counts AS (
      SELECT
        target.id AS target_id,
        target.display_name,
        target.normalized_name,
        COUNT(v.id)::integer AS vote_count
      FROM eligible AS e
      JOIN public.game_players AS target
        ON target.id = e.target_id
       AND target.game_id = p_game_id
      LEFT JOIN public.votes AS v
        ON v.target_player_id = target.id
       AND v.phase_id = v_phase.id
       AND v.game_id = p_game_id
       AND v.vote_kind = 'village'
      LEFT JOIN public.game_players AS voter
        ON voter.id = v.voter_player_id
       AND voter.game_id = p_game_id
       AND voter.registration_status = 'approved'
       AND voter.life_status = 'alive'
      WHERE target.registration_status = 'approved'
        AND target.life_status = 'alive'
        AND (v.id IS NULL OR voter.id IS NOT NULL)
      GROUP BY target.id, target.display_name, target.normalized_name
    )
    SELECT
      COALESCE(MAX(vote_count), 0)
    INTO v_max_votes
    FROM counts;

    WITH eligible AS (
      SELECT jsonb_array_elements_text(
        COALESCE(v_phase.metadata -> 'eligible_target_ids', '[]'::jsonb)
      )::uuid AS target_id
    ),
    counts AS (
      SELECT
        target.id AS target_id,
        target.display_name,
        target.normalized_name,
        COUNT(v.id)::integer AS vote_count
      FROM eligible AS e
      JOIN public.game_players AS target
        ON target.id = e.target_id
       AND target.game_id = p_game_id
      LEFT JOIN public.votes AS v
        ON v.target_player_id = target.id
       AND v.phase_id = v_phase.id
       AND v.game_id = p_game_id
       AND v.vote_kind = 'village'
      LEFT JOIN public.game_players AS voter
        ON voter.id = v.voter_player_id
       AND voter.game_id = p_game_id
       AND voter.registration_status = 'approved'
       AND voter.life_status = 'alive'
      WHERE target.registration_status = 'approved'
        AND target.life_status = 'alive'
        AND (v.id IS NULL OR voter.id IS NOT NULL)
      GROUP BY target.id, target.display_name, target.normalized_name
    )
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'target_player_id', target_id,
            'target_name', display_name,
            'votes', vote_count
          )
          ORDER BY vote_count DESC, normalized_name ASC
        ),
        '[]'::jsonb
      ),
      (array_agg(target_id ORDER BY vote_count DESC, normalized_name ASC))[1]
    INTO v_tally, v_target_id
    FROM counts;

    WITH eligible AS (
      SELECT jsonb_array_elements_text(
        COALESCE(v_phase.metadata -> 'eligible_target_ids', '[]'::jsonb)
      )::uuid AS target_id
    ),
    counts AS (
      SELECT
        target.id AS target_id,
        target.normalized_name,
        COUNT(v.id)::integer AS vote_count
      FROM eligible AS e
      JOIN public.game_players AS target
        ON target.id = e.target_id
       AND target.game_id = p_game_id
      LEFT JOIN public.votes AS v
        ON v.target_player_id = target.id
       AND v.phase_id = v_phase.id
       AND v.game_id = p_game_id
       AND v.vote_kind = 'village'
      LEFT JOIN public.game_players AS voter
        ON voter.id = v.voter_player_id
       AND voter.game_id = p_game_id
       AND voter.registration_status = 'approved'
       AND voter.life_status = 'alive'
      WHERE target.registration_status = 'approved'
        AND target.life_status = 'alive'
        AND (v.id IS NULL OR voter.id IS NOT NULL)
      GROUP BY target.id, target.normalized_name
    )
    SELECT COUNT(*)
    INTO v_tied_count
    FROM counts
    WHERE vote_count = v_max_votes;

    v_tie_break := v_tied_count > 1;
  END IF;

  -- Le scrutin final est maintenant déterminé.
  IF v_target_id IS NOT NULL THEN
    SELECT gp.display_name
    INTO v_target_name
    FROM public.game_players AS gp
    WHERE gp.id = v_target_id
      AND gp.game_id = p_game_id;

    SELECT pr.role_key
    INTO v_target_role_key
    FROM public.player_roles AS pr
    WHERE pr.game_id = p_game_id
      AND pr.player_id = v_target_id
    LIMIT 1;
  ELSE
    v_target_name := NULL;
    v_target_role_key := NULL;
  END IF;

  -- Enregistrer le résultat et clôturer le scrutin final.
  IF v_status = 'village_vote_1' THEN
    WITH counts AS (
      SELECT
        target.id AS target_id,
        target.display_name,
        target.normalized_name,
        COUNT(v.id)::integer AS vote_count
      FROM public.votes AS v
      JOIN public.game_players AS voter
        ON voter.id = v.voter_player_id
       AND voter.game_id = v.game_id
      JOIN public.game_players AS target
        ON target.id = v.target_player_id
       AND target.game_id = v.game_id
      WHERE v.game_id = p_game_id
        AND v.phase_id = v_phase.id
        AND v.vote_kind = 'village'
        AND voter.registration_status = 'approved'
        AND voter.life_status = 'alive'
        AND target.registration_status = 'approved'
        AND target.life_status = 'alive'
      GROUP BY target.id, target.display_name, target.normalized_name
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'target_player_id', target_id,
          'target_name', display_name,
          'votes', vote_count
        )
        ORDER BY vote_count DESC, normalized_name ASC
      ),
      '[]'::jsonb
    )
    INTO v_tally
    FROM counts;
  END IF;

  UPDATE public.game_phases
  SET
    status = 'resolved',
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'result', 'final',
        'target_player_id', v_target_id,
        'target_name', v_target_name,
        'target_role_key', v_target_role_key,
        'tally', v_tally,
        'second_ballot', v_second_ballot,
        'alphabetical_tie_break', v_tie_break
      ),
    closed_at = now(),
    resolved_at = now()
  WHERE id = v_phase.id;

  -- Attribution des points de vote :
  -- +2 pour chaque vote d'un joueur du village contre un Loup.
  -- Les votes du premier tour ne sont jamais comptés si un second
  -- tour est nécessaire : v_phase est alors celui du second scrutin.
  IF v_target_id IS NOT NULL THEN
    INSERT INTO public.score_events (
      game_id,
      player_id,
      points,
      reason,
      source_type,
      source_id,
      idempotency_key,
      metadata
    )
    SELECT
      p_game_id,
      v.voter_player_id,
      2,
      'Vote contre un Loup-Garou',
      'village_vote',
      v_phase.id,
      'village_vote:base:' || v_phase.id::text || ':' || v.voter_player_id::text,
      jsonb_build_object(
        'target_player_id', v.target_player_id,
        'ballot', CASE WHEN v_second_ballot THEN 2 ELSE 1 END
      )
    FROM public.votes AS v
    JOIN public.game_players AS voter
      ON voter.id = v.voter_player_id
     AND voter.game_id = p_game_id
    JOIN public.player_roles AS voter_role
      ON voter_role.game_id = p_game_id
     AND voter_role.player_id = voter.id
    JOIN public.player_roles AS target_role
      ON target_role.game_id = p_game_id
     AND target_role.player_id = v.target_player_id
    WHERE v.game_id = p_game_id
      AND v.phase_id = v_phase.id
      AND v.vote_kind = 'village'
      AND voter.registration_status = 'approved'
      AND voter_role.role_key <> 'loup_garou'
      AND target_role.role_key = 'loup_garou'
      AND NOT EXISTS (
        SELECT 1
        FROM public.score_events AS se
        WHERE se.idempotency_key =
          'village_vote:base:' || v_phase.id::text || ':' || v.voter_player_id::text
      );
  END IF;

  -- +2 supplémentaires pour chaque membre du village ayant voté
  -- contre le Loup qui est effectivement désigné à l'élimination.
  IF v_target_id IS NOT NULL AND v_target_role_key = 'loup_garou' THEN
    INSERT INTO public.score_events (
      game_id,
      player_id,
      points,
      reason,
      source_type,
      source_id,
      idempotency_key,
      metadata
    )
    SELECT
      p_game_id,
      v.voter_player_id,
      2,
      'Bonus pour élimination d’un Loup-Garou',
      'village_vote',
      v_phase.id,
      'village_vote:elimination_bonus:' || v_phase.id::text || ':' || v.voter_player_id::text,
      jsonb_build_object(
        'target_player_id', v_target_id,
        'ballot', CASE WHEN v_second_ballot THEN 2 ELSE 1 END
      )
    FROM public.votes AS v
    JOIN public.game_players AS voter
      ON voter.id = v.voter_player_id
     AND voter.game_id = p_game_id
    JOIN public.player_roles AS voter_role
      ON voter_role.game_id = p_game_id
     AND voter_role.player_id = voter.id
    WHERE v.game_id = p_game_id
      AND v.phase_id = v_phase.id
      AND v.vote_kind = 'village'
      AND v.target_player_id = v_target_id
      AND voter.registration_status = 'approved'
      AND voter_role.role_key <> 'loup_garou'
      AND NOT EXISTS (
        SELECT 1
        FROM public.score_events AS se
        WHERE se.idempotency_key =
          'village_vote:elimination_bonus:' || v_phase.id::text || ':' || v.voter_player_id::text
      );
  END IF;

  -- +1 pour chaque Loup encore vivant quand le village élimine
  -- un innocent. Ce bonus n'est attribué qu'une fois par scrutin.
  IF v_target_id IS NOT NULL
     AND v_target_role_key IS DISTINCT FROM 'loup_garou'
  THEN
    INSERT INTO public.score_events (
      game_id,
      player_id,
      points,
      reason,
      source_type,
      source_id,
      idempotency_key,
      metadata
    )
    SELECT
      p_game_id,
      gp.id,
      1,
      'Le village a éliminé un innocent',
      'village_vote',
      v_phase.id,
      'village_vote:innocent_elimination:' || v_phase.id::text || ':' || gp.id::text,
      jsonb_build_object('eliminated_player_id', v_target_id)
    FROM public.game_players AS gp
    JOIN public.player_roles AS pr
      ON pr.game_id = p_game_id
     AND pr.player_id = gp.id
    WHERE gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
      AND pr.role_key = 'loup_garou'
      AND NOT EXISTS (
        SELECT 1
        FROM public.score_events AS se
        WHERE se.idempotency_key =
          'village_vote:innocent_elimination:' || v_phase.id::text || ':' || gp.id::text
      );
  END IF;

  -- Créer la phase qui appliquera l'élimination, les amoureux,
  -- le Chasseur et les conditions de victoire.
  SELECT COALESCE(MAX(gp.phase_number), 0) + 1
  INTO v_next_phase_number
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id;

  INSERT INTO public.game_phases (
    game_id,
    phase_key,
    day_number,
    phase_number,
    status,
    metadata,
    opened_at
  )
  VALUES (
    p_game_id,
    'day_resolution',
    GREATEST(v_round, 1),
    v_next_phase_number,
    'open',
    jsonb_build_object(
      'target_player_id', v_target_id,
      'source_vote_phase_id', v_phase.id,
      'second_ballot', v_second_ballot,
      'alphabetical_tie_break', v_tie_break,
      'tally', v_tally
    ),
    now()
  );

  UPDATE public.games
  SET status = 'day_resolution'
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'next_phase', 'day_resolution',
    'target_player_id', v_target_id,
    'target_name', v_target_name,
    'target_role_key', v_target_role_key,
    'second_ballot', v_second_ballot,
    'alphabetical_tie_break', v_tie_break,
    'tally', v_tally
  );
END;
$$;


REVOKE ALL ON FUNCTION public.start_village_vote(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_village_vote(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.submit_village_vote(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_village_vote(uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.resolve_village_vote(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_village_vote(uuid, uuid)
  TO service_role;
