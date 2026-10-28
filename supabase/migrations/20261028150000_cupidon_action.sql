begin;

create or replace function public.submit_cupidon_link(
  p_game_id uuid,
  p_cupidon_player_id uuid,
  p_player_a_id uuid,
  p_player_b_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_status text;
  v_phase_id uuid;
  v_phase_number integer;
  v_event_sequence bigint;
  v_now timestamptz := pg_catalog.now();
begin
  -- Empêcher les sélections identiques.
  if p_player_a_id = p_player_b_id then
    raise exception using
      errcode = '22023',
      message = 'The two lovers must be different players.';
  end if;

  -- Verrouiller la partie pour empêcher les doubles exécutions.
  select g.status
  into v_game_status
  from public.games as g
  where g.id = p_game_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Game not found.';
  end if;

  if v_game_status <> 'cupidon_selection' then
    raise exception using
      errcode = '55000',
      message = 'Cupidon selection phase is not open.';
  end if;

  -- Vérifier que le joueur possède réellement le rôle Cupidon.
  if not exists (
    select 1
    from public.player_roles as pr
    join public.game_players as gp
      on gp.game_id = pr.game_id
     and gp.id = pr.player_id
    where pr.game_id = p_game_id
      and pr.player_id = p_cupidon_player_id
      and pr.role_key = 'cupidon'
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Player is not an eligible Cupidon.';
  end if;

  -- Vérifier que la phase Cupidon est bien ouverte.
  select ph.id
  into v_phase_id
  from public.game_phases as ph
  where ph.game_id = p_game_id
    and ph.phase_key = 'cupidon_selection'
    and ph.status = 'open'
  order by ph.phase_number desc
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Cupidon phase is not open.';
  end if;

  -- Vérifier que les deux cibles appartiennent à la partie
  -- et sont des joueurs validés et vivants.
  if not exists (
    select 1
    from public.game_players as gp
    where gp.game_id = p_game_id
      and gp.id = p_player_a_id
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
  ) then
    raise exception using
      errcode = '22023',
      message = 'First lover is not an eligible player.';
  end if;

  if not exists (
    select 1
    from public.game_players as gp
    where gp.game_id = p_game_id
      and gp.id = p_player_b_id
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Second lover is not an eligible player.';
  end if;

  -- Un lien unique par partie.
  if exists (
    select 1
    from public.lover_links as ll
    where ll.game_id = p_game_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Lover link has already been created.';
  end if;

  -- Créer le lien amoureux secret.
  insert into public.lover_links (
    game_id,
    player_a_id,
    player_b_id,
    created_by_player_id
  )
  values (
    p_game_id,
    p_player_a_id,
    p_player_b_id,
    p_cupidon_player_id
  );

  -- Enregistrer l'action dans l'historique confidentiel.
  insert into public.role_actions (
    game_id,
    phase_id,
    actor_player_id,
    target_player_id,
    action_type,
    status,
    payload,
    idempotency_key,
    resolved_at
  )
  values (
    p_game_id,
    v_phase_id,
    p_cupidon_player_id,
    p_player_a_id,
    'cupidon_link',
    'resolved',
    pg_catalog.jsonb_build_object(
      'first_player_id', p_player_a_id,
      'second_player_id', p_player_b_id
    ),
    'cupidon_link:' || p_cupidon_player_id::text,
    v_now
  );

  -- Clôturer la phase de Cupidon.
  update public.game_phases
  set
    status = 'resolved',
    closed_at = v_now,
    resolved_at = v_now
  where id = v_phase_id;

  -- Calculer le prochain numéro de phase.
  select coalesce(pg_catalog.max(ph.phase_number), 0) + 1
  into v_phase_number
  from public.game_phases as ph
  where ph.game_id = p_game_id;

  -- Ouvrir la première phase nocturne.
  insert into public.game_phases (
    game_id,
    phase_key,
    day_number,
    phase_number,
    status,
    opened_at
  )
  values (
    p_game_id,
    'night_wolf_vote',
    1,
    v_phase_number,
    'open',
    v_now
  );

  -- Mettre à jour la partie.
  update public.games
  set
    status = 'night_wolf_vote',
    round_number = 1
  where id = p_game_id;

  -- Journaliser l'événement sans exposer les amoureux aux joueurs.
  select coalesce(pg_catalog.max(ge.sequence_number), 0) + 1
  into v_event_sequence
  from public.game_events as ge
  where ge.game_id = p_game_id;

  insert into public.game_events (
    game_id,
    actor_player_id,
    event_type,
    visibility,
    sequence_number,
    payload
  )
  values (
    p_game_id,
    p_cupidon_player_id,
    'cupidon_link_created',
    'master_only',
    v_event_sequence,
    pg_catalog.jsonb_build_object(
      'first_player_id', p_player_a_id,
      'second_player_id', p_player_b_id
    )
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'status', 'night_wolf_vote',
    'round_number', 1
  );
end;
$$;

revoke all on function public.submit_cupidon_link(uuid, uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.submit_cupidon_link(uuid, uuid, uuid, uuid)
to service_role;

commit;