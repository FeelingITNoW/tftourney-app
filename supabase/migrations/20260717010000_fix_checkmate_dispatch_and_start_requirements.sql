-- Fix NULL winCondition dispatch and enforce eight-player checkmate invariants
-- for databases that already applied the initial checkmate migration.

do $fix_checkmate_generator$
declare
  function_definition text;
begin
  select pg_get_functiondef(functions.oid)
  into function_definition
  from pg_proc functions
  join pg_namespace namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.proname = 'generate_round_lobbies'
    and pg_get_function_identity_arguments(functions.oid) = 'p_round_id text';

  if function_definition is null then
    raise exception 'The checkmate lobby generator function was not found.';
  end if;

  function_definition := replace(
    function_definition,
    'v_is_checkmate := v_config -> ''winCondition'' ->> ''type'' = ''checkmate'';',
    'v_is_checkmate := coalesce(v_config -> ''winCondition'' ->> ''type'' = ''checkmate'', false);'
  );

  execute function_definition;
end;
$fix_checkmate_generator$;

do $fix_checkmate_progression$
declare
  function_definition text;
begin
  select pg_get_functiondef(functions.oid)
  into function_definition
  from pg_proc functions
  join pg_namespace namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.proname = 'progress_tournament_round'
    and pg_get_function_identity_arguments(functions.oid) = 'p_tournament_id text';

  if function_definition is null then
    raise exception 'The checkmate progression function was not found.';
  end if;

  function_definition := replace(
    function_definition,
    'if v_config -> ''winCondition'' ->> ''type'' <> ''checkmate'' then',
    'if coalesce(v_config -> ''winCondition'' ->> ''type'', '''') <> ''checkmate'' then'
  );
  function_definition := replace(
    function_definition,
    'v_advance_count := least(coalesce((v_config -> ''advancement'' ->> ''count'')::integer, 0), v_available_count);',
    E'if (v_destination_config -> ''winCondition'' ->> ''type'') = ''checkmate'' and v_available_count <> 8 then\n'
      || E'    raise exception ''A checkmate round requires exactly eight advancing players.'';\n'
      || E'  end if;\n'
      || '  v_advance_count := least(coalesce((v_config -> ''advancement'' ->> ''count'')::integer, 0), v_available_count);'
  );

  execute function_definition;
end;
$fix_checkmate_progression$;

do $fix_checkmate_start$
declare
  function_definition text;
begin
  select pg_get_functiondef(functions.oid)
  into function_definition
  from pg_proc functions
  join pg_namespace namespaces on namespaces.oid = functions.pronamespace
  where namespaces.nspname = 'public'
    and functions.proname = 'start_tournament'
    and pg_get_function_identity_arguments(functions.oid) = 'p_tournament_id text';

  if function_definition is null then
    raise exception 'The tournament start function was not found.';
  end if;

  function_definition := replace(
    function_definition,
    E'  if v_entrant_count = 0 then\n    raise exception ''Register at least one player before starting the tournament.'';\n  end if;',
    E'  if v_entrant_count = 0 then\n    raise exception ''Register at least one player before starting the tournament.'';\n  end if;\n\n'
      || E'  if v_tournament.format_config #>> ''{rounds,0,winCondition,type}'' = ''checkmate''\n'
      || E'    and least(v_entrant_count, v_tournament.max_players) <> 8 then\n'
      || E'    raise exception ''A first-round checkmate format requires exactly eight registered entrants.'';\n'
      || E'  elsif exists (\n'
      || E'    select 1\n'
      || E'    from jsonb_array_elements(v_tournament.format_config -> ''rounds'') configured_round(value)\n'
      || E'    where configured_round.value -> ''winCondition'' ->> ''type'' = ''checkmate''\n'
      || E'  ) and least(v_entrant_count, v_tournament.max_players) < 8 then\n'
      || E'    raise exception ''A checkmate format requires at least eight registered entrants.'';\n'
      || E'  end if;'
  );

  execute function_definition;
end;
$fix_checkmate_start$;

notify pgrst, 'reload schema';
