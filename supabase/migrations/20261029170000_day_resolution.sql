
-- ============================================================
-- NOCTURNE : résolution du scrutin du village
-- ============================================================

-- 1. Terminer une résolution de journée.
CREATE OR REPLACE FUNCTION public.finish_day_resolution(
  p_game_id uuid,
  p_phase_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_round integer;
  v_wolves_alive integer := 0;
  v_village_alive integer := 0;
  v_winner text;
  v_phase public.game_phases%ROWTYPE;
  v_next_phase_number integer;
  v_next_round integer;
BEGIN
  SELECT g.status, g.round_number
  INTO v_status, v_round
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable.';
  END IF;

  IF v_status IN ('game_over', 'finished') THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_finished', true,
      'game_status', v_status
    );
  END IF;

  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.id = p_phase_id
    AND gp.game_id = p_game_id
    AND gp.phase_key = 'day_resolution'
    AND gp.status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La résolution du vote du village n’est pas ouverte.';
  END IF;

  IF v_phase.metadata ->> 'resolution_state' = 'awaiting_hunter' THEN
    RAISE EXCEPTION 'La résolution attend encore le tir du Chasseur.';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE pr.role_key = 'loup_garou')::integer,
    COUNT(*) FILTER (WHERE pr.role_key <> 'loup_garou')::integer
  INTO v_wolves_alive, v_village_alive
  FROM public.game_players AS gp
  JOIN public.player_roles AS pr
    ON pr.game_id = gp.game_id
   AND pr.player_id = gp.id
  WHERE gp.game_id = p_game_id
    AND gp.registration_status = 'approved'
    AND gp.life_status = 'alive';

  IF v_wolves_alive = 0 THEN
    v_winner := 'village';
  ELSIF v_wolves_alive >= v_village_alive THEN
    v_winner := 'wolves';
  ELSE
    v_winner := NULL;
  END IF;

  UPDATE public.game_phases
  SET
    status = 'resolved',
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'resolution_state', 'completed',
        'wolves_alive_after_resolution', v_wolves_alive,
        'village_alive_after_resolution', v_village_alive,
        'winner', v_winner
      ),
    closed_at = now(),
    resolved_at = now()
  WHERE id = p_phase_id;

  -- Partie terminée : attribution des +3 points aux gagnants encore en vie.
  IF v_winner IS NOT NULL THEN
    UPDATE public.games
    SET
      status = 'game_over',
      winner = v_winner,
      ended_at = now()
    WHERE id = p_game_id;

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
      3,
      CASE
        WHEN v_winner = 'village'
          THEN 'Victoire finale du village'
        ELSE 'Victoire finale des Loups-Garous'
      END,
      'game_end',
      p_phase_id,
      'game_end:' || p_game_id::text || ':' || gp.id::text,
      jsonb_build_object('winner', v_winner)
    FROM public.game_players AS gp
    JOIN public.player_roles AS pr
      ON pr.game_id = gp.game_id
     AND pr.player_id = gp.id
    WHERE gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
      AND (
        (v_winner = 'village' AND pr.role_key <> 'loup_garou')
        OR
        (v_winner = 'wolves' AND pr.role_key = 'loup_garou')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.score_events AS se
        WHERE se.idempotency_key =
          'game_end:' || p_game_id::text || ':' || gp.id::text
      );

    RETURN jsonb_build_object(
      'success', true,
      'winner', v_winner,
      'game_status', 'game_over',
      'wolves_alive', v_wolves_alive,
      'village_alive', v_village_alive
    );
  END IF;

  -- Pas encore de vainqueur : ouvrir la prochaine nuit.
  v_next_round := GREATEST(COALESCE(v_round, 1), 1) + 1;

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
    'night_wolf_vote',
    v_next_round,
    v_next_phase_number,
    'open',
    '{}'::jsonb,
    now()
  );

  UPDATE public.games
  SET
    status = 'night_wolf_vote',
    round_number = v_next_round
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'game_status', 'night_wolf_vote',
    'round_number', v_next_round,
    'wolves_alive', v_wolves_alive,
    'village_alive', v_village_alive
  );
END;
$$;


-- ============================================================
-- 2. Appliquer l'élimination décidée par le village
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_day_vote(
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
  v_phase public.game_phases%ROWTYPE;
  v_target_id uuid;
  v_partner_id uuid;
  v_hunter_id uuid;
  v_death_ids uuid[] := ARRAY[]::uuid[];
  v_resolution_order integer;
  v_next_phase_number integer;
  v_result jsonb;
BEGIN
  SELECT g.status
  INTO v_status
  FROM public.games AS g
  WHERE g.id = p_game_id
    AND g.master_id = p_master_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable ou accès refusé.';
  END IF;

  IF v_status <> 'day_resolution' THEN
    RAISE EXCEPTION 'La partie n’est pas en phase de résolution du vote.';
  END IF;

  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'day_resolution'
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune résolution du vote ouverte.';
  END IF;

  IF v_phase.metadata ->> 'resolution_state' = 'awaiting_hunter' THEN
    RETURN jsonb_build_object(
      'success', true,
      'requires_hunter_action', true,
      'game_status', 'hunter_action'
    );
  END IF;

  v_target_id :=
    NULLIF(v_phase.metadata ->> 'target_player_id', '')::uuid;

  -- Si le scrutin n'a désigné personne, aucune élimination n'a lieu.
  IF v_target_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.game_players AS gp
      WHERE gp.id = v_target_id
        AND gp.game_id = p_game_id
        AND gp.registration_status = 'approved'
        AND gp.life_status = 'alive'
    ) THEN
      RAISE EXCEPTION 'La cible du vote n’est plus un joueur vivant valide.';
    END IF;

    SELECT COALESCE(MAX(d.resolution_order), 0) + 1
    INTO v_resolution_order
    FROM public.deaths AS d
    WHERE d.game_id = p_game_id
      AND d.phase_id = v_phase.id;

    INSERT INTO public.deaths (
      game_id,
      phase_id,
      player_id,
      caused_by_player_id,
      death_cause,
      resolution_order,
      details
    )
    VALUES (
      p_game_id,
      v_phase.id,
      v_target_id,
      NULL,
      'village_vote',
      v_resolution_order,
      jsonb_build_object(
        'source', 'village_vote',
        'vote_phase_id', v_phase.metadata ->> 'source_vote_phase_id'
      )
    );

    UPDATE public.game_players
    SET life_status = 'dead'
    WHERE id = v_target_id
      AND game_id = p_game_id;

    v_death_ids := array_append(v_death_ids, v_target_id);

    -- Le décès de l'un des amoureux entraîne celui de son partenaire.
    SELECT
      CASE
        WHEN ll.player_a_id = v_target_id THEN ll.player_b_id
        ELSE ll.player_a_id
      END
    INTO v_partner_id
    FROM public.lover_links AS ll
    WHERE ll.game_id = p_game_id
      AND (
        ll.player_a_id = v_target_id
        OR ll.player_b_id = v_target_id
      )
    LIMIT 1;

    IF v_partner_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.game_players AS gp
         WHERE gp.id = v_partner_id
           AND gp.game_id = p_game_id
           AND gp.registration_status = 'approved'
           AND gp.life_status = 'alive'
       )
    THEN
      v_resolution_order := v_resolution_order + 1;

      INSERT INTO public.deaths (
        game_id,
        phase_id,
        player_id,
        caused_by_player_id,
        death_cause,
        resolution_order,
        details
      )
      VALUES (
        p_game_id,
        v_phase.id,
        v_partner_id,
        v_target_id,
        'lover',
        v_resolution_order,
        jsonb_build_object(
          'source', 'lover_link',
          'caused_by_player_id', v_target_id
        )
      );

      UPDATE public.game_players
      SET life_status = 'dead'
      WHERE id = v_partner_id
        AND game_id = p_game_id;

      v_death_ids := array_append(v_death_ids, v_partner_id);
    END IF;
  END IF;

  -- Un Chasseur mort pendant cette résolution doit encore tirer.
  SELECT dead_player.player_id
  INTO v_hunter_id
  FROM unnest(v_death_ids) AS dead_player(player_id)
  JOIN public.player_roles AS pr
    ON pr.game_id = p_game_id
   AND pr.player_id = dead_player.player_id
  WHERE pr.role_key = 'chasseur'
  LIMIT 1;

  IF v_hunter_id IS NOT NULL THEN
    UPDATE public.game_phases
    SET metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'resolution_state', 'awaiting_hunter',
        'hunter_player_id', v_hunter_id,
        'dead_player_ids', to_jsonb(v_death_ids)
      )
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
      'hunter_action',
      v_phase.day_number,
      v_next_phase_number,
      'open',
      jsonb_build_object(
        'hunter_player_id', v_hunter_id,
        'day_resolution_phase_id', v_phase.id
      ),
      now()
    );

    UPDATE public.games
    SET status = 'hunter_action'
    WHERE id = p_game_id;

    RETURN jsonb_build_object(
      'success', true,
      'requires_hunter_action', true,
      'hunter_player_id', v_hunter_id,
      'dead_player_ids', to_jsonb(v_death_ids),
      'game_status', 'hunter_action'
    );
  END IF;

  RETURN public.finish_day_resolution(p_game_id, v_phase.id);
END;
$$;


-- ============================================================
-- 3. Rendre le tir du Chasseur compatible avec la nuit et le jour
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_hunter_shot(
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
  v_hunter_phase public.game_phases%ROWTYPE;
  v_resolution_phase public.game_phases%ROWTYPE;
  v_expected_hunter_id uuid;
  v_resolution_phase_id uuid;
  v_resolution_order integer;
  v_partner_id uuid;
  v_result jsonb;
BEGIN
  SELECT g.status
  INTO v_status
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND OR v_status <> 'hunter_action' THEN
    RAISE EXCEPTION 'Le pouvoir du Chasseur n’est pas actif.';
  END IF;

  SELECT gp.*
  INTO v_hunter_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'hunter_action'
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune action ouverte pour le Chasseur.';
  END IF;

  v_expected_hunter_id :=
    NULLIF(v_hunter_phase.metadata ->> 'hunter_player_id', '')::uuid;

  v_resolution_phase_id := COALESCE(
    NULLIF(v_hunter_phase.metadata ->> 'night_resolution_phase_id', '')::uuid,
    NULLIF(v_hunter_phase.metadata ->> 'day_resolution_phase_id', '')::uuid
  );

  IF v_expected_hunter_id IS DISTINCT FROM p_player_id THEN
    RAISE EXCEPTION 'Ce pouvoir appartient à un autre joueur.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_players AS gp
    JOIN public.player_roles AS pr
      ON pr.game_id = gp.game_id
     AND pr.player_id = gp.id
    WHERE gp.id = p_player_id
      AND gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'dead'
      AND pr.role_key = 'chasseur'
  ) THEN
    RAISE EXCEPTION 'Le joueur ne possède pas le pouvoir actif du Chasseur.';
  END IF;

  SELECT gp.*
  INTO v_resolution_phase
  FROM public.game_phases AS gp
  WHERE gp.id = v_resolution_phase_id
    AND gp.game_id = p_game_id
    AND gp.phase_key IN ('night_resolution', 'day_resolution')
    AND gp.status = 'open'
    AND gp.metadata ->> 'resolution_state' = 'awaiting_hunter'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La résolution attendue du Chasseur est introuvable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.deaths AS d
    WHERE d.game_id = p_game_id
      AND d.phase_id = v_resolution_phase.id
      AND d.player_id = p_player_id
  ) THEN
    RAISE EXCEPTION 'Le décès du Chasseur n’est pas enregistré dans cette résolution.';
  END IF;

  IF p_target_player_id = p_player_id THEN
    RAISE EXCEPTION 'Le Chasseur ne peut pas se choisir lui-même.';
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

  SELECT COALESCE(MAX(d.resolution_order), 0) + 1
  INTO v_resolution_order
  FROM public.deaths AS d
  WHERE d.game_id = p_game_id
    AND d.phase_id = v_resolution_phase.id;

  INSERT INTO public.deaths (
    game_id,
    phase_id,
    player_id,
    caused_by_player_id,
    death_cause,
    resolution_order,
    details
  )
  VALUES (
    p_game_id,
    v_resolution_phase.id,
    p_target_player_id,
    p_player_id,
    'hunter',
    v_resolution_order,
    jsonb_build_object('source', 'hunter_power')
  );

  UPDATE public.game_players
  SET life_status = 'dead'
  WHERE id = p_target_player_id
    AND game_id = p_game_id;

  -- L'amoureux de la cible du Chasseur est également éliminé.
  SELECT
    CASE
      WHEN ll.player_a_id = p_target_player_id THEN ll.player_b_id
      ELSE ll.player_a_id
    END
  INTO v_partner_id
  FROM public.lover_links AS ll
  WHERE ll.game_id = p_game_id
    AND (
      ll.player_a_id = p_target_player_id
      OR ll.player_b_id = p_target_player_id
    )
  LIMIT 1;

  IF v_partner_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.game_players AS gp
       WHERE gp.id = v_partner_id
         AND gp.game_id = p_game_id
         AND gp.registration_status = 'approved'
         AND gp.life_status = 'alive'
     )
  THEN
    v_resolution_order := v_resolution_order + 1;

    INSERT INTO public.deaths (
      game_id,
      phase_id,
      player_id,
      caused_by_player_id,
      death_cause,
      resolution_order,
      details
    )
    VALUES (
      p_game_id,
      v_resolution_phase.id,
      v_partner_id,
      p_target_player_id,
      'lover',
      v_resolution_order,
      jsonb_build_object(
        'source', 'lover_link',
        'caused_by_player_id', p_target_player_id
      )
    );

    UPDATE public.game_players
    SET life_status = 'dead'
    WHERE id = v_partner_id
      AND game_id = p_game_id;
  END IF;

  UPDATE public.game_phases
  SET
    status = 'resolved',
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'target_player_id', p_target_player_id,
        'resolved_at', now()
      ),
    closed_at = now(),
    resolved_at = now()
  WHERE id = v_hunter_phase.id;

  UPDATE public.game_phases
  SET metadata = COALESCE(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'resolution_state', 'completing',
      'hunter_target_player_id', p_target_player_id,
      'hunter_partner_killed', v_partner_id
    )
  WHERE id = v_resolution_phase.id;

  IF v_resolution_phase.phase_key = 'night_resolution' THEN
    v_result := public.finish_night_resolution(
      p_game_id,
      v_resolution_phase.id
    );
  ELSE
    v_result := public.finish_day_resolution(
      p_game_id,
      v_resolution_phase.id
    );
  END IF;

  RETURN v_result || jsonb_build_object(
    'hunter_target_player_id', p_target_player_id
  );
END;
$$;


-- ============================================================
-- 4. Restreindre l'exécution aux routes serveur
-- ============================================================

REVOKE ALL ON FUNCTION public.finish_day_resolution(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_day_resolution(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.resolve_day_vote(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_day_vote(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.submit_hunter_shot(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hunter_shot(uuid, uuid, uuid)
  TO service_role;
