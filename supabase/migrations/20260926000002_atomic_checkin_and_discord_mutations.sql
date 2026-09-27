-- Four host actions used to be several sequential PostgREST writes each,
-- with no transaction tying them together: a crash or a request abort
-- between steps could leave check-in open with the roster reset but the
-- outbox event never queued, a tournament stuck "waitlisted" after a failed
-- start, or a Discord disconnect that cleared the config but not check-in.
-- start_tournament already demonstrated the right shape for this (one
-- plpgsql function, one transaction); this migration gives the other three
-- host mutations (open/close check-in, set one registration's check-in,
-- disconnect Discord) the same shape, and folds the separate
-- prepareTournamentStartRoster/restoreTournamentStartRoster round trip pair
-- into start_tournament itself so a failed start can never need a
-- compensating restore -- the whole attempt (including the check-in-based
-- roster narrowing) rolls back together.
--
-- None of these take a host id: authorization stays the caller's
-- responsibility via requireTournamentHost, exactly as it already is for
-- start_tournament and submit_lobby_results. This migration also fixes two
-- more instances of the id::text-cast pattern documented in
-- 20260926000000_fix_ambiguous_id_casts_and_lobby_overfetch.sql --
-- start_tournament's own tournament lookup, and enqueue_discord_outbox's
-- hardcoded `p_tournament_id::uuid` (which would have raised on every call
-- had the live column actually been bigint).

create or replace function public.enqueue_discord_outbox(
  p_tournament_id text,
  p_event_type text,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb
)
returns table(outbox_id bigint, was_created boolean)
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_id bigint;
begin
  v_tournament_id := p_tournament_id;
  insert into public.discord_outbox(tournament_id, event_type, dedupe_key, payload)
  values (v_tournament_id, p_event_type, p_dedupe_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (tournament_id, dedupe_key) do update
    set payload = excluded.payload,
        state = case when public.discord_outbox.state = 'completed' then public.discord_outbox.state else 'pending' end,
        available_at = now(),
        updated_at = now()
  returning id into v_id;
  return query select v_id, true;
end;
$$;

create or replace function public.open_tournament_check_in(p_tournament_id text)
returns table(reopened boolean)
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_tournament public.tournaments%rowtype;
  v_reopened boolean;
begin
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    raise exception 'Tournament was not found.';
  end;
  select * into v_tournament from public.tournaments where id = v_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;

  if not exists (
    select 1 from public.tournament_discord_configs configs
    where configs.tournament_id = v_tournament.id and configs.state <> 'disabled'
  ) then
    raise exception 'Connect this tournament to Discord before opening check-in.';
  end if;
  if v_tournament.check_in_status = 'open' then raise exception 'Check-in is already open.'; end if;
  -- Reopening after a close preserves existing check-ins instead of wiping
  -- them -- only the very first open resets the roster.
  v_reopened := v_tournament.check_in_status = 'closed';

  if v_reopened then
    update public.tournaments
    set check_in_status = 'open', check_in_closed_at = null, updated_at = now()
    where id = v_tournament.id;
  else
    update public.tournaments
    set check_in_status = 'open', check_in_opened_at = now(), check_in_closed_at = null, updated_at = now()
    where id = v_tournament.id;
    update public.tournament_registrations
    set checked_in_at = null, updated_at = now()
    where tournament_id = v_tournament.id and registration_status in ('registered', 'waitlisted');
  end if;

  perform public.enqueue_discord_outbox(
    v_tournament.id::text, 'checkin_opened',
    'checkin:opened:' || (extract(epoch from now()) * 1000)::bigint::text
  );
  return query select v_reopened;
end;
$$;

create or replace function public.close_tournament_check_in(p_tournament_id text)
returns void
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_tournament public.tournaments%rowtype;
begin
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    raise exception 'Tournament was not found.';
  end;
  select * into v_tournament from public.tournaments where id = v_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  if v_tournament.check_in_status <> 'open' then raise exception 'Check-in is not open.'; end if;

  update public.tournaments
  set check_in_status = 'closed', check_in_closed_at = now(), updated_at = now()
  where id = v_tournament.id;

  perform public.enqueue_discord_outbox(
    v_tournament.id::text, 'checkin_closed',
    'checkin:closed:' || (extract(epoch from now()) * 1000)::bigint::text
  );
end;
$$;

create or replace function public.set_registration_check_in(
  p_tournament_id text,
  p_registration_id text,
  p_checked_in boolean
)
returns void
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_registration_id public.tournament_registrations.id%type;
  v_tournament public.tournaments%rowtype;
  v_updated_id public.tournament_registrations.id%type;
begin
  -- A malformed tournament id behaves like "not connected", matching the
  -- original getTournamentDiscordConfig(tournamentId) call, which never
  -- checked whether the tournament itself existed either -- both a bad id
  -- and an unconnected tournament produced this same message.
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    raise exception 'Connect this tournament to Discord before using check-in.';
  end;
  begin
    v_registration_id := p_registration_id;
  exception when invalid_text_representation then
    raise exception 'Registration was not found.';
  end;

  select * into v_tournament from public.tournaments where id = v_tournament_id;
  if not found then raise exception 'Connect this tournament to Discord before using check-in.'; end if;
  if not exists (
    select 1 from public.tournament_discord_configs configs
    where configs.tournament_id = v_tournament.id and configs.state <> 'disabled'
  ) then
    raise exception 'Connect this tournament to Discord before using check-in.';
  end if;
  if v_tournament.check_in_status = 'not_started' then
    raise exception 'Open check-in before checking players in.';
  end if;

  update public.tournament_registrations
  set checked_in_at = case when p_checked_in then now() else null end, updated_at = now()
  where id = v_registration_id
    and tournament_id = v_tournament.id
    and registration_status in ('registered', 'waitlisted')
  returning id into v_updated_id;
  if v_updated_id is null then raise exception 'Registration was not found.'; end if;
end;
$$;

create or replace function public.disconnect_tournament_discord(
  p_tournament_id text,
  p_cleanup_action text
)
returns void
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
begin
  if p_cleanup_action not in ('archive', 'delete') then
    raise exception 'Choose whether to archive or delete the Discord channels.';
  end if;
  -- Matches the original: a nonexistent tournament id (malformed or not) was
  -- never explicitly checked here either, since requireTournamentHost
  -- already redirects away before this ever runs for one. Each update below
  -- simply affects zero rows in that case, same as before.
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    return;
  end;

  -- Soft-disable rather than delete the row: it keeps the provisioned
  -- channel/role/panel IDs so reconnecting to the same server reuses them
  -- instead of creating duplicates (see bot/index.ts ensureChannel/ensureRole).
  -- state = 'disabled' is already the sentinel the bot's reconcile route
  -- excludes, so it stops provisioning this tournament from the next poll
  -- onward; cleanup_action/cleanup_requested_at instead queue the one-time
  -- archive-or-delete request the bot picks up from
  -- /api/internal/discord/cleanup (see that route and bot/index.ts runCleanup).
  update public.tournament_discord_configs
  set state = 'disabled', last_error = null, cleanup_action = p_cleanup_action,
      cleanup_requested_at = now(), cleanup_completed_at = null, updated_at = now()
  where tournament_id = v_tournament_id;

  update public.tournaments
  set check_in_status = 'not_started', check_in_opened_at = null, check_in_closed_at = null, updated_at = now()
  where id = v_tournament_id;

  update public.tournament_registrations
  set checked_in_at = null, updated_at = now()
  where tournament_id = v_tournament_id and registration_status in ('registered', 'waitlisted');
end;
$$;

drop function if exists public.start_tournament(text, jsonb);
create function public.start_tournament(
  p_tournament_id text,
  p_initial_assignments jsonb default '[]'::jsonb
)
returns table (
  started_tournament_id text,
  started_entrant_count integer,
  started_round_id text,
  started_round_number integer
)
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_tournament public.tournaments%rowtype;
  v_config jsonb;
  v_graph boolean;
  v_entrant_count integer;
  v_first_round public.rounds%rowtype;
  v_root_count integer;
begin
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    raise exception 'Tournament was not found.';
  end;
  select * into v_tournament
  from public.tournaments
  where id = v_tournament_id
  for update;

  if not found then raise exception 'Tournament was not found.'; end if;
  v_config := v_tournament.format_config;
  v_graph := jsonb_typeof(v_config -> 'nodes') = 'array'
    and jsonb_typeof(v_config -> 'edges') = 'array';

  if not v_graph then
    return query select * from public.start_linear_tournament(p_tournament_id);
    return;
  end if;
  if v_tournament.status <> 'accepting_players' then raise exception 'Tournament has already started.'; end if;

  -- Check-in is optional: with no Discord config, or check-in never opened,
  -- every registered player enters as before (the roster selection below
  -- doesn't filter on checked_in_at at all). Only once the host has used
  -- check-in does it narrow the roster -- and starting while it's still
  -- open closes it first, in this same transaction, so a failure anywhere
  -- below (e.g. an entrant-count mismatch) rolls the narrowing back too
  -- instead of leaving players waitlisted with no compensating step run.
  if v_tournament.check_in_status <> 'not_started' and exists (
    select 1 from public.tournament_discord_configs configs
    where configs.tournament_id = v_tournament.id and configs.state <> 'disabled'
  ) then
    if v_tournament.check_in_status = 'open' then
      update public.tournaments
      set check_in_status = 'closed', check_in_closed_at = now(), updated_at = now()
      where id = v_tournament.id;
    end if;
    update public.tournament_registrations
    set registration_status = 'waitlisted', updated_at = now()
    where tournament_id = v_tournament.id
      and registration_status = 'registered'
      and checked_in_at is null;
  end if;

  select count(*)::integer into v_entrant_count
  from public.tournament_registrations registrations
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered';
  if v_entrant_count = 0 then raise exception 'Register at least one player before starting the tournament.'; end if;
  if v_config -> 'startRequirement' ->> 'exactEntrants' ~ '^\d+$'
    and v_entrant_count <> (v_config -> 'startRequirement' ->> 'exactEntrants')::integer then
    raise exception 'This graph requires exactly % entrants.', v_config -> 'startRequirement' ->> 'exactEntrants';
  end if;
  if v_config -> 'startRequirement' ->> 'minimumEntrants' ~ '^\d+$'
    and v_entrant_count < (v_config -> 'startRequirement' ->> 'minimumEntrants')::integer then
    raise exception 'Register at least % players before starting the tournament.', v_config -> 'startRequirement' ->> 'minimumEntrants';
  end if;
  if jsonb_typeof(coalesce(p_initial_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Initial node assignments must be an array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    join public.tournament_registrations registrations
      on registrations.id::text = assignment.value ->> 'registrationId'
     and registrations.tournament_id = v_tournament.id
    where assignment.value ->> 'nodeId' is null
  ) then raise exception 'Every initial assignment needs a node.'; end if;
  if (
    select count(*) from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
  ) <> (
    select count(distinct assignment.value ->> 'registrationId') from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
  ) then raise exception 'A registration may only be assigned to one entry node.'; end if;

  insert into public.tournament_participants (tournament_id, registration_id, seed_number, display_name_at_start)
  select v_tournament.id, registrations.id,
    row_number() over (order by registrations.created_at, registrations.id)::integer,
    registrations.display_name
  from public.tournament_registrations registrations
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered'
  order by registrations.created_at, registrations.id
  limit v_tournament.max_players
  on conflict (tournament_id, registration_id) do nothing;

  update public.tournament_registrations registrations
  set registration_status = case when exists (
    select 1 from public.tournament_participants participants
    where participants.registration_id = registrations.id
      and participants.tournament_id = v_tournament.id
  ) then 'entered' else 'waitlisted' end
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered';

  insert into public.rounds (tournament_id, round_number, format_round_id, stage_name, node_depth, status)
  select v_tournament.id, row_number() over (order by nodes.ordinality)::integer,
    nodes.value ->> 'id', nodes.value ->> 'name', nodes.ordinality::integer, 'pending'
  from jsonb_array_elements(v_config -> 'nodes') with ordinality nodes(value, ordinality)
  on conflict (tournament_id, format_round_id) do update
    set stage_name = excluded.stage_name, node_depth = excluded.node_depth;

  insert into public.tournament_edges (
    tournament_id, format_edge_id, source_round_id, destination_round_id, priority, condition
  )
  select v_tournament.id, edges.edge_id, source_round.id, destination_round.id,
    edges.priority, coalesce(edges.condition, '{}'::jsonb)
  from public.graph_config_edges(v_config) edges
  join public.rounds source_round
    on source_round.tournament_id = v_tournament.id and source_round.format_round_id = edges.source_node_id
  join public.rounds destination_round
    on destination_round.tournament_id = v_tournament.id and destination_round.format_round_id = edges.destination_node_id
  on conflict (tournament_id, format_edge_id) do update
    set source_round_id = excluded.source_round_id,
        destination_round_id = excluded.destination_round_id,
        priority = excluded.priority,
        condition = excluded.condition,
        status = 'pending', advanced_player_count = 0, resolved_at = null;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    where not exists (
      select 1 from public.tournament_participants participants
      where participants.tournament_id = v_tournament.id
        and participants.registration_id::text = assignment.value ->> 'registrationId'
    )
    or not exists (
      select 1 from public.rounds roots
      where roots.tournament_id = v_tournament.id
        and roots.format_round_id = assignment.value ->> 'nodeId'
        and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = roots.id)
    )
  ) then raise exception 'Initial assignments must reference selected registrations and entry nodes.'; end if;

  select count(*)::integer into v_root_count
  from public.rounds nodes
  where nodes.tournament_id = v_tournament.id
    and not exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id);

  -- A numeric initialEntrantSlots value is a hard capacity. "all" means all
  -- entrants for a single root, or an even share when several roots exist.
  if (
    select coalesce(sum(root_capacity), 0)
    from (
      select case
        when (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots') ~ '^\d+$'
          then (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots')::integer
        else greatest(1, ceil(v_entrant_count::numeric / greatest(v_root_count, 1)))::integer
      end as root_capacity
      from public.rounds roots
      where roots.tournament_id = v_tournament.id
        and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = roots.id)
    ) capacities
  ) < v_entrant_count then
    raise exception 'Entry node capacities do not fit all registered players.';
  end if;

  if exists (
    select 1
    from (
      select assignment.value ->> 'nodeId' as node_id, count(*)::integer as assigned_count
      from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
      group by assignment.value ->> 'nodeId'
    ) assigned
    join public.rounds roots
      on roots.tournament_id = v_tournament.id and roots.format_round_id = assigned.node_id
    where assigned.assigned_count > case
      when (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots') ~ '^\d+$'
        then (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots')::integer
      else greatest(1, ceil(v_entrant_count::numeric / greatest(v_root_count, 1)))::integer
    end
  ) then raise exception 'Initial assignments exceed an entry node capacity.'; end if;

  insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score)
  with roots as (
    select nodes.id, nodes.format_round_id,
      row_number() over (order by nodes.id)::integer as root_number,
      case
        when (public.graph_config_node(v_config, nodes.format_round_id) ->> 'initialEntrantSlots') ~ '^\d+$'
          then (public.graph_config_node(v_config, nodes.format_round_id) ->> 'initialEntrantSlots')::integer
        else greatest(1, ceil(v_entrant_count::numeric / greatest(v_root_count, 1)))::integer
      end as capacity
    from public.rounds nodes
    where nodes.tournament_id = v_tournament.id
      and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = nodes.id)
  ), explicit as (
    select participants.id, roots.id as round_id
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    join public.tournament_participants participants
      on participants.registration_id::text = assignment.value ->> 'registrationId'
     and participants.tournament_id = v_tournament.id
    join roots on roots.format_round_id = assignment.value ->> 'nodeId'
  ), root_usage as (
    select roots.id, roots.root_number, roots.capacity, count(explicit.id)::integer as explicit_count
    from roots left join explicit on explicit.round_id = roots.id
    group by roots.id, roots.root_number, roots.capacity
  ), open_slots as (
    select usage.id as round_id,
      row_number() over (order by usage.root_number, slots.slot_number)::integer as slot_number
    from root_usage usage
    cross join lateral generate_series(usage.explicit_count + 1, usage.capacity) slots(slot_number)
  ), entrants as (
    select participants.id,
      row_number() over (order by random())::integer as random_number
    from public.tournament_participants participants
    where participants.tournament_id = v_tournament.id
      and not exists (select 1 from explicit where explicit.id = participants.id)
  ), assigned as (
    select explicit.id, explicit.round_id from explicit
    union all
    select entrants.id, open_slots.round_id
    from entrants join open_slots on open_slots.slot_number = entrants.random_number
  )
  select assigned.id, assigned.round_id,
    row_number() over (partition by assigned.round_id order by random())::integer, 0
  from assigned
  on conflict (participant_id, round_id) do nothing;

  update public.rounds nodes
  set status = case when exists (
      select 1 from public.participant_round_scores scores where scores.round_id = nodes.id
    ) then 'active' else 'skipped' end, updated_at = now()
  where nodes.tournament_id = v_tournament.id
    and not exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id);
  update public.tournament_edges edges
  set status = 'resolved', resolved_at = now(), updated_at = now()
  where edges.source_round_id in (
    select nodes.id from public.rounds nodes
    where nodes.tournament_id = v_tournament.id and nodes.status = 'skipped'
  );

  for v_first_round in
    select nodes.* from public.rounds nodes
    where nodes.tournament_id = v_tournament.id and nodes.status = 'active'
    order by nodes.round_number, nodes.id
  loop
    perform public.generate_round_lobbies(v_first_round.id::text);
  end loop;
  select nodes.* into v_first_round
  from public.rounds nodes
  where nodes.tournament_id = v_tournament.id and nodes.status = 'active'
  order by nodes.round_number, nodes.id limit 1;
  update public.tournaments
  set status = 'in_progress', started_at = coalesce(started_at, now()), current_round_id = v_first_round.id, updated_at = now()
  where id = v_tournament.id;
  select count(*)::integer into v_entrant_count
  from public.tournament_participants participants where participants.tournament_id = v_tournament.id;
  return query select v_tournament.id::text, v_entrant_count, v_first_round.id::text, v_first_round.round_number;
end;
$$;

revoke execute on function public.open_tournament_check_in(text) from public, anon, authenticated;
revoke execute on function public.close_tournament_check_in(text) from public, anon, authenticated;
revoke execute on function public.set_registration_check_in(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.disconnect_tournament_discord(text, text) from public, anon, authenticated;
grant execute on function public.open_tournament_check_in(text) to service_role;
grant execute on function public.close_tournament_check_in(text) to service_role;
grant execute on function public.set_registration_check_in(text, text, boolean) to service_role;
grant execute on function public.disconnect_tournament_discord(text, text) to service_role;

-- start_tournament was never revoked from anon/authenticated in any earlier
-- migration -- unlike every other mutating RPC in this schema. That gap let
-- anyone with just the public anon key start any tournament directly,
-- bypassing requireTournamentHost entirely. Found while auditing grants for
-- this migration's own new functions; the drop+create just above already
-- discards whatever grants existed on the old function object, so this is
-- also the only way to reinstate any grant on it at all.
revoke execute on function public.start_tournament(text, jsonb) from public, anon, authenticated;
grant execute on function public.start_tournament(text, jsonb) to service_role;

notify pgrst, 'reload schema';
