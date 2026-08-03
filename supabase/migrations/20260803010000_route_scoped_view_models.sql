-- Route-scoped read models. These functions deliberately expose compact JSON
-- through the service role only; presentation rules stay in the TypeScript
-- repository mappers.

create index if not exists rounds_tournament_status_number_id_idx
  on public.rounds(tournament_id, status, round_number, id);

create index if not exists tournament_edges_tournament_priority_id_idx
  on public.tournament_edges(tournament_id, priority, id);

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
  v_tournament public.tournaments%rowtype;
  v_view text := case when p_view in ('lobbies', 'scoresheet', 'graph', 'details') then p_view else 'lobbies' end;
  v_round_id text;
  v_game integer;
  v_page integer := greatest(coalesce(p_lobby_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_lobby_page_size, 8), 1), 8);
  v_total_count integer := 0;
  v_total_pages integer := 1;
  v_json jsonb;
begin
  select * into v_tournament from public.tournaments
  where id::text = p_tournament_id limit 1;
  if not found then return; end if;
  if v_tournament.status = 'accepting_players' and v_view = 'lobbies' then
    v_view := 'details';
  end if;

  select coalesce(
    nullif(p_selected_node_id, ''),
    (select id::text from public.rounds where tournament_id = v_tournament.id and status = 'active' order by round_number, id limit 1),
    v_tournament.current_round_id::text,
    (select id::text from public.rounds where tournament_id = v_tournament.id order by round_number, id limit 1)
  ) into v_round_id;
  if v_round_id is not null and not exists (
    select 1 from public.rounds where tournament_id = v_tournament.id and id::text = v_round_id
  ) then
    select coalesce(
      (select id::text from public.rounds where tournament_id = v_tournament.id and status = 'active' order by round_number, id limit 1),
      v_tournament.current_round_id::text,
      (select id::text from public.rounds where tournament_id = v_tournament.id order by round_number, id limit 1)) into v_round_id;
  end if;

  select coalesce(
    p_game_number,
    (select min(game_number) from public.lobbies where round_id::text = v_round_id),
    1
  ) into v_game;
  if not exists (select 1 from public.lobbies where round_id::text = v_round_id and game_number = v_game) then
    select coalesce(min(game_number), 1) into v_game
    from public.lobbies where round_id::text = v_round_id;
  end if;

  select count(*)::integer into v_total_count
  from public.lobbies
  where round_id::text = v_round_id and game_number = v_game;
  v_total_pages := greatest(1, ceil(v_total_count::numeric / v_page_size)::integer);
  if v_page > v_total_pages then v_page := v_total_pages; end if;

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
    'selected_node_id', v_round_id,
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
        'view', 'lobbies', 'round_id', v_round_id, 'selected_game_number', v_game,
        'page', v_page, 'page_size', v_page_size, 'total_count', v_total_count, 'total_pages', v_total_pages,
        'game_summaries', coalesce((select jsonb_agg(jsonb_build_object(
          'game_number', games.game_number, 'lobby_count', games.lobby_count, 'completed_lobby_count', games.completed_lobby_count
        ) order by games.game_number) from (select lobbies.game_number, count(*)::integer lobby_count, (count(*) filter (where not exists (select 1 from public.lobby_participants pending where pending.lobby_id = lobbies.id and pending.result_status = 'pending')))::integer completed_lobby_count from public.lobbies lobbies where lobbies.round_id::text = v_round_id group by lobbies.game_number) games), '[]'::jsonb),
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
            where source_lobbies.round_id::text = v_round_id and source_lobbies.game_number = v_game
          ) lobbies
          where lobbies.lobby_row > ((v_page - 1) * v_page_size)
            and lobbies.lobby_row <= (v_page * v_page_size)
        ) paged), '[]'::jsonb),
        'progress_lobbies', coalesce((select jsonb_agg(jsonb_build_object(
          'id', lobbies.id::text, 'round_id', lobbies.round_id::text, 'game_number', lobbies.game_number, 'lobby_number', lobbies.lobby_number,
          'participants', coalesce((select jsonb_agg(jsonb_build_object(
            'participant_id', lobby_participants.participant_id::text, 'display_name', participants.display_name_at_start,
            'seed_number', participants.seed_number, 'round_seed_number', coalesce(scores.round_seed_number, participants.seed_number),
            'slot_number', lobby_participants.slot_number, 'placement', lobby_participants.placement, 'points', lobby_participants.points, 'result_status', lobby_participants.result_status
          ) order by lobby_participants.slot_number, lobby_participants.id) from public.lobby_participants lobby_participants join public.tournament_participants participants on participants.id = lobby_participants.participant_id left join public.participant_round_scores scores on scores.participant_id = participants.id and scores.round_id = lobbies.round_id where lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)
        ) order by lobbies.game_number, lobbies.lobby_number, lobbies.id) from public.lobbies lobbies where lobbies.round_id::text = v_round_id), '[]'::jsonb),
        'round_progress', null, 'progression_action', null
      ),
      'scores', coalesce((select jsonb_agg(jsonb_build_object(
        'id', scores.id::text, 'participant_id', scores.participant_id::text, 'round_id', scores.round_id::text,
        'round_seed_number', scores.round_seed_number, 'score', scores.score, 'source_edge_id', scores.source_edge_id::text,
        'source_rank', scores.source_rank, 'created_at', scores.created_at
      ) order by scores.round_seed_number, scores.id) from public.participant_round_scores scores where scores.round_id::text = v_round_id), '[]'::jsonb),
      'participants', coalesce((select jsonb_agg(jsonb_build_object('id', participants.id::text, 'registration_id', participants.registration_id::text, 'seed_number', participants.seed_number, 'display_name_at_start', participants.display_name_at_start, 'created_at', participants.created_at) order by participants.seed_number, participants.id) from public.tournament_participants participants where participants.tournament_id = v_tournament.id), '[]'::jsonb)
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
language sql
security definer
set search_path = public, pg_temp
as $$
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
  where tournaments.id::text = p_tournament_id and lobbies.id::text = p_lobby_id;
$$;

create or replace function public.get_tournament_export_view_model(p_tournament_id text)
returns table(view_model jsonb)
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'tournament', jsonb_build_object('id', tournaments.id::text, 'host_user_id', tournaments.host_user_id::text, 'name', tournaments.name, 'status', tournaments.status, 'format_config', tournaments.format_config),
    'registrations', coalesce((select jsonb_agg(jsonb_build_object('id', registrations.id::text, 'display_name', coalesce(registrations.display_name, registrations.riot_puuid, 'Unknown player'), 'registration_status', registrations.registration_status, 'created_at', registrations.created_at) order by registrations.created_at, registrations.id) from public.tournament_registrations registrations where registrations.tournament_id = tournaments.id), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('id', participants.id::text, 'registration_id', participants.registration_id::text, 'seed_number', participants.seed_number, 'display_name_at_start', participants.display_name_at_start, 'created_at', participants.created_at) order by participants.seed_number, participants.id) from public.tournament_participants participants where participants.tournament_id = tournaments.id), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', rounds.id::text, 'tournament_id', rounds.tournament_id::text, 'round_number', rounds.round_number, 'format_round_id', rounds.format_round_id, 'stage_name', rounds.stage_name, 'status', rounds.status) order by rounds.round_number, rounds.id) from public.rounds rounds where rounds.tournament_id = tournaments.id), '[]'::jsonb),
    'scores', coalesce((select jsonb_agg(jsonb_build_object('id', scores.id::text, 'participant_id', scores.participant_id::text, 'round_id', scores.round_id::text, 'round_seed_number', scores.round_seed_number, 'score', scores.score, 'source_edge_id', scores.source_edge_id::text, 'source_rank', scores.source_rank, 'created_at', scores.created_at) order by scores.round_id, scores.round_seed_number, scores.id) from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id and participants.tournament_id = tournaments.id), '[]'::jsonb),
    'game_scores', coalesce((select jsonb_agg(jsonb_build_object('participant_id', lobby_participants.participant_id::text, 'round_id', lobbies.round_id::text, 'game_number', lobbies.game_number, 'placement', lobby_participants.placement, 'score', case when lobby_participants.result_status in ('confirmed', 'corrected') then lobby_participants.points else null end) order by lobbies.round_id, lobbies.game_number, lobby_participants.slot_number) from public.lobbies lobbies join public.rounds rounds on rounds.id = lobbies.round_id and rounds.tournament_id = tournaments.id join public.lobby_participants lobby_participants on lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)
  )
  from public.tournaments tournaments
  where tournaments.id::text = p_tournament_id;
$$;

create or replace function public.get_google_sheet_export_status_view_model(
  p_tournament_id text,
  p_host_user_id bigint
)
returns table(view_model jsonb)
language sql
security definer
set search_path = public, pg_temp
as $$
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
  where tournaments.id::text = p_tournament_id and tournaments.host_user_id = p_host_user_id;
$$;

revoke execute on function public.get_tournament_page_view_model(text, text, text, integer, integer, integer, bigint) from public, anon, authenticated;
revoke execute on function public.get_tournament_lobby_view_model(text, text) from public, anon, authenticated;
revoke execute on function public.get_tournament_export_view_model(text) from public, anon, authenticated;
revoke execute on function public.get_google_sheet_export_status_view_model(text, bigint) from public, anon, authenticated;
grant execute on function public.get_tournament_page_view_model(text, text, text, integer, integer, integer, bigint) to service_role;
grant execute on function public.get_tournament_lobby_view_model(text, text) to service_role;
grant execute on function public.get_tournament_export_view_model(text) to service_role;
grant execute on function public.get_google_sheet_export_status_view_model(text, bigint) to service_role;
