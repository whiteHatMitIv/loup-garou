begin;

-- =========================================================
-- 1. EMPÊCHER LES INSCRIPTIONS APRÈS LE LANCEMENT
-- =========================================================

create or replace function public.guard_game_player_registration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_game_status text;
begin
  select g.status
  into v_game_status
  from public.games as g
  where g.id = new.game_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Game not found.';
  end if;

  if tg_op = 'INSERT' then
    if v_game_status <> 'lobby' then
      raise exception using
        errcode = '55000',
        message = 'Registrations are closed.';
    end if;
  else
    if new.registration_status is distinct from old.registration_status
       and v_game_status <> 'lobby' then
      raise exception using
        errcode = '55000',
        message = 'Registrations are closed.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_game_player_registration
on public.game_players;

create trigger guard_game_player_registration
before insert or update of registration_status
on public.game_players
for each row
execute function public.guard_game_player_registration();


-- =========================================================
-- 2. LANCEMENT ATOMIQUE D'UNE PARTIE
-- =========================================================

create or replace function public.start_game(
  p_game_id uuid,
  p_master_id uuid,
  p_role_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_status text;
  v_role_key text;
  v_role_value numeric;

  v_villageois integer;
  v_loups integer;
  v_voyante integer;
  v_sorciere integer;
  v_chasseur integer;
  v_cupidon integer;

  v_village_count integer;
  v_total_roles integer;
  v_approved_count integer;
  v_assigned_count integer;

  v_next_status text;
  v_next_round integer;

  v_now timestamptz := pg_catalog.now();
  v_next_event_seq bigint;
begin
  -- Valider le format général.
  if p_role_counts is null
     or pg_catalog.jsonb_typeof(p_role_counts) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'Invalid role counts.';
  end if;

  -- Refuser les clés qui ne correspondent pas aux rôles connus.
  for v_role_key in
    select k.key
    from pg_catalog.jsonb_object_keys(p_role_counts) as k(key)
  loop
    if v_role_key not in (
      'villageois',
      'loup_garou',
      'voyante',
      'sorciere',
      'chasseur',
      'cupidon'
    ) then
      raise exception using
        errcode = '22023',
        message = 'Unknown role key.';
    end if;

    if pg_catalog.jsonb_typeof(p_role_counts -> v_role_key)
       <> 'number' then
      raise exception using
        errcode = '22023',
        message = 'Role counts must be integers.';
    end if;

    v_role_value := (p_role_counts ->> v_role_key)::numeric;

    if v_role_value < 0
       or v_role_value > 100
       or v_role_value <> pg_catalog.trunc(v_role_value) then
      raise exception using
        errcode = '22023',
        message = 'Role counts must be non-negative integers.';
    end if;
  end loop;

  -- Lire les effectifs demandés.
  v_villageois := coalesce(
    (p_role_counts ->> 'villageois')::integer, 0
  );
  v_loups := coalesce(
    (p_role_counts ->> 'loup_garou')::integer, 0
  );
  v_voyante := coalesce(
    (p_role_counts ->> 'voyante')::integer, 0
  );
  v_sorciere := coalesce(
    (p_role_counts ->> 'sorciere')::integer, 0
  );
  v_chasseur := coalesce(
    (p_role_counts ->> 'chasseur')::integer, 0
  );
  v_cupidon := coalesce(
    (p_role_counts ->> 'cupidon')::integer, 0
  );

  -- Les rôles spéciaux sont uniques dans cette première version.
  if v_voyante > 1
     or v_sorciere > 1
     or v_chasseur > 1
     or v_cupidon > 1 then
    raise exception using
      errcode = '22023',
      message = 'Maximum one of each special role.';
  end if;

  v_village_count :=
    v_villageois
    + v_voyante
    + v_sorciere
    + v_chasseur
    + v_cupidon;

  v_total_roles := v_village_count + v_loups;

  if v_loups < 1 or v_village_count < 1 then
    raise exception using
      errcode = '22023',
      message = 'At least one wolf and one village member are required.';
  end if;

  -- Verrouiller la partie pour éviter deux lancements simultanés.
  select g.status
  into v_game_status
  from public.games as g
  where g.id = p_game_id
    and g.master_id = p_master_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Game not found or not owned by this master.';
  end if;

  if v_game_status <> 'lobby' then
    raise exception using
      errcode = '55000',
      message = 'Game is not in lobby.';
  end if;

  -- Seuls les joueurs acceptés participent à la distribution.
  select pg_catalog.count(*)::integer
  into v_approved_count
  from public.game_players as gp
  where gp.game_id = p_game_id
    and gp.registration_status = 'approved';

  if v_approved_count < 2 then
    raise exception using
      errcode = '22023',
      message = 'At least two approved players are required.';
  end if;

  if v_total_roles <> v_approved_count then
    raise exception using
      errcode = '22023',
      message = 'Role total must match approved player count.';
  end if;

  -- Une partie en lobby ne doit pas déjà posséder de rôles distribués.
  if exists (
    select 1
    from public.player_roles as pr
    where pr.game_id = p_game_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Roles have already been assigned.';
  end if;

  -- Générer une liste aléatoire de joueurs éligibles.
  -- Générer séparément une liste aléatoire de rôles.
  -- Les deux listes sont associées par leur numéro de ligne.
  with eligible_players as (
    select
      gp.id as player_id,
      pg_catalog.row_number() over (
        order by pg_catalog.random()
      ) as row_number
    from public.game_players as gp
    where gp.game_id = p_game_id
      and gp.registration_status = 'approved'
  ),
  role_pool as (
    select
      r.role_key,
      pg_catalog.row_number() over (
        order by pg_catalog.random()
      ) as row_number
    from public.roles as r
    cross join lateral pg_catalog.generate_series(
      1,
      coalesce(
        (p_role_counts ->> r.role_key)::integer,
        0
      )
    ) as series(role_number)
  )
  insert into public.player_roles (
    game_id,
    player_id,
    role_key
  )
  select
    p_game_id,
    ep.player_id,
    rp.role_key
  from eligible_players as ep
  join role_pool as rp
    on rp.row_number = ep.row_number;

  get diagnostics v_assigned_count = row_count;

  if v_assigned_count <> v_approved_count then
    raise exception using
      errcode = '23514',
      message = 'Role assignment count mismatch.';
  end if;

  -- Activer les joueurs acceptés.
  update public.game_players
  set life_status = 'alive'
  where game_id = p_game_id
    and registration_status = 'approved';

  -- Enregistrer la phase de distribution comme terminée.
  insert into public.game_phases (
    game_id,
    phase_key,
    day_number,
    phase_number,
    status,
    metadata,
    opened_at,
    closed_at,
    resolved_at
  )
  values (
    p_game_id,
    'role_distribution',
    0,
    1,
    'resolved',
    pg_catalog.jsonb_build_object(
      'role_counts',
      p_role_counts
    ),
    v_now,
    v_now,
    v_now
  );

  -- Si Cupidon est présent, il intervient avant la première nuit.
  if v_cupidon = 1 then
    v_next_status := 'cupidon_selection';
    v_next_round := 0;
  else
    v_next_status := 'night_wolf_vote';
    v_next_round := 1;
  end if;

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
    v_next_round,
    2,
    'open',
    v_now
  );

  update public.games
  set
    status = v_next_status,
    round_number = v_next_round,
    started_at = v_now,
    config = coalesce(config, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(
        'role_counts', p_role_counts,
        'distribution_mode', 'random'
      )
  where id = p_game_id;

  -- Enregistrer l'événement de lancement.
  select coalesce(pg_catalog.max(ge.sequence_number), 0) + 1
  into v_next_event_seq
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
    'game_started',
    'master_only',
    v_next_event_seq,
    pg_catalog.jsonb_build_object(
      'role_counts', p_role_counts,
      'assigned_players', v_assigned_count,
      'next_phase', v_next_status
    )
  );

  return pg_catalog.jsonb_build_object(
    'game_id', p_game_id,
    'status', v_next_status,
    'round_number', v_next_round,
    'assigned_players', v_assigned_count
  );
end;
$$;


-- La fonction de lancement doit être appelée uniquement
-- depuis le serveur utilisant le client d'administration.
revoke all on function public.start_game(uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.start_game(uuid, uuid, jsonb)
to service_role;

commit;