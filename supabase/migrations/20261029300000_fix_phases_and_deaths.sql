begin;

-- 1. deaths : unicité par phase (idempotent via DO block)
do $$
begin
  -- Supprimer l'ancienne contrainte globale si elle existe
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.deaths'::regclass
      and conname = 'deaths_game_id_resolution_order_key'
  ) then
    alter table public.deaths
      drop constraint deaths_game_id_resolution_order_key;
  end if;

  -- Supprimer la contrainte per-phase si déjà présente
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.deaths'::regclass
      and conname = 'deaths_game_id_phase_id_resolution_order_key'
  ) then
    alter table public.deaths
      drop constraint deaths_game_id_phase_id_resolution_order_key;
  end if;

  -- Recréer proprement
  alter table public.deaths
    add constraint deaths_game_id_phase_id_resolution_order_key
      unique (game_id, phase_id, resolution_order);
end $$;

-- 2. game_phases.phase_key : autoriser hunter_action
alter table public.game_phases
  drop constraint if exists game_phases_phase_key_check;
alter table public.game_phases
  add constraint game_phases_phase_key_check
    check (phase_key in (
      'role_distribution','cupidon_selection',
      'night_wolf_vote','night_witch_action','night_seer_action',
      'night_resolution','hunter_action',
      'day_discussion','village_vote_1','village_vote_2','day_resolution'
    ));

-- 3. games.status : autoriser hunter_action
alter table public.games
  drop constraint if exists games_status_check;
alter table public.games
  add constraint games_status_check
    check (status in (
      'lobby','role_distribution','cupidon_selection',
      'night_wolf_vote','night_witch_action','night_seer_action',
      'night_resolution','hunter_action',
      'day_discussion','village_vote_1','village_vote_2',
      'day_resolution','paused','game_over'
    ));

-- 4. games.resume_status : autoriser hunter_action
alter table public.games
  drop constraint if exists games_resume_status_check;
alter table public.games
  add constraint games_resume_status_check
    check (
      resume_status is null
      or resume_status in (
        'lobby','role_distribution','cupidon_selection',
        'night_wolf_vote','night_witch_action','night_seer_action',
        'night_resolution','hunter_action',
        'day_discussion','village_vote_1','village_vote_2','day_resolution'
      )
    );

commit;