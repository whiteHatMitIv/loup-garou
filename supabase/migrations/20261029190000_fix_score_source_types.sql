
DO $migration$
DECLARE
  v_definition text;
BEGIN
  -- ---------------------------------------------------------
  -- 1. Corriger les types de sources du scrutin du village.
  -- ---------------------------------------------------------
  v_definition := pg_get_functiondef(
    'public.resolve_village_vote(uuid,uuid)'::regprocedure
  );

  -- Les points directement liés au scrutin utilisent "vote".
  v_definition := replace(
    v_definition,
    '''village_vote''',
    '''vote'''
  );

  -- Le bonus pour élimination d'un Loup utilise "elimination".
  v_definition := regexp_replace(
    v_definition,
    '(''Bonus pour élimination d’un Loup-Garou'',[[:space:]]*)''vote''',
    E'\\1''elimination''',
    'g'
  );

  -- Le bonus des Loups quand un innocent est éliminé.
  v_definition := regexp_replace(
    v_definition,
    '(''Le village a éliminé un innocent'',[[:space:]]*)''vote''',
    E'\\1''elimination''',
    'g'
  );

  EXECUTE v_definition;


  -- ---------------------------------------------------------
  -- 2. Corriger les points de victoire attribués en fin de nuit.
  -- ---------------------------------------------------------
  v_definition := pg_get_functiondef(
    'public.finish_night_resolution(uuid,uuid)'::regprocedure
  );

  v_definition := replace(
    v_definition,
    '''game_end''',
    '''survival'''
  );

  EXECUTE v_definition;


  -- ---------------------------------------------------------
  -- 3. Corriger les points de victoire attribués en fin de jour.
  -- ---------------------------------------------------------
  v_definition := pg_get_functiondef(
    'public.finish_day_resolution(uuid,uuid)'::regprocedure
  );

  v_definition := replace(
    v_definition,
    '''game_end''',
    '''survival'''
  );

  EXECUTE v_definition;

END;
$migration$;
