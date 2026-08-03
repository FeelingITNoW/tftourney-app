-- Paginated tournament summary view-model for public and organizer lists.

create index if not exists tournaments_created_at_id_idx
  on public.tournaments(created_at desc, id desc);

create index if not exists tournaments_host_created_at_id_idx
  on public.tournaments(host_user_id, created_at desc, id desc);

create index if not exists tournament_registrations_registered_tournament_id_idx
  on public.tournament_registrations(tournament_id)
  where registration_status = 'registered';

create index if not exists rounds_active_tournament_id_idx
  on public.rounds(tournament_id, id)
  where status = 'active';

create or replace function public.list_tournament_summaries(
  p_page integer default 1,
  p_page_size integer default 10,
  p_host_user_id bigint default null
)
returns table (
  items jsonb,
  total_count bigint,
  page integer,
  page_size integer,
  total_pages integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
with parameters as (
  select
    greatest(coalesce(p_page, 1), 1) as page,
    least(greatest(coalesce(p_page_size, 10), 1), 100) as page_size
),
filtered_tournaments as (
  select tournaments.*
  from public.tournaments
  where p_host_user_id is null
     or tournaments.host_user_id = p_host_user_id
),
tournament_counts as (
  select count(*)::bigint as total_count
  from filtered_tournaments
),
ordered_tournaments as (
  select
    filtered_tournaments.*,
    row_number() over (
      order by filtered_tournaments.created_at desc, filtered_tournaments.id desc
    ) as row_number
  from filtered_tournaments
),
paged_tournaments as (
  select ordered_tournaments.*, parameters.page, parameters.page_size
  from ordered_tournaments
  cross join parameters
  where ordered_tournaments.row_number > (parameters.page - 1) * parameters.page_size
    and ordered_tournaments.row_number <= parameters.page * parameters.page_size
),
summary_items as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', paged_tournaments.id::text,
        'host_user_id', paged_tournaments.host_user_id::text,
        'name', paged_tournaments.name,
        'max_players', paged_tournaments.max_players,
        'format_id', paged_tournaments.format_id,
        'status', paged_tournaments.status,
        'has_started', paged_tournaments.status <> 'accepting_players',
        'current_round_id', paged_tournaments.current_round_id::text,
        'current_round_number', (
          select rounds.round_number
          from public.rounds
          where rounds.id = paged_tournaments.current_round_id
        ),
        'active_node_ids', coalesce(
          (
            select jsonb_agg(active_round.id::text order by active_round.round_number, active_round.id)
            from public.rounds as active_round
            where active_round.tournament_id = paged_tournaments.id
              and active_round.status = 'active'
          ),
          '[]'::jsonb
        ),
        'created_at', paged_tournaments.created_at,
        'registered_player_count', (
          select count(*)::integer
          from public.tournament_registrations
          where tournament_registrations.tournament_id = paged_tournaments.id
            and tournament_registrations.registration_status = 'registered'
        )
      )
      order by paged_tournaments.created_at desc, paged_tournaments.id desc
    ),
    '[]'::jsonb
  ) as items
  from paged_tournaments
)
select
  summary_items.items,
  tournament_counts.total_count,
  parameters.page,
  parameters.page_size,
  greatest(
    1,
    ceil(tournament_counts.total_count::numeric / parameters.page_size)::integer
  ) as total_pages
from parameters
cross join tournament_counts
cross join summary_items;
$function$;

revoke execute on function public.list_tournament_summaries(integer, integer, bigint)
  from public, anon, authenticated;
grant execute on function public.list_tournament_summaries(integer, integer, bigint)
  to service_role;
