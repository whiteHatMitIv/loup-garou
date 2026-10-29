begin;

-- =========================================================
-- 1. SOUMETTRE OU MODIFIER LE VOTE D'UN LOUP
-- =========================================================

create or replace function public.submit_wolf_vote(
  p_game_id uuid,
  p_player_id uuid,
  p_target_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_status text;
  v_phase_id uuid;
begin
  if p_player_id = p_target_player_id then
    raise exception using
      errcode = '22023',
      message = 'A player cannot target themselves.';
  end if;

  -- Verrouiller la partie pour éviter les courses avec la clôture.
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

  if v_game_status <> 'night_wolf_vote' then
    raise exception using
      errcode = '55000',
      message = 'Wolf vote phase is not open.';
  end if;

  -- Vérifier le Loup et la phase ouverte.
  if not exists (
    select 1
    from public.game_players as gp
    join public.player_roles as pr
      on pr.game_id = gp.game_id
     and pr.player_id = gp.id
    where gp.game_id = p_game_id
      and gp.id = p_player_id
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
      and pr.role_key = 'loup_garou'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Player is not an eligible Wolf.';
  end if;

  select ph.id
  into v_phase_id
  from public.game_phases as ph
  where ph.game_id = p_game_id
    and ph.phase_key = 'night_wolf_vote'
    and ph.status = 'open'
  order by ph.phase_number desc
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Wolf vote phase is not open.';
  end if;

  -- La cible doit être un joueur vivant, validé et non-Loup.
  if not exists (
    select 1
    from public.game_players as gp
    join public.player_roles as pr
      on pr.game_id = gp.game_id
     and pr.player_id = gp.id
    where gp.game_id = p_game_id
      and gp.id = p_target_player_id
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
      and pr.role_key <> 'loup_garou'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Target is not an eligible player.';
  end if;

  -- Un seul bulletin par Loup pour cette phase.
  -- Le choix peut être modifié tant que le vote est ouvert.
  insert into public.votes (
    game_id,
    phase_id,
    voter_player_id,
    target_player_id,
    vote_kind,
    submitted_at
  )
  values (
    p_game_id,
    v_phase_id,
    p_player_id,
    p_target_player_id,
    'wolves',
    pg_catalog.now()
  )
  on conflict (phase_id, voter_player_id)
  do update set
    target_player_id = excluded.target_player_id,
    vote_kind = 'wolves',
    submitted_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object(
    'success', true,
    'message', 'Vote enregistré.'
  );
end;
$$;


-- =========================================================
-- 2. CLÔTURER ET RÉSOUDRE LE VOTE DES LOUPS
-- =========================================================

create or replace function public.resolve_wolf_vote(
  p_game_id uuid,
  p_master_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_status text;
  v_round_number integer;
  v_phase_id uuid;
  v_next_phase_number integer;

  v_target_player_id uuid;
  v_victim_display_name text;

  v_alive_wolves integer;
  v_submitted_votes integer;
  v_vote_tally jsonb;

  v_next_status text;
  v_now timestamptz := pg_catalog.now();
  v_event_sequence bigint;
begin
  -- Verrouiller la partie. Les soumissions de votes utilisent
  -- le même verrou et ne peuvent donc pas passer après la clôture.
  select g.status, g.round_number
  into v_game_status, v_round_number
  from public.games as g
  where g.id = p_game_id
    and g.master_id = p_master_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Game not found or not owned by this master.';
  end if;

  if v_game_status <> 'night_wolf_vote' then
    raise exception using
      errcode = '55000',
      message = 'Game is not in the wolf vote phase.';
  end if;

  select ph.id
  into v_phase_id
  from public.game_phases as ph
  where ph.game_id = p_game_id
    and ph.phase_key = 'night_wolf_vote'
    and ph.status = 'open'
  order by ph.phase_number desc
  limit 1
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'No open wolf vote phase.';
  end if;

  -- Nombre de Loups encore vivants.
  select pg_catalog.count(*)::integer
  into v_alive_wolves
  from public.game_players as gp
  join public.player_roles as pr
    on pr.game_id = gp.game_id
   and pr.player_id = gp.id
  where gp.game_id = p_game_id
    and gp.registration_status = 'approved'
    and gp.life_status = 'alive'
    and pr.role_key = 'loup_garou';

  -- Nombre de bulletins valides soumis par les Loups vivants.
  select pg_catalog.count(*)::integer
  into v_submitted_votes
  from public.votes as v
  join public.game_players as voter
    on voter.game_id = v.game_id
   and voter.id = v.voter_player_id
  join public.player_roles as voter_role
    on voter_role.game_id = voter.game_id
   and voter_role.player_id = voter.id
  where v.game_id = p_game_id
    and v.phase_id = v_phase_id
    and v.vote_kind = 'wolves'
    and v.target_player_id is not null
    and voter.registration_status = 'approved'
    and voter.life_status = 'alive'
    and voter_role.role_key = 'loup_garou';

  -- Compter les voix valides.
  -- En cas d'égalité, le prénom normalisé le plus petit gagne.
  with tally as (
    select
      target.id as target_id,
      target.display_name,
      target.normalized_name,
      pg_catalog.count(*)::integer as vote_count
    from public.votes as v
    join public.game_players as voter
      on voter.game_id = v.game_id
     and voter.id = v.voter_player_id
    join public.player_roles as voter_role
      on voter_role.game_id = voter.game_id
     and voter_role.player_id = voter.id
    join public.game_players as target
      on target.game_id = v.game_id
     and target.id = v.target_player_id
    join public.player_roles as target_role
      on target_role.game_id = target.game_id
     and target_role.player_id = target.id
    where v.game_id = p_game_id
      and v.phase_id = v_phase_id
      and v.vote_kind = 'wolves'
      and v.target_player_id is not null
      and voter.registration_status = 'approved'
      and voter.life_status = 'alive'
      and voter_role.role_key = 'loup_garou'
      and target.registration_status = 'approved'
      and target.life_status = 'alive'
      and target_role.role_key <> 'loup_garou'
    group by
      target.id,
      target.display_name,
      target.normalized_name
  ),
  winner as (
    select t.target_id
    from tally as t
    order by
      t.vote_count desc,
      t.normalized_name asc,
      t.target_id asc
    limit 1
  )
  select
    (select w.target_id from winner as w),
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'targetPlayerId', t.target_id,
            'displayName', t.display_name,
            'votes', t.vote_count
          )
          order by
            t.vote_count desc,
            t.normalized_name asc,
            t.target_id asc
        )
        from tally as t
      ),
      '[]'::jsonb
    )
  into v_target_player_id, v_vote_tally;

  if v_target_player_id is not null then
    select gp.display_name
    into v_victim_display_name
    from public.game_players as gp
    where gp.game_id = p_game_id
      and gp.id = v_target_player_id;
  end if;

  -- Aucun vote signifie aucune victime sélectionnée par les Loups.
  -- Cette étape ne tue personne : elle enregistre seulement la cible.
  update public.game_phases
  set
    status = 'resolved',
    closed_at = v_now,
    resolved_at = v_now,
    metadata = coalesce(metadata, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'wolf_target_player_id', v_target_player_id,
        'wolf_vote_counts', v_vote_tally,
        'wolf_submitted_votes', v_submitted_votes,
        'wolf_alive_count', v_alive_wolves,
        'wolf_vote_resolved_at', v_now
      )
  where id = v_phase_id;

  -- Choisir la prochaine phase selon les rôles réellement présents.
  if exists (
    select 1
    from public.game_players as gp
    join public.player_roles as pr
      on pr.game_id = gp.game_id
     and pr.player_id = gp.id
    where gp.game_id = p_game_id
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
      and pr.role_key = 'sorciere'
  ) then
    v_next_status := 'night_witch_action';

  elsif exists (
    select 1
    from public.game_players as gp
    join public.player_roles as pr
      on pr.game_id = gp.game_id
     and pr.player_id = gp.id
    where gp.game_id = p_game_id
      and gp.registration_status = 'approved'
      and gp.life_status = 'alive'
      and pr.role_key = 'voyante'
  ) then
    v_next_status := 'night_seer_action';

  else
    v_next_status := 'night_resolution';
  end if;

  select coalesce(pg_catalog.max(ph.phase_number), 0) + 1
  into v_next_phase_number
  from public.game_phases as ph
  where ph.game_id = p_game_id;

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
    v_next_status,
    greatest(v_round_number, 1),
    v_next_phase_number,
    'open',
    v_now
  );

  update public.games
  set status = v_next_status
  where id = p_game_id;

  select coalesce(pg_catalog.max(ge.sequence_number), 0) + 1
  into v_event_sequence
  from public.game_events as ge
  where ge.game_id = p_game_id;

  insert into public.game_events (
    game_id,
    actor_user_id,
    event_type,
    visibility,
    sequence_number,
    payload
  )
  values (
    p_game_id,
    p_master_id,
    'wolf_vote_resolved',
    'master_only',
    v_event_sequence,
    pg_catalog.jsonb_build_object(
      'victim_player_id', v_target_player_id,
      'vote_counts', v_vote_tally,
      'submitted_votes', v_submitted_votes,
      'alive_wolves', v_alive_wolves,
      'next_phase', v_next_status
    )
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'victim_player_id', v_target_player_id,
    'victim_display_name', v_victim_display_name,
    'submitted_votes', v_submitted_votes,
    'alive_wolves', v_alive_wolves,
    'vote_counts', v_vote_tally,
    'next_phase', v_next_status
  );
end;
$$;


-- Ces fonctions sont appelées par le serveur avec le client
-- d'administration, jamais directement depuis le navigateur.

revoke all on function
  public.submit_wolf_vote(uuid, uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.submit_wolf_vote(uuid, uuid, uuid)
to service_role;

revoke all on function
  public.resolve_wolf_vote(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.resolve_wolf_vote(uuid, uuid)
to service_role;

commit;