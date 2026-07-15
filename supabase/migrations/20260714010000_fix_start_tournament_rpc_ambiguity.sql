drop function if exists public.start_tournament(uuid);
drop function if exists public.start_tournament(bigint);
drop function if exists public.start_tournament(text);

create or replace function public.start_tournament(p_tournament_id text)
returns table (
  started_tournament_id text,
  started_entrant_count integer,
  started_round_id text,
  started_round_number integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_current_round_id text;
  v_entrant_count integer;
begin
  select *
  into v_tournament
  from public.tournaments
  where id::text = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament was not found.';
  end if;

  if v_tournament.status <> 'accepting_players' then
    raise exception 'Tournament has already started.';
  end if;

  select count(*)::integer
  into v_entrant_count
  from public.tournament_players
  where tournament_players.tournament_id::text = p_tournament_id;

  if v_entrant_count = 0 then
    raise exception 'Register at least one player before starting the tournament.';
  end if;

  v_current_round_id := coalesce(
    v_tournament.format_config #>> '{rounds,0,id}',
    'opening-round'
  );

  with selected_players as (
    select
      tournament_players.id,
      coalesce(
        tournament_players.display_name,
        tournament_players.riot_puuid,
        tournament_players.id::text
      ) as display_name,
      (row_number() over (
        order by tournament_players.created_at asc, tournament_players.id asc
      ))::integer as seed_number
    from public.tournament_players
    where tournament_players.tournament_id::text = p_tournament_id
    order by tournament_players.created_at asc, tournament_players.id asc
    limit v_tournament.player_count
  ),
  inserted_entries as (
    insert into public.tournament_entries (
      tournament_id,
      tournament_player_id,
      seed_number,
      display_name
    )
    select
      v_tournament.id,
      selected_players.id,
      selected_players.seed_number,
      selected_players.display_name
    from selected_players
    on conflict (tournament_id, tournament_player_id) do update
      set display_name = excluded.display_name
    returning id
  )
  insert into public.tournament_scores (
    tournament_id,
    tournament_entry_id,
    round_id,
    score
  )
  select
    v_tournament.id,
    inserted_entries.id,
    v_current_round_id,
    0
  from inserted_entries
  on conflict (tournament_id, tournament_entry_id, round_id) do nothing;

  update public.tournaments
  set
    status = 'in_progress',
    has_started = true,
    current_round_id = v_current_round_id,
    current_round_number = 1
  where id::text = p_tournament_id;

  select count(*)::integer
  into v_entrant_count
  from public.tournament_entries
  where tournament_entries.tournament_id::text = p_tournament_id;

  return query
  select p_tournament_id, v_entrant_count, v_current_round_id, 1;
end;
$$;

notify pgrst, 'reload schema';
