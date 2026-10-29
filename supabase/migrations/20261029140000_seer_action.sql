
CREATE OR REPLACE FUNCTION public.submit_seer_action(
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
  v_day_number integer;
  v_phase public.game_phases%ROWTYPE;
  v_next_phase_number integer;
  v_target_role_key text;
  v_target_name text;
  v_next_phase_key text := 'night_resolution';
BEGIN
  -- Verrouiller la partie et vérifier la phase active.
  SELECT g.status, g.round_number
  INTO v_game_status, v_day_number
  FROM public.games AS g
  WHERE g.id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partie introuvable.';
  END IF;

  IF v_game_status <> 'night_seer_action' THEN
    RAISE EXCEPTION 'La phase de la Voyante n’est pas active.';
  END IF;

  -- Seule une Voyante validée et vivante peut effectuer cette action.
  IF NOT EXISTS (
    SELECT 1
    FROM public.game_players AS gp
    JOIN public.player_roles AS pr
      ON pr.game_id = gp.game_id
     AND pr.player_id = gp.id
    WHERE gp.id = p_player_id
      AND gp.game_id = p_game_id
      AND gp.registration_status = 'approved'
      AND gp.life_status = 'alive'
      AND pr.role_key = 'voyante'
  ) THEN
    RAISE EXCEPTION 'Action réservée à une Voyante vivante.';
  END IF;

  IF p_target_player_id = p_player_id THEN
    RAISE EXCEPTION 'La Voyante ne peut pas se sélectionner elle-même.';
  END IF;

  -- Verrouiller la phase ouverte.
  SELECT gp.*
  INTO v_phase
  FROM public.game_phases AS gp
  WHERE gp.game_id = p_game_id
    AND gp.phase_key = 'night_seer_action'
    AND gp.status = 'open'
  ORDER BY gp.phase_number DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucune phase ouverte pour la Voyante.';
  END IF;

  -- La cible doit être un autre joueur validé et vivant.
  SELECT gp.display_name
  INTO v_target_name
  FROM public.game_players AS gp
  WHERE gp.id = p_target_player_id
    AND gp.game_id = p_game_id
    AND gp.registration_status = 'approved'
    AND gp.life_status = 'alive';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cible doit être un joueur vivant et validé.';
  END IF;

  -- Lire le rôle de la cible depuis la table player_roles.
  SELECT pr.role_key
  INTO v_target_role_key
  FROM public.player_roles AS pr
  WHERE pr.game_id = p_game_id
    AND pr.player_id = p_target_player_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun rôle attribué à ce joueur.';
  END IF;

  -- Enregistrer le résultat dans les métadonnées de la phase.
  -- L'API ne transmettra ce résultat qu'à la Voyante authentifiée.
  UPDATE public.game_phases
  SET
    status = 'resolved',
    metadata = COALESCE(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'seer_player_id', p_player_id,
        'inspected_player_id', p_target_player_id,
        'inspected_player_name', v_target_name,
        'inspected_role_key', v_target_role_key,
        'submitted_at', now()
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
    v_next_phase_key,
    GREATEST(COALESCE(v_phase.day_number, v_day_number, 1), 1),
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
    'inspected_player_id', p_target_player_id,
    'inspected_player_name', v_target_name,
    'target_role_key', v_target_role_key,
    'next_phase', v_next_phase_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_seer_action(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_seer_action(
  uuid, uuid, uuid
) TO service_role;
