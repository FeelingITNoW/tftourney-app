-- Source: https://lolchess.gg/leaderboards?region=sea&mode=ranked
-- Snapshot: 2026-07-15, top 16 SEA ranked players.
--
-- This seed is intentionally limited to a tournament and its registrations.
-- It does not create participants, rounds, lobbies, or scores, so the
-- tournament remains open and has not started.
do $$
declare
  seed_tournament_name constant text := 'SEA Leaderboard Invitational';
  seed_tournament_id public.tournaments.id%type;
  seeded_at constant timestamptz := '2026-07-15 00:00:00+00';
begin
  delete from public.tournaments
  where name = seed_tournament_name;

  insert into public.tournaments (
    host_user_id,
    name,
    status,
    max_players,
    format_id,
    format_config,
    current_round_id,
    started_at,
    created_at,
    updated_at
  )
  values (
    1,
    seed_tournament_name,
    'accepting_players',
    16,
    'default',
    $format$
    {
      "id": "default",
      "name": "Default TFT Tournament Format",
      "isDefault": true,
      "placementPoints": {
        "1": 8,
        "2": 7,
        "3": 6,
        "4": 5,
        "5": 4,
        "6": 3,
        "7": 2,
        "8": 1
      },
      "rounds": [
        {
          "id": "opening-round",
          "name": "Opening Round",
          "type": "qualifier",
          "participants": "all_registered_players",
          "lobbySeeding": "snake",
          "games": 2,
          "standings": {
            "rankingMetric": "points",
            "sortDirection": "desc"
          },
          "advancement": {
            "type": "top_n",
            "count": 8,
            "rankingMetric": "points",
            "destinationRoundId": "final-round"
          }
        },
        {
          "id": "final-round",
          "name": "Final Round",
          "type": "final",
          "participants": "advanced_from_opening-round",
          "lobbySeeding": "random",
          "games": 2,
          "standings": {
            "rankingMetric": "points",
            "sortDirection": "desc"
          },
          "winCondition": {
            "type": "highest_points_after_games",
            "games": 2,
            "rankingMetric": "points"
          }
        }
      ]
    }
    $format$::jsonb,
    null,
    null,
    seeded_at,
    seeded_at
  )
  returning id into seed_tournament_id;

  insert into public.tournament_registrations (
    tournament_id,
    registration_status,
    display_name,
    riot_puuid,
    created_at,
    updated_at
  )
  select
    seed_tournament_id,
    'registered',
    leaderboard.display_name,
    null,
    seeded_at + leaderboard.rank * interval '1 second',
    seeded_at + leaderboard.rank * interval '1 second'
  from (
    values
      (1, 'FuuTime#xdd'),
      (2, 'ffstars#8787'),
      (3, 'ทนายPong#1244'),
      (4, 'FS Foeman#bundd'),
      (5, 'Kathrina Irene#tin'),
      (6, 'ZzzTina#SEA'),
      (7, 'Braven#ph2'),
      (8, 'Havok#BEE'),
      (9, 'Dodes#MD3'),
      (10, 'kitai#0801'),
      (11, 'Houston3001#9594'),
      (12, 'TTVBubu1150#qquer'),
      (13, 'k4yj#7914'),
      (14, 'cjwei98#cjw98'),
      (15, 'freezingfiref#SG2'),
      (16, 'TS jose#1023')
  ) as leaderboard(rank, display_name)
  order by leaderboard.rank;
end;
$$;
