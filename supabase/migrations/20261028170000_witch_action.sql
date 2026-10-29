
CREATE OR REPLACE FUNCTION public.submit_witch_action(
  p_game_id uuid,
  p_player_id uuid,
  p_save_life boolean,
  p_poison_target_player_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_game_status text;
  v_day_number integer;
  v_role_key text;
  v_phase public.game_phases%ROWTYPE;
  v_wolf_phase public.game_phases%ROWTYPE;
  v_wolf_target_id uuid;
  v_next_phase_key text;
  v_next_phase_number integer;
  v_life_potion_used boolean;
  v_death_potion_used boolean;
  v_metadata jsonb;
BEGIN
  IF p_save_life IS NULL THEN
    RAISE EXCEPTION 'Le choix de la potion de vie est invalide.';
  END IF;

  SELECT
    g.status,
    GREATEST(COALESCE(g.round_number, 1), 1)
  INTO v_game_status, v_day_number
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable.';
  END IF;

  IF v_game_status <> 'night_witch_action' THEN
    RAISE EXCEPTION 'La phase de la Sorcière n’est pas active.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_players AS gp
    WHERE gp.id = p_player_id
      AND gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
  ) THEN
    RAISE EXCEPTION 'Joueur introuvable, non validé ou éliminé.';
  END IF;

  SELECT pr.role_key
  INTO v_role_key
  FROM public.player_roles AS pr
  WHERE pr.game_id = p_game_id
    AND pr.player_id = p_player_id
  LIMIT 1;

  IF v_role_key IS DISTINCT FROM 'sorciere' THEN
    RAISE EXCEPTION 'Seule la Sorcière peut effectuer cette action.';
  END IF;

  -- Utiliser phase_key, qui est la vraie colonne de la table.
  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_witch_action'
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune phase ouverte pour la Sorcière.';
  END IF;

  SELECT gp.*
  INTO v_wolf_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_wolf_vote'
    AND gp.status = 'resolved'
  ORDER BY gp.phase_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Le vote des Loups n’a pas encore été résolu.';
  END IF;

  v_wolf_target_id :=
    NULLIF(
      v_wolf_phase.metadata ->> 'wolf_target_player_id',
      ''
    )::uuid;

  IF p_save_life AND v_wolf_target_id IS NULL THEN
    RAISE EXCEPTION 'Aucune victime des Loups ne peut être sauvée.';
  END IF;

  SELECT
    COALESCE(
      bool_or((gp.metadata ->> 'life_potion_used') = 'true'),
      false
    ),
    COALESCE(
      bool_or((gp.metadata ->> 'death_potion_used') = 'true'),
      false
    )
  INTO v_life_potion_used, v_death_potion_used
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_witch_action'
    AND gp.status = 'resolved'
    AND gp.id <> v_phase.id;

  IF p_save_life AND v_life_potion_used THEN
    RAISE EXCEPTION 'La potion de vie a déjà été utilisée.';
  END IF;

  IF p_poison_target_player_id IS NOT NULL
     AND v_death_potion_used THEN
    RAISE EXCEPTION 'La potion de mort a déjà été utilisée.';
  END IF;

  IF p_poison_target_player_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.game_players AS gp
       WHERE gp.id = p_poison_target_player_id
         AND gp.game_id = p_game_id
         AND gp.registration_status = 'approved'
         AND gp.life_status = 'alive'
     )
  THEN
    RAISE EXCEPTION 'La cible de la potion de mort n’est pas valide.';
  END IF;

  v_metadata :=
    COALESCE(v_phase.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'life_potion_used', p_save_life,
      'saved_player_id',
        CASE
          WHEN p_save_life THEN v_wolf_target_id
          ELSE NULL
        END,
      'death_potion_used',
        p_poison_target_player_id IS NOT NULL,
      'poison_target_player_id', p_poison_target_player_id,
      'submitted_by_player_id', p_player_id,
      'submitted_at', now()
    );

  UPDATE public.game_phases
  SET
    status = 'resolved',
    metadata = v_metadata,
    closed_at = now(),
    resolved_at = now()
  WHERE id = v_phase.id;

  IF EXISTS (
    SELECT 1
    FROM public.player_roles AS pr
    JOIN public.game_players AS gp
      ON gp.id = pr.player_id
    WHERE pr.game_id = p_game_id
      AND pr.role_key = 'voyante'
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
  ) THEN
    v_next_phase_key := 'night_seer_action';
  ELSE
    v_next_phase_key := 'night_resolution';
  END IF;

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
    v_next_phase_key,
    v_day_number,
    v_next_phase_number,
    'open',
    '{}'::jsonb,
    now()
  );

  UPDATE public.games
  SET status = v_next_phase_key
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'success', true,
    'next_phase', v_next_phase_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_witch_action(
  uuid, uuid, boolean, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_witch_action(
  uuid, uuid, boolean, uuid
) TO service_role;
