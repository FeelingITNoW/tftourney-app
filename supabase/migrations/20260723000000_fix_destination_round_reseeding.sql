-- Fix graph destination reseeding when existing and newly advanced players
-- occupy overlapping seed ranges. The unique seed index is immediate, so
-- reseeding in one update can transiently collide (for example, 5 -> 1 while
-- an inserted player already has seed 5). Move the existing rows out of the
-- final range first, then assign the ranked contiguous seeds.

drop function if exists public.finalize_tournament_node(text, text);
create function public.finalize_tournament_node(p_tournament_id text, p_node_id text)
returns table (
  transition_type text,
  completed_node_id text,
  activated_node_ids text[],
  skipped_node_ids text[],
  advanced_player_count integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_node public.rounds%rowtype;
  v_config jsonb;
  v_edge record;
  v_player record;
  v_count integer;
  v_edge_advanced integer;
  v_temp_seed integer;
  v_seed_offset integer;
  v_destination public.rounds%rowtype;
  v_activated text[] := ARRAY[]::text[];
  v_skipped text[] := ARRAY[]::text[];
  v_total_advanced integer := 0;
  v_decisive integer;
  v_consumed uuid[] := ARRAY[]::uuid[];
begin
  select * into v_tournament from public.tournaments where id::text = p_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  select * into v_node from public.rounds where id::text = p_node_id and tournament_id = v_tournament.id for update;
  if not found then raise exception 'Tournament node was not found.'; end if;
  if v_node.status in ('completed', 'skipped', 'cancelled') then
    return query select 'node_already_finalized', v_node.id::text, v_activated, v_skipped, 0;
    return;
  end if;
  if v_node.status <> 'active' then raise exception 'Tournament node is not active.'; end if;

  v_config := public.graph_config_node(v_tournament.format_config, v_node.format_round_id);
  if v_config is null then raise exception 'Graph node configuration was not found.'; end if;
  if v_config -> 'winCondition' ->> 'type' = 'checkmate' then
    if (select count(*) from public.participant_round_scores where round_id = v_node.id) <> 8 then raise exception 'Checkmate nodes require exactly eight participants.'; end if;
    v_decisive := public.checkmate_decisive_game(v_node.id::text, coalesce((v_config -> 'winCondition' ->> 'threshold')::integer, 0));
    if v_decisive is null and not exists (
      select 1 from public.lobbies where round_id = v_node.id and game_number >= coalesce((v_config -> 'winCondition' ->> 'maxGames')::integer, 2147483647)
    ) then raise exception 'Checkmate has not been achieved.'; end if;
  else
    if exists (
      select 1
      from public.lobbies lobbies
      left join public.lobby_participants participants on participants.lobby_id = lobbies.id
      where lobbies.round_id = v_node.id and (participants.id is null or participants.result_status not in ('confirmed', 'corrected'))
    ) then raise exception 'Complete every lobby result before finalizing the node.'; end if;
  end if;

  for v_edge in
    select * from public.tournament_edges where source_round_id = v_node.id and status = 'pending' order by priority, id
  loop
    v_count := greatest(coalesce((v_edge.condition ->> 'count')::integer, 0), 0);
    v_edge_advanced := 0;
    select coalesce(max(round_seed_number), 0) + 1 into v_temp_seed
    from public.participant_round_scores where round_id = v_edge.destination_round_id;
    for v_player in
      with tournament_totals as (
        select scores.participant_id, sum(scores.score)::integer as tournament_points
        from public.participant_round_scores scores
        join public.rounds score_round on score_round.id = scores.round_id
        where score_round.tournament_id = v_tournament.id
        group by scores.participant_id
      ), ranked as (
        select scores.participant_id,
          row_number() over (
            order by
              case when coalesce(v_edge.condition ->> 'rankingMetric', 'points') = 'tournament_points'
                then coalesce(tournament_totals.tournament_points, 0)
                else scores.score end desc,
              scores.round_seed_number asc,
              participants.display_name_at_start asc,
              participants.id::text
          )::integer as source_rank
        from public.participant_round_scores scores
        join public.tournament_participants participants on participants.id = scores.participant_id
        left join tournament_totals on tournament_totals.participant_id = scores.participant_id
        where scores.round_id = v_node.id
      )
      select ranked.participant_id, ranked.source_rank
      from ranked
      where not (ranked.participant_id = any(v_consumed))
      order by ranked.source_rank
      limit v_count
    loop
      insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score, source_edge_id, source_rank)
      values (v_player.participant_id, v_edge.destination_round_id, v_temp_seed, 0, v_edge.id, v_player.source_rank)
      on conflict (participant_id, round_id) do update
        set source_edge_id = excluded.source_edge_id, source_rank = excluded.source_rank, score = 0, updated_at = now();
      v_consumed := array_append(v_consumed, v_player.participant_id);
      v_temp_seed := v_temp_seed + 1;
      v_edge_advanced := v_edge_advanced + 1;
      v_total_advanced := v_total_advanced + 1;
    end loop;
    update public.tournament_edges
    set status = 'resolved', advanced_player_count = v_edge_advanced, resolved_at = now(), updated_at = now()
    where id = v_edge.id;
  end loop;

  update public.rounds set status = 'completed', updated_at = now() where id = v_node.id;
  loop
    select nodes.* into v_destination
    from public.rounds nodes
    where nodes.tournament_id = v_tournament.id and nodes.status = 'pending'
      and exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id)
      and not exists (
        select 1 from public.tournament_edges edges
        where edges.destination_round_id = nodes.id and edges.status <> 'resolved'
      )
    order by nodes.round_number, nodes.id limit 1;
    exit when not found;
    if exists (select 1 from public.participant_round_scores scores where scores.round_id = v_destination.id) then
      -- Make every current seed temporarily unique and outside the final
      -- 1..N range before applying the ranked seed values.
      select coalesce(max(round_seed_number), 0)
      into v_seed_offset
      from public.participant_round_scores
      where round_id = v_destination.id;

      update public.participant_round_scores
      set round_seed_number = round_seed_number + v_seed_offset
      where round_id = v_destination.id;

      with ranked as (
        select scores.participant_id,
          row_number() over (order by scores.source_rank nulls last, scores.source_edge_id nulls last, scores.participant_id)::integer as next_seed
        from public.participant_round_scores scores where scores.round_id = v_destination.id
      )
      update public.participant_round_scores scores set round_seed_number = ranked.next_seed, updated_at = now()
      from ranked where ranked.participant_id = scores.participant_id and scores.round_id = v_destination.id;
      update public.rounds set status = 'active', updated_at = now() where id = v_destination.id;
      perform public.generate_round_lobbies(v_destination.id::text);
      v_activated := array_append(v_activated, v_destination.id::text);
    else
      update public.rounds set status = 'skipped', updated_at = now() where id = v_destination.id;
      update public.tournament_edges set status = 'resolved', updated_at = now() where source_round_id = v_destination.id and status = 'pending';
      v_skipped := array_append(v_skipped, v_destination.id::text);
    end if;
  end loop;

  if not exists (select 1 from public.rounds where tournament_id = v_tournament.id and status in ('active', 'pending')) then
    update public.tournaments set status = 'completed', updated_at = now() where id = v_tournament.id;
  end if;
  return query select case when (select status from public.tournaments where id = v_tournament.id) = 'completed' then 'tournament_completed' else 'node_finalized' end,
    v_node.id::text, v_activated, v_skipped, v_total_advanced;
end;
$$;

notify pgrst, 'reload schema';
