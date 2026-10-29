
DO $migration$
DECLARE
  v_definition text;
BEGIN
  -- Corriger la résolution de la nuit.
  v_definition := pg_get_functiondef(
    'public.resolve_night(uuid,uuid)'::regprocedure
  );

  v_definition := replace(
    v_definition,
    '''wolves''',
    '''wolf_attack'''
  );

  v_definition := replace(
    v_definition,
    '''witch_poison''',
    '''witch_potion'''
  );

  v_definition := replace(
    v_definition,
    '''lover''',
    '''lover_chain'''
  );

  EXECUTE v_definition;

  -- Corriger l'élimination du partenaire amoureux
  -- pendant la résolution du vote du village.
  v_definition := pg_get_functiondef(
    'public.resolve_day_vote(uuid,uuid)'::regprocedure
  );

  v_definition := replace(
    v_definition,
    '''lover''',
    '''lover_chain'''
  );

  EXECUTE v_definition;

  -- Corriger le tir du Chasseur et l'élimination
  -- éventuelle du partenaire de sa cible.
  v_definition := pg_get_functiondef(
    'public.submit_hunter_shot(uuid,uuid,uuid)'::regprocedure
  );

  v_definition := replace(
    v_definition,
    '''hunter''',
    '''hunter_shot'''
  );

  v_definition := replace(
    v_definition,
    '''lover''',
    '''lover_chain'''
  );

  EXECUTE v_definition;
END;
$migration$;
