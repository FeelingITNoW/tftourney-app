-- The live column type of tournaments/rounds/lobbies ids (bigint vs uuid) is
-- unresolved -- docs/database-schema.md and the migration chain disagree, and
-- neither can be trusted alone (see that file's header comment). Every
-- function below was written or patched here to stay correct under EITHER
-- type: text parameters are converted once, by assignment, into a local
-- declared with `%type` off the real column, inside a small block that
-- catches `invalid_text_representation` and treats a malformed id as "not
-- found" (matching how a well-typed but nonexistent id already behaves).
-- Comparisons then use that native-typed local directly instead of casting
-- the indexed column to text, so the planner can use
-- lobbies(round_id, game_number, lobby_number) and the other indexes listed
-- in docs/database-schema.md instead of scanning every row in the table.
--
-- This migration only changes how these functions look up rows; it does not
-- change what they return, except for get_tournament_page_view_model's
-- lobbies panel (see the comment above `progress_lobbies` below).

create or replace function public.get_tournament_page_view_model(
  p_tournament_id text,
  p_view text default 'lobbies',
  p_selected_node_id text default null,
  p_game_number integer default null,
  p_lobby_page integer default 1,
  p_lobby_page_size integer default 8,
  p_host_user_id bigint default null
)
returns table(view_model jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_tournament public.tournaments%rowtype;
  v_view text := case when p_view in ('lobbies', 'scoresheet', 'graph', 'details') then p_view else 'lobbies' end;
  v_selected_round_id public.rounds.id%type;
  v_round_id public.rounds.id%type;
  v_round_entrant_count integer;
  v_game integer;
  v_page integer := greatest(coalesce(p_lobby_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_lobby_page_size, 8), 1), 8);
  v_total_count integer := 0;
  v_total_pages integer := 1;
  v_json jsonb;
begin
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    return;
  end;
  select * into v_tournament from public.tournaments
  where id = v_tournament_id limit 1;
  if not found then return; end if;
  if v_tournament.status = 'accepting_players' and v_view = 'lobbies' then
    v_view := 'details';
  end if;

  begin
    v_selected_round_id := nullif(p_selected_node_id, '');
  exception when invalid_text_representation then
    v_selected_round_id := null;
  end;

  select coalesce(
    v_selected_round_id,
    (select id from public.rounds where tournament_id = v_tournament.id and status = 'active' order by round_number, id limit 1),
    v_tournament.current_round_id,
    (select id from public.rounds where tournament_id = v_tournament.id order by round_number, id limit 1)
  ) into v_round_id;
  if v_round_id is not null and not exists (
    select 1 from public.rounds where tournament_id = v_tournament.id and id = v_round_id
  ) then
    select coalesce(
      (select id from public.rounds where tournament_id = v_tournament.id and status = 'active' order by round_number, id limit 1),
      v_tournament.current_round_id,
      (select id from public.rounds where tournament_id = v_tournament.id order by round_number, id limit 1)) into v_round_id;
  end if;

  select coalesce(
    p_game_number,
    (select min(game_number) from public.lobbies where round_id = v_round_id),
    1
  ) into v_game;
  if not exists (select 1 from public.lobbies where round_id = v_round_id and game_number = v_game) then
    select coalesce(min(game_number), 1) into v_game
    from public.lobbies where round_id = v_round_id;
  end if;

  select count(*)::integer into v_total_count
  from public.lobbies
  where round_id = v_round_id and game_number = v_game;
  v_total_pages := greatest(1, ceil(v_total_count::numeric / v_page_size)::integer);
  if v_page > v_total_pages then v_page := v_total_pages; end if;

  select count(*)::integer into v_round_entrant_count
  from public.participant_round_scores scores where scores.round_id = v_round_id;

  v_json := jsonb_build_object(
    'view', v_view,
    'tournament', jsonb_build_object(
      'id', v_tournament.id::text,
      'host_user_id', v_tournament.host_user_id::text,
      'name', v_tournament.name,
      'max_players', v_tournament.max_players,
      'format_id', v_tournament.format_id,
      'status', v_tournament.status,
      'has_started', v_tournament.status <> 'accepting_players',
      'current_round_id', v_tournament.current_round_id::text,
      'created_at', v_tournament.created_at,
      'format_config', v_tournament.format_config
    ),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', rounds.id::text, 'tournament_id', rounds.tournament_id::text,
      'round_number', rounds.round_number, 'format_round_id', rounds.format_round_id,
      'stage_name', rounds.stage_name, 'status', rounds.status
    ) order by rounds.round_number, rounds.id) from public.rounds rounds where rounds.tournament_id = v_tournament.id), '[]'::jsonb),
    'active_node_ids', coalesce((select jsonb_agg(rounds.id::text order by rounds.round_number, rounds.id) from public.rounds rounds where rounds.tournament_id = v_tournament.id and rounds.status = 'active'), '[]'::jsonb),
    'selected_node_id', v_round_id::text,
    'sheet_status', case when p_host_user_id is not null and p_host_user_id = v_tournament.host_user_id then (
      select jsonb_build_object(
        'tournament_id', v_tournament.id::text,
        'connection_state', coalesce((select connections.status from public.organizer_google_connections connections where connections.user_id = p_host_user_id limit 1), 'disconnected'),
        'state', coalesce((select exports.state from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1), 'not_created'),
        'spreadsheet_id', (select exports.spreadsheet_id from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1),
        'spreadsheet_url', (select exports.spreadsheet_url from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1),
        'desired_revision', coalesce((select exports.desired_revision from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1), 0),
        'synced_revision', coalesce((select exports.synced_revision from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1), 0),
        'dirty_at', (select exports.dirty_at from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1),
        'last_synced_at', (select exports.last_synced_at from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1),
        'next_attempt_at', (select exports.next_attempt_at from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1),
        'last_error', (select case when exports.last_error_code is null and exports.last_error_message is null then null else jsonb_build_object('code', coalesce(exports.last_error_code, 'SHEET_EXPORT_ERROR'), 'message', coalesce(exports.last_error_message, 'Sheet export failed.')) end from public.tournament_sheet_exports exports where exports.tournament_id = v_tournament.id limit 1)
      )
    ) else null end
  );

  if v_view = 'details' then
    v_json := v_json || jsonb_build_object(
      'registrations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', registrations.id::text, 'display_name', coalesce(registrations.display_name, registrations.riot_puuid, 'Unknown player'),
        'registration_status', registrations.registration_status, 'created_at', registrations.created_at
      ) order by registrations.created_at, registrations.id) from public.tournament_registrations registrations where registrations.tournament_id = v_tournament.id), '[]'::jsonb),
      'participants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', participants.id::text, 'registration_id', participants.registration_id::text,
        'seed_number', participants.seed_number, 'display_name_at_start', participants.display_name_at_start, 'created_at', participants.created_at
      ) order by participants.seed_number, participants.id) from public.tournament_participants participants where participants.tournament_id = v_tournament.id), '[]'::jsonb)
    );
  elsif v_view = 'graph' then
    v_json := v_json || jsonb_build_object(
      'nodes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rounds.id::text, 'round_number', rounds.round_number, 'format_round_id', rounds.format_round_id,
        'stage_name', rounds.stage_name, 'status', rounds.status,
        'entrant_count', (select count(*) from public.participant_round_scores scores where scores.round_id = rounds.id),
        'completed_games', (select count(distinct lobbies.game_number) from public.lobbies lobbies where lobbies.round_id = rounds.id and not exists (select 1 from public.lobby_participants pending where pending.lobby_id = lobbies.id and pending.result_status = 'pending')),
        'configured_games', null
      ) order by rounds.round_number, rounds.id) from public.rounds rounds where rounds.tournament_id = v_tournament.id), '[]'::jsonb),
      'edges', coalesce((select jsonb_agg(jsonb_build_object(
        'id', edges.id::text, 'tournament_id', edges.tournament_id::text, 'format_edge_id', edges.format_edge_id,
        'source_round_id', edges.source_round_id::text, 'destination_round_id', edges.destination_round_id::text,
        'priority', edges.priority, 'condition', edges.condition, 'status', edges.status, 'advanced_player_count', edges.advanced_player_count
      ) order by edges.priority, edges.id) from public.tournament_edges edges where edges.tournament_id = v_tournament.id), '[]'::jsonb)
    );
  elsif v_view = 'scoresheet' then
    v_json := v_json || jsonb_build_object(
      'participants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', participants.id::text, 'registration_id', participants.registration_id::text,
        'seed_number', participants.seed_number, 'display_name_at_start', participants.display_name_at_start, 'created_at', participants.created_at
      ) order by participants.seed_number, participants.id) from public.tournament_participants participants where participants.tournament_id = v_tournament.id), '[]'::jsonb),
      'scores', coalesce((select jsonb_agg(jsonb_build_object(
        'id', scores.id::text, 'participant_id', scores.participant_id::text, 'round_id', scores.round_id::text,
        'round_seed_number', scores.round_seed_number, 'score', scores.score, 'source_edge_id', scores.source_edge_id::text,
        'source_rank', scores.source_rank, 'created_at', scores.created_at
      ) order by scores.round_id, scores.round_seed_number, scores.id) from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id and participants.tournament_id = v_tournament.id), '[]'::jsonb),
      'game_scores', coalesce((select jsonb_agg(jsonb_build_object(
        'participant_id', lobby_participants.participant_id::text, 'round_id', lobbies.round_id::text,
        'game_number', lobbies.game_number, 'placement', lobby_participants.placement,
        'score', case when lobby_participants.result_status in ('confirmed', 'corrected') then lobby_participants.points else null end
      ) order by lobbies.round_id, lobbies.game_number, lobby_participants.slot_number) from public.lobbies lobbies join public.rounds rounds on rounds.id = lobbies.round_id and rounds.tournament_id = v_tournament.id join public.lobby_participants lobby_participants on lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)
    );
  else
    v_json := v_json || jsonb_build_object(
      'panel', jsonb_build_object(
        'view', 'lobbies', 'round_id', v_round_id::text, 'selected_game_number', v_game,
        'page', v_page, 'page_size', v_page_size, 'total_count', v_total_count, 'total_pages', v_total_pages,
        'game_summaries', coalesce((select jsonb_agg(jsonb_build_object(
          'game_number', games.game_number, 'lobby_count', games.lobby_count, 'completed_lobby_count', games.completed_lobby_count
        ) order by games.game_number) from (select lobbies.game_number, count(*)::integer lobby_count, (count(*) filter (where not exists (select 1 from public.lobby_participants pending where pending.lobby_id = lobbies.id and pending.result_status = 'pending')))::integer completed_lobby_count from public.lobbies lobbies where lobbies.round_id = v_round_id group by lobbies.game_number) games), '[]'::jsonb),
        'lobbies', coalesce((select jsonb_agg(page_row order by lobby_number, lobby_id) from (
          select lobbies.id::text as lobby_id, lobbies.lobby_number,
            jsonb_build_object(
              'id', lobbies.id::text, 'round_id', lobbies.round_id::text, 'game_number', lobbies.game_number, 'lobby_number', lobbies.lobby_number,
              'participants', coalesce((select jsonb_agg(jsonb_build_object(
                'participant_id', lobby_participants.participant_id::text, 'display_name', participants.display_name_at_start,
                'seed_number', participants.seed_number, 'round_seed_number', coalesce(scores.round_seed_number, participants.seed_number),
                'slot_number', lobby_participants.slot_number, 'placement', lobby_participants.placement, 'points', lobby_participants.points, 'result_status', lobby_participants.result_status
              ) order by lobby_participants.slot_number, lobby_participants.id) from public.lobby_participants lobby_participants join public.tournament_participants participants on participants.id = lobby_participants.participant_id left join public.participant_round_scores scores on scores.participant_id = participants.id and scores.round_id = lobbies.round_id where lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)
            ) as page_row
          from (
            select source_lobbies.*,
              row_number() over (order by source_lobbies.lobby_number, source_lobbies.id) as lobby_row
            from public.lobbies source_lobbies
            where source_lobbies.round_id = v_round_id and source_lobbies.game_number = v_game
          ) lobbies
          where lobbies.lobby_row > ((v_page - 1) * v_page_size)
            and lobbies.lobby_row <= (v_page * v_page_size)
        ) paged), '[]'::jsonb),
        -- Only fetched for rounds with at most 8 entrants (which always
        -- includes checkmate, since checkmate requires exactly 8). Above
        -- that size this used to fetch every lobby and every lobby
        -- participant in the round on every page load regardless of the
        -- 8-per-page pagination above; getRoundProgress only needs this
        -- much detail to resolve a checkmate outcome -- a fixed-games
        -- round's progress is fully derivable from game_summaries above
        -- (see getFixedGamesSummaryProgress in lib/db/tournaments/api.ts).
        'progress_lobbies', case when coalesce(v_round_entrant_count, 0) <= 8 then coalesce((select jsonb_agg(jsonb_build_object(
          'id', lobbies.id::text, 'round_id', lobbies.round_id::text, 'game_number', lobbies.game_number, 'lobby_number', lobbies.lobby_number,
          'participants', coalesce((select jsonb_agg(jsonb_build_object(
            'participant_id', lobby_participants.participant_id::text, 'display_name', participants.display_name_at_start,
            'seed_number', participants.seed_number, 'round_seed_number', coalesce(scores.round_seed_number, participants.seed_number),
            'slot_number', lobby_participants.slot_number, 'placement', lobby_participants.placement, 'points', lobby_participants.points, 'result_status', lobby_participants.result_status
          ) order by lobby_participants.slot_number, lobby_participants.id) from public.lobby_participants lobby_participants join public.tournament_participants participants on participants.id = lobby_participants.participant_id left join public.participant_round_scores scores on scores.participant_id = participants.id and scores.round_id = lobbies.round_id where lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)
        ) order by lobbies.game_number, lobbies.lobby_number, lobbies.id) from public.lobbies lobbies where lobbies.round_id = v_round_id), '[]'::jsonb) else '[]'::jsonb end,
        'round_progress', null, 'progression_action', null
      ),
      'scores', coalesce((select jsonb_agg(jsonb_build_object(
        'id', scores.id::text, 'participant_id', scores.participant_id::text, 'round_id', scores.round_id::text,
        'round_seed_number', scores.round_seed_number, 'score', scores.score, 'source_edge_id', scores.source_edge_id::text,
        'source_rank', scores.source_rank, 'created_at', scores.created_at
      ) order by scores.round_seed_number, scores.id) from public.participant_round_scores scores where scores.round_id = v_round_id), '[]'::jsonb)
      -- 'participants' (the tournament-wide roster) is intentionally not
      -- included here: every lobby-participant and score row above already
      -- carries its own display_name/seed_number/round_seed_number, so the
      -- TypeScript mapper never actually needed the fallback lookup this
      -- fed on the lobbies view -- see mapRpcLobby/mapRpcScore in
      -- lib/db/tournaments/api.ts.
    );
  end if;

  return query select v_json;
end;
$$;

create or replace function public.get_tournament_lobby_view_model(
  p_tournament_id text,
  p_lobby_id text
)
returns table(view_model jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_lobby_id public.lobbies.id%type;
begin
  begin
    v_tournament_id := p_tournament_id;
    v_lobby_id := p_lobby_id;
  exception when invalid_text_representation then
    return;
  end;
  return query
  select jsonb_build_object(
    'tournament', jsonb_build_object('id', tournaments.id::text, 'host_user_id', tournaments.host_user_id::text, 'name', tournaments.name, 'status', tournaments.status, 'has_started', tournaments.status <> 'accepting_players'),
    'format_config', tournaments.format_config,
    'round', jsonb_build_object('id', rounds.id::text, 'tournament_id', rounds.tournament_id::text, 'round_number', rounds.round_number, 'format_round_id', rounds.format_round_id, 'stage_name', rounds.stage_name, 'status', rounds.status),
    'lobby', jsonb_build_object('id', lobbies.id::text, 'round_id', lobbies.round_id::text, 'game_number', lobbies.game_number, 'lobby_number', lobbies.lobby_number, 'participants', coalesce((select jsonb_agg(jsonb_build_object('participant_id', lobby_participants.participant_id::text, 'display_name', participants.display_name_at_start, 'seed_number', participants.seed_number, 'slot_number', lobby_participants.slot_number, 'placement', lobby_participants.placement, 'points', lobby_participants.points, 'result_status', lobby_participants.result_status) order by lobby_participants.slot_number, lobby_participants.id) from public.lobby_participants lobby_participants join public.tournament_participants participants on participants.id = lobby_participants.participant_id and participants.tournament_id = tournaments.id where lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', participants.id::text, 'registration_id', participants.registration_id::text, 'seed_number', participants.seed_number, 'display_name_at_start', participants.display_name_at_start, 'created_at', participants.created_at) order by participants.seed_number, participants.id) from public.tournament_participants participants where participants.tournament_id = tournaments.id and exists (select 1 from public.lobby_participants lp where lp.lobby_id = lobbies.id and lp.participant_id = participants.id)), '[]'::jsonb),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('id', scores.id::text, 'participant_id', scores.participant_id::text, 'round_id', scores.round_id::text, 'round_seed_number', scores.round_seed_number, 'score', scores.score, 'source_edge_id', scores.source_edge_id::text, 'source_rank', scores.source_rank, 'created_at', scores.created_at) order by scores.round_seed_number, scores.id) from public.participant_round_scores scores where scores.round_id = rounds.id and exists (select 1 from public.lobby_participants lp where lp.lobby_id = lobbies.id and lp.participant_id = scores.participant_id)), '[]'::jsonb)
  )
  from public.lobbies lobbies
  join public.rounds rounds on rounds.id = lobbies.round_id
  join public.tournaments tournaments on tournaments.id = rounds.tournament_id
  where tournaments.id = v_tournament_id and lobbies.id = v_lobby_id;
end;
$$;

create or replace function public.get_tournament_export_view_model(p_tournament_id text)
returns table(view_model jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tournament_id public.tournaments.id%type;
begin
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    return;
  end;
  return query
  select jsonb_build_object(
    'tournament', jsonb_build_object('id', tournaments.id::text, 'host_user_id', tournaments.host_user_id::text, 'name', tournaments.name, 'status', tournaments.status, 'format_config', tournaments.format_config),
    'registrations', coalesce((select jsonb_agg(jsonb_build_object('id', registrations.id::text, 'display_name', coalesce(registrations.display_name, registrations.riot_puuid, 'Unknown player'), 'registration_status', registrations.registration_status, 'created_at', registrations.created_at) order by registrations.created_at, registrations.id) from public.tournament_registrations registrations where registrations.tournament_id = tournaments.id), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', participants.id::text, 'registration_id', participants.registration_id::text, 'seed_number', participants.seed_number, 'display_name_at_start', participants.display_name_at_start, 'created_at', participants.created_at) order by participants.seed_number, participants.id) from public.tournament_participants participants where participants.tournament_id = tournaments.id), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', rounds.id::text, 'tournament_id', rounds.tournament_id::text, 'round_number', rounds.round_number, 'format_round_id', rounds.format_round_id, 'stage_name', rounds.stage_name, 'status', rounds.status) order by rounds.round_number, rounds.id) from public.rounds rounds where rounds.tournament_id = tournaments.id), '[]'::jsonb),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('id', scores.id::text, 'participant_id', scores.participant_id::text, 'round_id', scores.round_id::text, 'round_seed_number', scores.round_seed_number, 'score', scores.score, 'source_edge_id', scores.source_edge_id::text, 'source_rank', scores.source_rank, 'created_at', scores.created_at) order by scores.round_id, scores.round_seed_number, scores.id) from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id and participants.tournament_id = tournaments.id), '[]'::jsonb),
    'game_scores', coalesce((select jsonb_agg(jsonb_build_object('participant_id', lobby_participants.participant_id::text, 'round_id', lobbies.round_id::text, 'game_number', lobbies.game_number, 'placement', lobby_participants.placement, 'score', case when lobby_participants.result_status in ('confirmed', 'corrected') then lobby_participants.points else null end) order by lobbies.round_id, lobbies.game_number, lobby_participants.slot_number) from public.lobbies lobbies join public.rounds rounds on rounds.id = lobbies.round_id and rounds.tournament_id = tournaments.id join public.lobby_participants lobby_participants on lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)
  )
  from public.tournaments tournaments
  where tournaments.id = v_tournament_id;
end;
$$;

create or replace function public.get_google_sheet_export_status_view_model(
  p_tournament_id text,
  p_host_user_id bigint
)
returns table(view_model jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tournament_id public.tournaments.id%type;
begin
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    return;
  end;
  return query
  select jsonb_build_object(
    'tournament_id', tournaments.id::text,
    'connection_state', coalesce(connections.status, 'disconnected'),
    'state', coalesce(exports.state, 'not_created'),
    'spreadsheet_id', exports.spreadsheet_id,
    'spreadsheet_url', exports.spreadsheet_url,
    'desired_revision', coalesce(exports.desired_revision, 0),
    'synced_revision', coalesce(exports.synced_revision, 0),
    'dirty_at', exports.dirty_at,
    'last_synced_at', exports.last_synced_at,
    'next_attempt_at', exports.next_attempt_at,
    'last_error', case when exports.last_error_code is null and exports.last_error_message is null then null else jsonb_build_object('code', coalesce(exports.last_error_code, 'SHEET_EXPORT_ERROR'), 'message', coalesce(exports.last_error_message, 'Sheet export failed.')) end
  )
  from public.tournaments tournaments
  left join public.organizer_google_connections connections on connections.user_id = p_host_user_id
  left join public.tournament_sheet_exports exports on exports.tournament_id = tournaments.id and exports.host_user_id = p_host_user_id
  where tournaments.id = v_tournament_id and tournaments.host_user_id = p_host_user_id;
end;
$$;

-- checkmate_decisive_game: same fix, and the same reason it matters even
-- though a checkmate round only ever has a handful of matching lobbies --
-- the round_id::text cast prevented the planner from using
-- lobbies(round_id, game_number, lobby_number) at all, so the scan cost grew
-- with every lobby ever created tournament-wide, not with this round's size.
create or replace function public.checkmate_decisive_game(
  p_round_id text,
  p_threshold integer
)
returns integer
language plpgsql
stable
as $$
declare
  v_round_id public.lobbies.round_id%type;
begin
  begin
    v_round_id := p_round_id;
  exception when invalid_text_representation then
    return null;
  end;
  return (
    select min(lobbies.game_number)::integer
    from public.lobbies lobbies
    join public.lobby_participants winners
      on winners.lobby_id = lobbies.id
     and winners.placement = 1
     and winners.result_status in ('confirmed', 'corrected')
    where lobbies.round_id = v_round_id
      and coalesce((
        select sum(previous_participants.points)::integer
        from public.lobbies previous_lobbies
        join public.lobby_participants previous_participants
          on previous_participants.lobby_id = previous_lobbies.id
         and previous_participants.participant_id = winners.participant_id
         and previous_participants.result_status in ('confirmed', 'corrected')
        where previous_lobbies.round_id = v_round_id
          and previous_lobbies.game_number < lobbies.game_number
      ), 0) > p_threshold
  );
end;
$$;

create or replace function public.submit_lobby_results(
  p_tournament_id text,
  p_lobby_id text,
  p_results jsonb,
  p_idempotency_key text default null,
  p_source text default 'web',
  p_submission_id text default null,
  p_mode text default 'record'
)
returns table(
  updated_lobby_id text,
  updated_participant_count integer,
  round_id text,
  lobby_number integer,
  game_number integer,
  replayed boolean
)
language plpgsql
as $$
declare
  v_tournament_id public.tournaments.id%type;
  v_lobby_id public.lobbies.id%type;
  v_tournament public.tournaments%rowtype;
  v_round public.rounds%rowtype;
  v_lobby public.lobbies%rowtype;
  v_node_config jsonb;
  v_placement_points jsonb;
  v_participant_count integer;
  v_result_count integer;
  v_response jsonb;
  v_hash text;
  v_existing public.discord_score_idempotency%rowtype;
  v_submission public.discord_score_submissions%rowtype;
  v_was_pending boolean;
begin
  perform set_config('lock_timeout', '5s', true);
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    raise exception 'Tournament was not found.';
  end;
  begin
    v_lobby_id := p_lobby_id;
  exception when invalid_text_representation then
    raise exception 'Lobby was not found in this tournament.';
  end;

  if p_idempotency_key is not null then
    select * into v_existing from public.discord_score_idempotency
    where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.tournament_id <> v_tournament_id or v_existing.lobby_id <> v_lobby_id then
        raise exception 'Idempotency key belongs to a different lobby.';
      end if;
      v_hash := encode(digest(coalesce(p_results, 'null'::jsonb)::text, 'sha256'), 'hex');
      if v_existing.request_hash <> v_hash then raise exception 'Idempotency key was reused with different results.'; end if;
      return query select
        v_existing.response ->> 'updated_lobby_id',
        (v_existing.response ->> 'updated_participant_count')::integer,
        v_existing.response ->> 'round_id',
        (v_existing.response ->> 'lobby_number')::integer,
        (v_existing.response ->> 'game_number')::integer,
        true;
      return;
    end if;
  end if;

  select * into v_tournament from public.tournaments
  where id = v_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  -- Recheck after taking the tournament lock so two concurrent submissions with
  -- the same idempotency key converge on one committed response.
  if p_idempotency_key is not null then
    select * into v_existing from public.discord_score_idempotency
    where idempotency_key = p_idempotency_key;
    if found then
      if v_existing.tournament_id <> v_tournament_id or v_existing.lobby_id <> v_lobby_id then
        raise exception 'Idempotency key belongs to a different lobby.';
      end if;
      v_hash := encode(digest(coalesce(p_results, 'null'::jsonb)::text, 'sha256'), 'hex');
      if v_existing.request_hash <> v_hash then raise exception 'Idempotency key was reused with different results.'; end if;
      return query select
        v_existing.response ->> 'updated_lobby_id',
        (v_existing.response ->> 'updated_participant_count')::integer,
        v_existing.response ->> 'round_id',
        (v_existing.response ->> 'lobby_number')::integer,
        (v_existing.response ->> 'game_number')::integer,
        true;
      return;
    end if;
  end if;
  select rounds.* into v_round
  from public.rounds rounds
  where rounds.id = (select lobbies.round_id from public.lobbies lobbies where lobbies.id = v_lobby_id)
    and rounds.tournament_id = v_tournament.id for update;
  if not found then raise exception 'Lobby was not found in this tournament.'; end if;
  if v_round.status in ('completed', 'cancelled', 'skipped') or v_tournament.status in ('completed', 'cancelled') then
    raise exception 'Results cannot be edited after the round is completed.'; end if;
  select lobbies.* into v_lobby from public.lobbies lobbies
  where lobbies.id = v_lobby_id and lobbies.round_id = v_round.id for update;
  if not found then raise exception 'Lobby was not found in this tournament.'; end if;

  v_was_pending := not exists (
    select 1 from public.lobby_participants where lobby_id = v_lobby.id and result_status <> 'pending'
  );
  if p_mode = 'record' and not v_was_pending then raise exception 'Lobby game has already been recorded.'; end if;
  if p_mode not in ('record', 'correct') then raise exception 'Invalid score write mode.'; end if;
  if p_mode = 'correct' and p_submission_id is null then
    select id::text into p_submission_id
    from public.discord_score_submissions
    where target_lobby_id = v_lobby.id and status = 'needs_review'
    order by received_at, id
    limit 1
    for update;
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'Lobby results must be an array.'; end if;
  select count(*)::integer into v_participant_count from public.lobby_participants where lobby_id = v_lobby.id;
  select count(*)::integer into v_result_count from jsonb_array_elements(p_results);
  if v_participant_count = 0 or v_result_count <> v_participant_count then raise exception 'Submit one result for every lobby player.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where jsonb_typeof(result.value) <> 'object' or coalesce(result.value ->> 'participantId', '') = '' or coalesce(result.value ->> 'placement', '') !~ '^\d+$') then raise exception 'Every result needs a valid player and placement.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where (result.value ->> 'placement')::numeric < 1 or (result.value ->> 'placement')::numeric > v_participant_count) then raise exception 'Every result needs a valid placement.'; end if;
  if (select count(distinct result.value ->> 'participantId') from jsonb_array_elements(p_results) result(value)) <> v_result_count then raise exception 'Each lobby player must appear exactly once.'; end if;
  if (select count(distinct (result.value ->> 'placement')::integer) from jsonb_array_elements(p_results) result(value)) <> v_result_count then raise exception 'Each player must have a unique placement.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where not exists (select 1 from public.lobby_participants participants where participants.lobby_id = v_lobby.id and participants.participant_id::text = result.value ->> 'participantId')) then raise exception 'A submitted player does not belong to this lobby.'; end if;

  v_placement_points := v_tournament.format_config -> 'placementPoints';
  if jsonb_typeof(v_placement_points) <> 'object' then raise exception 'Tournament format does not define placement points.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where coalesce(v_placement_points ->> (result.value ->> 'placement'), '') !~ '^\d+$') then raise exception 'Tournament format has an invalid placement point value.'; end if;

  with parsed_results as (
    select result.value ->> 'participantId' as participant_id,
      (result.value ->> 'placement')::integer as placement,
      (v_placement_points ->> (result.value ->> 'placement'))::integer as points
    from jsonb_array_elements(p_results) result(value)
  )
  update public.lobby_participants participants
  set placement = parsed_results.placement,
      points = parsed_results.points,
      result_status = case when participants.result_status = 'pending' then 'confirmed' else 'corrected' end,
      updated_at = now()
  from parsed_results
  where participants.lobby_id = v_lobby.id and participants.participant_id::text = parsed_results.participant_id;

  update public.participant_round_scores scores
  set score = coalesce((select sum(participants.points) from public.lobbies lobbies join public.lobby_participants participants on participants.lobby_id = lobbies.id where lobbies.round_id = scores.round_id and participants.participant_id = scores.participant_id and participants.result_status in ('confirmed', 'corrected')), 0), updated_at = now()
  where scores.round_id = v_round.id;
  update public.lobbies set updated_at = now() where id = v_lobby.id;

  if p_submission_id is not null then
    select * into v_submission from public.discord_score_submissions where id::text = p_submission_id for update;
    if not found then raise exception 'Score submission was not found.'; end if;
    if v_submission.target_lobby_id is distinct from v_lobby.id then raise exception 'Score submission does not belong to this lobby.'; end if;
    update public.discord_score_submissions
    set status = 'accepted', accepted_game_number = v_lobby.game_number,
        lease_token = null, lease_expires_at = null, error_code = null, error_message = null, updated_at = now()
    where id = v_submission.id;
    if v_was_pending then
      update public.discord_lobby_threads threads
      set accepted_image_count = threads.accepted_image_count + 1,
          last_game_number = v_lobby.game_number,
          last_accepted_at = now(),
          updated_at = now()
      where threads.round_id = v_lobby.round_id and threads.lobby_number = v_lobby.lobby_number;
    end if;
  end if;

  perform public.generate_round_lobbies(v_round.id::text);
  v_response := jsonb_build_object(
    'updated_lobby_id', v_lobby.id::text,
    'updated_participant_count', v_participant_count,
    'round_id', v_round.id::text,
    'lobby_number', v_lobby.lobby_number,
    'game_number', v_lobby.game_number
  );
  if p_idempotency_key is not null then
    insert into public.discord_score_idempotency(idempotency_key, tournament_id, lobby_id, request_hash, response)
    values (p_idempotency_key, v_tournament.id, v_lobby.id, encode(digest(coalesce(p_results, 'null'::jsonb)::text, 'sha256'), 'hex'), v_response);
  end if;
  return query select v_lobby.id::text, v_participant_count, v_round.id::text,
    v_lobby.lobby_number, v_lobby.game_number, false;
end;
$$;

create or replace function public.generate_round_lobbies(p_round_id text)
returns table (generated_lobby_count integer, assigned_participant_count integer)
language plpgsql
as $$
declare
  v_round_id public.rounds.id%type;
  v_round public.rounds%rowtype;
  v_config jsonb;
  v_lobby_seeding text;
  v_games integer;
  v_reseed integer;
  v_block_size integer;
  v_current_max_game integer;
  v_next_game integer;
  v_block_end_game integer;
  v_participant_count integer;
  v_lobby_count integer;
  v_block_game_count integer;
  v_is_checkmate boolean;
  v_threshold integer;
  v_max_games integer;
begin
  begin
    v_round_id := p_round_id;
  exception when invalid_text_representation then
    raise exception 'Round was not found.';
  end;
  select rounds.* into v_round from public.rounds rounds where rounds.id = v_round_id for update;
  if not found then raise exception 'Round was not found.'; end if;
  if v_round.status = 'completed' then return query select 0, 0; return; end if;
  select public.graph_config_node(tournaments.format_config, v_round.format_round_id)
    into v_config from public.tournaments tournaments where tournaments.id = v_round.tournament_id;
  if v_config is null then raise exception 'Tournament format configuration for node % was not found.', v_round.format_round_id; end if;

  v_is_checkmate := v_config -> 'winCondition' ->> 'type' = 'checkmate';
  v_threshold := coalesce((v_config -> 'winCondition' ->> 'threshold')::integer, 0);
  v_max_games := case when (v_config -> 'winCondition' ->> 'maxGames') ~ '^\d+$' then (v_config -> 'winCondition' ->> 'maxGames')::integer else null end;
  v_games := case when (v_config ->> 'games') ~ '^\d+$' then (v_config ->> 'games')::integer when v_max_games is not null then v_max_games else 6 end;
  v_reseed := coalesce((v_config ->> 'reseed')::integer, 0);
  v_lobby_seeding := v_config ->> 'lobbySeeding';
  if v_lobby_seeding not in ('snake', 'random') then raise exception 'Lobby seeding must be snake or random.'; end if;
  if not v_is_checkmate and (v_games < 1 or v_games > 100) then raise exception 'Node games must be between 1 and 100.'; end if;
  if v_is_checkmate and v_reseed <> 0 then raise exception 'Checkmate nodes must use reseed zero.'; end if;
  if not v_is_checkmate and (v_reseed < 0 or v_reseed > v_games) then raise exception 'Node reseed must be between zero and games.'; end if;
  v_block_size := case when v_is_checkmate then 1 when v_reseed = 0 then v_games else v_reseed end;

  select coalesce(max(lobbies.game_number), 0) into v_current_max_game from public.lobbies lobbies where lobbies.round_id = v_round.id;
  if v_is_checkmate then
    if (select count(*) from public.participant_round_scores scores where scores.round_id = v_round.id) <> 8 then raise exception 'Checkmate nodes require exactly eight participants.'; end if;
    if public.checkmate_decisive_game(v_round.id::text, v_threshold) is not null or (v_max_games is not null and v_current_max_game >= v_max_games) then return query select 0, 0; return; end if;
    v_games := greatest(coalesce(v_max_games, v_current_max_game + 1), v_current_max_game + 1);
  end if;

  if v_current_max_game = 0 then
    v_next_game := 1;
  else
    v_next_game := floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + v_block_size + 1;
    v_block_end_game := least(floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + v_block_size, v_games);
    if exists (select 1 from generate_series(floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + 1, v_block_end_game) expected(game_number) where not exists (select 1 from public.lobbies l where l.round_id = v_round.id and l.game_number = expected.game_number)) then return query select 0, 0; return; end if;
    if exists (select 1 from public.lobbies l left join public.lobby_participants p on p.lobby_id = l.id where l.round_id = v_round.id and l.game_number between floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + 1 and v_block_end_game and (p.id is null or p.result_status not in ('confirmed', 'corrected'))) then return query select 0, 0; return; end if;
  end if;
  if v_next_game > v_games then return query select 0, 0; return; end if;
  v_block_end_game := least(floor((v_next_game - 1)::numeric / v_block_size)::integer * v_block_size + v_block_size, v_games);
  v_block_game_count := v_block_end_game - v_next_game + 1;
  select count(*)::integer into v_participant_count from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id where scores.round_id = v_round.id and participants.tournament_id = v_round.tournament_id;
  if v_participant_count = 0 then raise exception 'Add node participants before generating lobbies.'; end if;
  v_lobby_count := ceil(v_participant_count::numeric / 8)::integer;

  insert into public.lobbies (round_id, game_number, lobby_number)
  select v_round.id, game_number, lobby_number from generate_series(v_next_game, v_block_end_game) game_numbers(game_number) cross join generate_series(1, v_lobby_count) lobby_numbers(lobby_number)
  on conflict (round_id, game_number, lobby_number) do nothing;

  with tournament_totals as (
    select scores.participant_id, sum(scores.score)::integer as tournament_points
    from public.participant_round_scores scores join public.rounds rounds on rounds.id = scores.round_id
    where rounds.tournament_id = v_round.tournament_id group by scores.participant_id
  ), round_firsts as (
    select p.participant_id, count(*)::integer as firsts from public.lobbies lobbies join public.lobby_participants p on p.lobby_id = lobbies.id
    where lobbies.round_id = v_round.id and p.placement = 1 and p.result_status in ('confirmed', 'corrected') group by p.participant_id
  ), ordered_participants as (
    select scores.participant_id, row_number() over (order by case when v_lobby_seeding = 'random' then random() end, coalesce(tournament_totals.tournament_points, 0) desc, coalesce(round_firsts.firsts, 0) desc, scores.round_seed_number asc, participants.display_name_at_start asc, participants.id::text asc) - 1 as position
    from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id
    left join tournament_totals on tournament_totals.participant_id = scores.participant_id left join round_firsts on round_firsts.participant_id = scores.participant_id
    where scores.round_id = v_round.id and participants.tournament_id = v_round.tournament_id
  ), assigned_participants as (
    select ordered_participants.participant_id, game_numbers.game_number,
      case when v_lobby_seeding = 'snake' and ((ordered_participants.position / v_lobby_count) % 2) = 1 then v_lobby_count - (ordered_participants.position % v_lobby_count)::integer else (ordered_participants.position % v_lobby_count)::integer + 1 end as lobby_number,
      (ordered_participants.position / v_lobby_count)::integer + 1 as slot_number
    from ordered_participants cross join generate_series(v_next_game, v_block_end_game) game_numbers(game_number)
  )
  insert into public.lobby_participants (lobby_id, participant_id, slot_number)
  select lobbies.id, assigned_participants.participant_id, assigned_participants.slot_number
  from assigned_participants join public.lobbies lobbies on lobbies.round_id = v_round.id and lobbies.game_number = assigned_participants.game_number and lobbies.lobby_number = assigned_participants.lobby_number
  on conflict (lobby_id, participant_id) do nothing;
  return query select v_lobby_count * v_block_game_count, v_participant_count * v_block_game_count;
end;
$$;

create or replace function public.finalize_tournament_node(p_tournament_id text, p_node_id text)
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
  v_tournament_id public.tournaments.id%type;
  v_node_id public.rounds.id%type;
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
  begin
    v_tournament_id := p_tournament_id;
  exception when invalid_text_representation then
    raise exception 'Tournament was not found.';
  end;
  begin
    v_node_id := p_node_id;
  exception when invalid_text_representation then
    raise exception 'Tournament node was not found.';
  end;
  select * into v_tournament from public.tournaments where id = v_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  select * into v_node from public.rounds where id = v_node_id and tournament_id = v_tournament.id for update;
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

-- checkmate_decisive_game, generate_round_lobbies, and finalize_tournament_node
-- were never revoked from anon/authenticated in any earlier migration --
-- unlike every other mutating RPC in this schema (submit_lobby_results,
-- update_lobby_results, the get_*_view_model functions), which are already
-- service-role-only. That gap let anyone with just the public anon key call
-- finalize_tournament_node or generate_round_lobbies directly on any
-- tournament, bypassing requireTournamentHost entirely. Found while auditing
-- grants for this same migration's redefinitions; fixed here rather than left
-- for a separate pass since these three functions are already being touched.
revoke execute on function public.checkmate_decisive_game(text, integer) from public, anon, authenticated;
revoke execute on function public.generate_round_lobbies(text) from public, anon, authenticated;
revoke execute on function public.finalize_tournament_node(text, text) from public, anon, authenticated;
grant execute on function public.checkmate_decisive_game(text, integer) to service_role;
grant execute on function public.generate_round_lobbies(text) to service_role;
grant execute on function public.finalize_tournament_node(text, text) to service_role;

notify pgrst, 'reload schema';
