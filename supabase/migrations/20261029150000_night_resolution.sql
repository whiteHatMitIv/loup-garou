
-- =========================================================
-- 1. Finaliser une résolution de nuit
-- =========================================================

CREATE OR REPLACE FUNCTION public.finish_night_resolution(
  p_game_id uuid,
  p_phase_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_game_status text;
  v_day_number integer;
  v_wolves_alive integer := 0;
  v_village_alive integer := 0;
  v_winner text;
  v_phase public.game_phases%ROWTYPE;
  v_next_phase_number integer;
BEGIN
  SELECT g.status
  INTO v_game_status
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable.';
  END IF;

  IF v_game_status IN ('game_over', 'finished') THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_finished', true,
      'winner', v_game_status
    );
  END IF;

  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.id = p_phase_id
    AND gp.game_id = p_game_id
    AND gp.phase_key = 'night_resolution'
    AND gp.status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La phase de résolution de nuit n’est pas ouverte.';
  END IF;

  IF v_phase.metadata ->> 'resolution_state' = 'awaiting_hunter' THEN
    RAISE EXCEPTION 'La résolution attend encore le tir du Chasseur.';
  END IF;

  v_day_number := v_phase.day_number;

  -- Compter les joueurs encore vivants et validés par camp.
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

  IF v_winner IS NOT NULL THEN
    UPDATE public.games
    SET
      status = 'game_over',
      winner = v_winner,
      ended_at = now()
    WHERE id = p_game_id;

    -- +3 points pour les membres vivants du camp victorieux.
    -- ON CONFLICT DO NOTHING protège les clés d'idempotence
    -- si une contrainte UNIQUE existe sur cette table.
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
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object(
      'success', true,
      'winner', v_winner,
      'wolves_alive', v_wolves_alive,
      'village_alive', v_village_alive,
      'game_status', 'game_over'
    );
  END IF;

  -- La nuit est terminée : ouvrir le débat du village.
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
    'day_discussion',
    v_day_number,
    v_next_phase_number,
    'open',
    '{}'::jsonb,
    now()
  );

  UPDATE public.games
  SET status = 'day_discussion'
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'winner', null,
    'game_status', 'day_discussion',
    'wolves_alive', v_wolves_alive,
    'village_alive', v_village_alive
  );
END;
$$;


-- =========================================================
-- 2. Résoudre les victimes de la nuit
-- =========================================================

CREATE OR REPLACE FUNCTION public.resolve_night(
  p_game_id uuid,
  p_master_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_game_status text;
  v_phase public.game_phases%ROWTYPE;
  v_wolf_phase public.game_phases%ROWTYPE;
  v_witch_phase public.game_phases%ROWTYPE;

  v_wolf_target_id uuid;
  v_saved_target_id uuid;
  v_poison_target_id uuid;

  v_death_ids uuid[] := ARRAY[]::uuid[];
  v_initial_death_ids uuid[] := ARRAY[]::uuid[];
  v_current_id uuid;
  v_partner_id uuid;
  v_hunter_id uuid;
  v_resolution_order integer;
  v_next_phase_number integer;
BEGIN
  SELECT g.status
  INTO v_game_status
  FROM public.games AS g
  WHERE g.id = p_game_id
    AND g.master_id = p_master_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable ou accès refusé.';
  END IF;

  IF v_game_status <> 'night_resolution' THEN
    RAISE EXCEPTION 'La partie n’est pas dans la phase de résolution de nuit.';
  END IF;

  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_resolution'
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune phase de résolution de nuit ouverte.';
  END IF;

  IF v_phase.metadata ->> 'resolution_state' = 'awaiting_hunter' THEN
    RETURN jsonb_build_object(
      'success', true,
      'requires_hunter_action', true,
      'game_status', 'hunter_action',
      'hunter_player_id', v_phase.metadata ->> 'hunter_player_id'
    );
  END IF;

  SELECT COALESCE(MAX(d.resolution_order), 0)
  INTO v_resolution_order
  FROM public.deaths AS d
  WHERE d.game_id = p_game_id
    AND d.phase_id = v_phase.id;

  -- Le dernier vote des Loups précédant cette résolution.
  SELECT gp.*
  INTO v_wolf_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_wolf_vote'
    AND gp.status = 'resolved'
    AND gp.phase_number < v_phase.phase_number
  ORDER BY gp.phase_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Impossible de retrouver le vote résolu des Loups.';
  END IF;

  v_wolf_target_id :=
    NULLIF(
      v_wolf_phase.metadata ->> 'wolf_target_player_id',
      ''
    )::uuid;

  -- Ne prendre en compte que l'action de la Sorcière de cette nuit :
  -- elle doit se situer après le vote courant et avant la résolution.
  SELECT gp.*
  INTO v_witch_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_witch_action'
    AND gp.status = 'resolved'
    AND gp.phase_number > v_wolf_phase.phase_number
    AND gp.phase_number < v_phase.phase_number
  ORDER BY gp.phase_number DESC
  LIMIT 1;

  IF FOUND THEN
    v_saved_target_id :=
      NULLIF(
        v_witch_phase.metadata ->> 'saved_player_id',
        ''
      )::uuid;

    v_poison_target_id :=
      NULLIF(
        v_witch_phase.metadata ->> 'poison_target_player_id',
        ''
      )::uuid;
  ELSE
    v_saved_target_id := NULL;
    v_poison_target_id := NULL;
  END IF;

  -- Première victime : la cible des Loups, sauf si elle a été sauvée.
  IF v_wolf_target_id IS NOT NULL
     AND v_wolf_target_id IS DISTINCT FROM v_saved_target_id
     AND EXISTS (
       SELECT 1
       FROM public.game_players AS gp
       WHERE gp.id = v_wolf_target_id
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
      v_wolf_target_id,
      NULL,
      'wolves',
      v_resolution_order,
      jsonb_build_object('source', 'wolf_vote')
    );

    UPDATE public.game_players
    SET life_status = 'dead'
    WHERE id = v_wolf_target_id
      AND game_id = p_game_id;

    v_death_ids := array_append(v_death_ids, v_wolf_target_id);
  END IF;

  -- Deuxième victime possible : la cible de la potion de mort.
  -- Si elle est aussi la victime sauvée des Loups, le poison la tue.
  IF v_poison_target_id IS NOT NULL
     AND NOT (v_poison_target_id = ANY(v_death_ids))
     AND EXISTS (
       SELECT 1
       FROM public.game_players AS gp
       WHERE gp.id = v_poison_target_id
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
      v_poison_target_id,
      NULL,
      'witch_poison',
      v_resolution_order,
      jsonb_build_object('source', 'witch_potion')
    );

    UPDATE public.game_players
    SET life_status = 'dead'
    WHERE id = v_poison_target_id
      AND game_id = p_game_id;

    v_death_ids := array_append(v_death_ids, v_poison_target_id);
  END IF;

  -- Copier les victimes initiales. Le lien amoureux peut ajouter
  -- au plus l'autre membre du couple, sans créer de doublon.
  v_initial_death_ids := v_death_ids;

  FOREACH v_current_id IN ARRAY v_initial_death_ids
  LOOP
    SELECT
      CASE
        WHEN ll.player_a_id = v_current_id THEN ll.player_b_id
        ELSE ll.player_a_id
      END
    INTO v_partner_id
    FROM public.lover_links AS ll
    WHERE ll.game_id = p_game_id
      AND (
        ll.player_a_id = v_current_id
        OR ll.player_b_id = v_current_id
      )
    LIMIT 1;

    IF v_partner_id IS NOT NULL
       AND NOT (v_partner_id = ANY(v_death_ids))
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
        v_current_id,
        'lover',
        v_resolution_order,
        jsonb_build_object(
          'source', 'lover_link',
          'caused_by_player_id', v_current_id
        )
      );

      UPDATE public.game_players
      SET life_status = 'dead'
      WHERE id = v_partner_id
        AND game_id = p_game_id;

      v_death_ids := array_append(v_death_ids, v_partner_id);
    END IF;
  END LOOP;

  -- Si le Chasseur figure parmi les morts de cette nuit,
  -- attendre son tir avant de terminer la résolution.
  SELECT dead_player.id
  INTO v_hunter_id
  FROM unnest(v_death_ids) AS dead_player(id)
  JOIN public.player_roles AS pr
    ON pr.game_id = p_game_id
   AND pr.player_id = dead_player.id
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
        'night_resolution_phase_id', v_phase.id
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

  RETURN public.finish_night_resolution(p_game_id, v_phase.id);
END;
$$;


-- =========================================================
-- 3. Permettre au Chasseur d'emporter une cible avec lui
-- =========================================================

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
  v_game_status text;
  v_hunter_phase public.game_phases%ROWTYPE;
  v_night_phase public.game_phases%ROWTYPE;
  v_expected_hunter_id uuid;
  v_night_phase_id uuid;
  v_resolution_order integer;
  v_partner_id uuid;
  v_next_result jsonb;
BEGIN
  SELECT g.status
  INTO v_game_status
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable.';
  END IF;

  IF v_game_status <> 'hunter_action' THEN
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
    RAISE EXCEPTION 'Aucune phase ouverte pour le Chasseur.';
  END IF;

  v_expected_hunter_id :=
    NULLIF(
      v_hunter_phase.metadata ->> 'hunter_player_id',
      ''
    )::uuid;

  v_night_phase_id :=
    NULLIF(
      v_hunter_phase.metadata ->> 'night_resolution_phase_id',
      ''
    )::uuid;

  IF v_expected_hunter_id IS DISTINCT FROM p_player_id THEN
    RAISE EXCEPTION 'Ce pouvoir appartient à un autre joueur.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_players AS gp
    JOIN public.player_roles AS pr
      ON pr.game_id = gp.game_id
     AND pr.player_id = gp.id
    JOIN public.deaths AS d
      ON d.game_id = gp.game_id
     AND d.player_id = gp.id
     AND d.phase_id = v_night_phase_id
    WHERE gp.id = p_player_id
      AND gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND pr.role_key = 'chasseur'
  ) THEN
    RAISE EXCEPTION 'Le joueur ne possède pas le pouvoir actif du Chasseur.';
  END IF;

  SELECT gp.*
  INTO v_night_phase
  FROM public.game_phases AS gp
  WHERE gp.id = v_night_phase_id
    AND gp.game_id = p_game_id
    AND gp.phase_key = 'night_resolution'
    AND gp.status = 'open'
    AND gp.metadata ->> 'resolution_state' = 'awaiting_hunter'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La résolution de nuit n’attend pas de tir du Chasseur.';
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
    RAISE EXCEPTION 'La cible du Chasseur doit être vivante et validée.';
  END IF;

  SELECT COALESCE(MAX(d.resolution_order), 0) + 1
  INTO v_resolution_order
  FROM public.deaths AS d
  WHERE d.game_id = p_game_id
    AND d.phase_id = v_night_phase.id;

  -- Le tir du Chasseur ignore la potion de vie :
  -- celle-ci a déjà été jouée avant le pouvoir du Chasseur.
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
    v_night_phase.id,
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

  -- Le partenaire amoureux de la cible meurt également.
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
      v_night_phase.id,
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
  WHERE id = v_night_phase.id;

  v_next_result :=
    public.finish_night_resolution(p_game_id, v_night_phase.id);

  RETURN v_next_result
    || jsonb_build_object(
      'hunter_target_player_id', p_target_player_id
    );
END;
$$;


-- =========================================================
-- 4. Restreindre l'exécution de ces fonctions aux routes serveur
-- =========================================================

REVOKE ALL ON FUNCTION public.finish_night_resolution(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_night_resolution(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.resolve_night(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_night(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.submit_hunter_shot(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_hunter_shot(uuid, uuid, uuid)
  TO service_role;
