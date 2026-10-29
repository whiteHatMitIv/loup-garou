begin;

alter table public.deaths
  drop constraint if exists deaths_game_id_resolution_order_key;

alter table public.deaths
  add constraint deaths_game_id_phase_id_resolution_order_key
    unique (game_id, phase_id, resolution_order);

commit;