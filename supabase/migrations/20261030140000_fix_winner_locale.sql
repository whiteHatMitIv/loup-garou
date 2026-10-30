begin;

do $migration$
declare
  v_def text;
begin
  -- 1. finish_night_resolution : 'wolves' → 'loups'
  v_def := pg_get_functiondef(
    'public.finish_night_resolution(uuid,uuid)'::regprocedure
  );
  v_def := replace(v_def, '''wolves''', '''loups''');
  execute v_def;

  -- 2. finish_day_resolution : 'wolves' → 'loups'
  v_def := pg_get_functiondef(
    'public.finish_day_resolution(uuid,uuid)'::regprocedure
  );
  v_def := replace(v_def, '''wolves''', '''loups''');
  execute v_def;

  -- 3. Nettoyage préventif : aucune ligne ne devrait exister
  --    avec 'wolves' (le CHECK a toujours refusé), mais on
  --    sécurise au cas où une migration future aurait ouvert
  --    la porte.
  update public.games
  set winner = 'loups'
  where winner = 'wolves';
end;
$migration$;

commit;