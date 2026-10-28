begin;

-- =========================================================
-- 1. FONCTION COMMUNE : MISE À JOUR DE updated_at
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;


-- =========================================================
-- 2. CATALOGUE DES RÔLES
-- =========================================================

create table public.roles (
  role_key text primary key,
  display_name text not null,
  camp text not null
    check (camp in ('village', 'loups')),
  description text not null,
  is_special boolean not null default false,
  definition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now()
);


insert into public.roles (
  role_key,
  display_name,
  camp,
  description,
  is_special
)
values
  (
    'villageois',
    'Villageois',
    'village',
    'Participe aux débats et aux votes du village.',
    false
  ),
  (
    'loup_garou',
    'Loup-Garou',
    'loups',
    'Participe au choix nocturne de la victime.',
    false
  ),
  (
    'voyante',
    'Voyante',
    'village',
    'Inspecte secrètement un joueur pendant la nuit.',
    true
  ),
  (
    'sorciere',
    'Sorcière',
    'village',
    'Possède une potion de vie et une potion de mort.',
    true
  ),
  (
    'chasseur',
    'Chasseur',
    'village',
    'Peut éliminer une cible lorsque son pouvoir est déclenché par sa mort.',
    true
  ),
  (
    'cupidon',
    'Cupidon',
    'village',
    'Désigne deux joueurs liés par un lien amoureux secret.',
    true
  )
on conflict (role_key) do nothing;


-- =========================================================
-- 3. PARTIES
-- =========================================================

create table public.games (
  id uuid primary key default gen_random_uuid(),

  master_id uuid not null
    references auth.users(id) on delete restrict,

  name text not null
    check (char_length(btrim(name)) between 1 and 80),

  invite_code text not null unique
    check (invite_code ~ '^[A-Z0-9]{6,10}$'),

  status text not null default 'lobby'
    check (
      status in (
        'lobby',
        'role_distribution',
        'cupidon_selection',
        'night_wolf_vote',
        'night_witch_action',
        'night_seer_action',
        'night_resolution',
        'day_discussion',
        'village_vote_1',
        'village_vote_2',
        'day_resolution',
        'paused',
        'game_over'
      )
    ),

  resume_status text
    check (
      resume_status is null
      or resume_status in (
        'lobby',
        'role_distribution',
        'cupidon_selection',
        'night_wolf_vote',
        'night_witch_action',
        'night_seer_action',
        'night_resolution',
        'day_discussion',
        'village_vote_1',
        'village_vote_2',
        'day_resolution'
      )
    ),

  round_number integer not null default 0
    check (round_number >= 0),

  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),

  winner text
    check (winner is null or winner in ('village', 'loups')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,

  check (
    status <> 'paused'
    or resume_status is not null
  ),

  check (
    ended_at is null
    or status = 'game_over'
  )
);


create trigger games_set_updated_at
before update on public.games
for each row
execute function public.set_updated_at();


-- =========================================================
-- 4. JOUEURS D'UNE PARTIE
-- =========================================================

create table public.game_players (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null
    references public.games(id) on delete cascade,

  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 40),

  -- Calculé côté serveur.
  -- La normalisation des accents sera gérée dans le code.
  normalized_name text not null
    check (char_length(btrim(normalized_name)) between 1 and 100),

  registration_status text not null default 'pending'
    check (
      registration_status in (
        'pending',
        'approved',
        'rejected'
      )
    ),

  life_status text not null default 'not_started'
    check (
      life_status in (
        'not_started',
        'alive',
        'dead'
      )
    ),

  -- Hash d'un jeton de session, jamais le jeton en clair.
  session_token_hash text unique,

  session_expires_at timestamptz,

  approved_by uuid
    references auth.users(id) on delete set null,

  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  left_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (game_id, normalized_name),
  unique (game_id, id),

  check (
    registration_status = 'approved'
    or life_status = 'not_started'
  )
);


create index game_players_game_status_idx
on public.game_players (game_id, registration_status, life_status);


create trigger game_players_set_updated_at
before update on public.game_players
for each row
execute function public.set_updated_at();


-- =========================================================
-- 5. ATTRIBUTION DES RÔLES
-- =========================================================

create table public.player_roles (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null,
  player_id uuid not null,

  role_key text not null
    references public.roles(role_key) on delete restrict,

  is_revealed boolean not null default false,
  assigned_at timestamptz not null default now(),

  unique (game_id, player_id),
  unique (game_id, id),

  foreign key (game_id, player_id)
    references public.game_players(game_id, id)
    on delete cascade
);


create index player_roles_role_idx
on public.player_roles (game_id, role_key);


-- =========================================================
-- 6. LIEN AMOUREUX DE CUPIDON
-- =========================================================

create table public.lover_links (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null,

  player_a_id uuid not null,
  player_b_id uuid not null,
  created_by_player_id uuid not null,

  created_at timestamptz not null default now(),

  check (player_a_id <> player_b_id),

  -- Une paire d'amoureux par partie.
  unique (game_id),

  foreign key (game_id, player_a_id)
    references public.game_players(game_id, id)
    on delete cascade,

  foreign key (game_id, player_b_id)
    references public.game_players(game_id, id)
    on delete cascade,

  foreign key (game_id, created_by_player_id)
    references public.game_players(game_id, id)
    on delete restrict
);


-- =========================================================
-- 7. PHASES DE JEU
-- =========================================================

create table public.game_phases (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null
    references public.games(id) on delete cascade,

  phase_key text not null
    check (
      phase_key in (
        'role_distribution',
        'cupidon_selection',
        'night_wolf_vote',
        'night_witch_action',
        'night_seer_action',
        'night_resolution',
        'day_discussion',
        'village_vote_1',
        'village_vote_2',
        'day_resolution'
      )
    ),

  day_number integer not null default 0
    check (day_number >= 0),

  phase_number integer not null
    check (phase_number > 0),

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'open',
        'closed',
        'resolved'
      )
    ),

  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),

  opened_at timestamptz,
  closed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  unique (game_id, phase_number),
  unique (game_id, id)
);


create index game_phases_current_idx
on public.game_phases (game_id, phase_number desc);


-- =========================================================
-- 8. VOTES
-- =========================================================

create table public.votes (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null,
  phase_id uuid not null,

  voter_player_id uuid not null,
  target_player_id uuid,

  vote_kind text not null
    check (vote_kind in ('village', 'wolves')),

  -- Une cible NULL représente un non-vote enregistré.
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (phase_id, voter_player_id),

  foreign key (game_id, phase_id)
    references public.game_phases(game_id, id)
    on delete cascade,

  foreign key (game_id, voter_player_id)
    references public.game_players(game_id, id)
    on delete cascade,

  foreign key (game_id, target_player_id)
    references public.game_players(game_id, id)
    on delete restrict,

  check (
    target_player_id is null
    or target_player_id <> voter_player_id
  )
);


create index votes_result_idx
on public.votes (phase_id, target_player_id);


create trigger votes_set_updated_at
before update on public.votes
for each row
execute function public.set_updated_at();


-- =========================================================
-- 9. ACTIONS DES RÔLES
-- =========================================================

create table public.role_actions (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null,
  phase_id uuid not null,

  actor_player_id uuid not null,
  target_player_id uuid,

  action_type text not null
    check (
      action_type in (
        'cupidon_link',
        'witch_save',
        'witch_kill',
        'seer_inspect',
        'hunter_shot'
      )
    ),

  status text not null default 'submitted'
    check (
      status in (
        'submitted',
        'confirmed',
        'resolved',
        'cancelled'
      )
    ),

  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),

  -- Identifiant fourni par le serveur pour éviter les doublons.
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,

  unique (game_id, idempotency_key),

  foreign key (game_id, phase_id)
    references public.game_phases(game_id, id)
    on delete cascade,

  foreign key (game_id, actor_player_id)
    references public.game_players(game_id, id)
    on delete restrict,

  foreign key (game_id, target_player_id)
    references public.game_players(game_id, id)
    on delete restrict
);


create index role_actions_pending_idx
on public.role_actions (game_id, phase_id, status);


create trigger role_actions_set_updated_at
before update on public.role_actions
for each row
execute function public.set_updated_at();


-- =========================================================
-- 10. ÉLIMINATIONS
-- =========================================================

create table public.deaths (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null,
  phase_id uuid not null,

  player_id uuid not null,
  caused_by_player_id uuid,

  death_cause text not null
    check (
      death_cause in (
        'village_vote',
        'wolf_attack',
        'witch_potion',
        'hunter_shot',
        'lover_chain',
        'other'
      )
    ),

  resolution_order integer not null
    check (resolution_order > 0),

  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),

  created_at timestamptz not null default now(),

  -- Un joueur ne meurt qu'une fois par partie.
  unique (game_id, player_id),
  unique (game_id, resolution_order),

  foreign key (game_id, phase_id)
    references public.game_phases(game_id, id)
    on delete restrict,

  foreign key (game_id, player_id)
    references public.game_players(game_id, id)
    on delete restrict,

  foreign key (game_id, caused_by_player_id)
    references public.game_players(game_id, id)
    on delete restrict
);


create index deaths_game_idx
on public.deaths (game_id, resolution_order);


-- =========================================================
-- 11. ÉVÉNEMENTS DE SCORE
-- =========================================================

create table public.score_events (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null,
  player_id uuid not null,

  points integer not null
    check (points > 0),

  reason text not null,

  source_type text not null
    check (
      source_type in (
        'vote',
        'elimination',
        'survival',
        'role_action'
      )
    ),

  source_id uuid,

  -- Clé unique pour empêcher une attribution en double.
  idempotency_key text not null,

  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),

  created_at timestamptz not null default now(),

  unique (game_id, idempotency_key),

  foreign key (game_id, player_id)
    references public.game_players(game_id, id)
    on delete restrict
);


create index score_events_player_idx
on public.score_events (game_id, player_id, created_at);


-- =========================================================
-- 12. JOURNAL DES ÉVÉNEMENTS
-- =========================================================

create table public.game_events (
  id uuid primary key default gen_random_uuid(),

  game_id uuid not null
    references public.games(id) on delete cascade,

  actor_user_id uuid
    references auth.users(id) on delete set null,

  actor_player_id uuid,

  event_type text not null,

  visibility text not null default 'master_only'
    check (
      visibility in (
        'public',
        'players',
        'master_only'
      )
    ),

  sequence_number bigint not null
    check (sequence_number > 0),

  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),

  created_at timestamptz not null default now(),

  unique (game_id, sequence_number),

  foreign key (game_id, actor_player_id)
    references public.game_players(game_id, id)
    on delete restrict
);


create index game_events_history_idx
on public.game_events (game_id, sequence_number);


-- =========================================================
-- 13. SÉCURITÉ : ROW LEVEL SECURITY
-- =========================================================

alter table public.roles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.player_roles enable row level security;
alter table public.lover_links enable row level security;
alter table public.game_phases enable row level security;
alter table public.votes enable row level security;
alter table public.role_actions enable row level security;
alter table public.deaths enable row level security;
alter table public.score_events enable row level security;
alter table public.game_events enable row level security;


-- Le catalogue public des rôles ne contient pas les attributions
-- secrètes des joueurs.

create policy "Role catalog is readable"
on public.roles
for select
to anon, authenticated
using (true);


-- Les données de jeu ne sont pas directement accessibles aux
-- clients anon ou authenticated.
-- Les opérations passeront par le serveur, qui vérifiera
-- l'identité et les autorisations avant chaque action.

revoke all on table
  public.games,
  public.game_players,
  public.player_roles,
  public.lover_links,
  public.game_phases,
  public.votes,
  public.role_actions,
  public.deaths,
  public.score_events,
  public.game_events
from anon, authenticated;


revoke insert, update, delete, truncate, references, trigger
on table public.roles
from anon, authenticated;


grant select on table public.roles
to anon, authenticated;


commit;