begin;

-- Notification publique et sans donnée de jeu sensible.
-- Les joueurs utilisent ensuite /api/join pour récupérer leur état autorisé.
create table public.game_phase_notifications (
  game_id uuid primary key references public.games(id) on delete cascade,
  changed_at timestamptz not null default now()
);

alter table public.game_phase_notifications enable row level security;

create policy "Game phase notifications are readable"
on public.game_phase_notifications
for select
to anon, authenticated
using (true);

grant select on table public.game_phase_notifications
to anon, authenticated;

create or replace function public.notify_game_phase_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.game_phase_notifications (game_id, changed_at)
    values (new.id, now())
    on conflict (game_id)
    do update set changed_at = excluded.changed_at;
  end if;

  return new;
end;
$$;

drop trigger if exists games_realtime_phase_notification
on public.games;

create trigger games_realtime_phase_notification
after update on public.games
for each row
execute function public.notify_game_phase_change();

alter publication supabase_realtime
add table public.game_phase_notifications;

commit;
