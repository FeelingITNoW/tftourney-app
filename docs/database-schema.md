-- WARNING: This schema is for context only and is not meant to be run.
-- The live database currently uses bigint identity keys for tournaments,
-- registrations, rounds, and lobbies. Participant and score records use uuid.

CREATE TABLE public.users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  email character varying NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tournaments (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  host_user_id bigint NOT NULL,
  name character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'accepting_players'
    CHECK (status IN ('accepting_players', 'in_progress', 'completed', 'cancelled')),
  max_players integer NOT NULL CHECK (max_players > 0),
  format_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  format_id text NOT NULL DEFAULT 'default',
  current_round_id bigint,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournaments_pkey PRIMARY KEY (id),
  CONSTRAINT tournaments_current_round_id_fkey
    FOREIGN KEY (current_round_id) REFERENCES public.rounds(id) ON DELETE SET NULL
);

CREATE TABLE public.tournament_registrations (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tournament_id bigint NOT NULL,
  registration_status character varying NOT NULL DEFAULT 'registered'
    CHECK (registration_status IN ('registered', 'waitlisted', 'entered', 'withdrawn')),
  display_name text NOT NULL,
  riot_puuid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_registrations_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_registrations_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE
);

CREATE TABLE public.rounds (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tournament_id bigint NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  format_round_id text,
  stage_name character varying,
  status character varying NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'skipped')),
  node_depth integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rounds_pkey PRIMARY KEY (id),
  CONSTRAINT rounds_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE
);

CREATE TABLE public.tournament_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL,
  registration_id bigint NOT NULL,
  seed_number integer NOT NULL CHECK (seed_number > 0),
  display_name_at_start text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_participants_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_participants_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT tournament_participants_registration_tournament_fk
    FOREIGN KEY (registration_id, tournament_id)
    REFERENCES public.tournament_registrations(id, tournament_id) ON DELETE CASCADE
);

CREATE TABLE public.lobbies (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  round_id bigint NOT NULL,
  game_number integer NOT NULL DEFAULT 1 CHECK (game_number > 0),
  lobby_number integer NOT NULL CHECK (lobby_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lobbies_pkey PRIMARY KEY (id),
  CONSTRAINT lobbies_round_id_fkey
    FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE
);

CREATE TABLE public.lobby_participants (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  lobby_id bigint NOT NULL,
  participant_id uuid NOT NULL,
  slot_number integer CHECK (slot_number IS NULL OR slot_number > 0),
  placement integer CHECK (placement IS NULL OR placement > 0),
  points integer CHECK (points IS NULL OR points >= 0),
  result_status character varying NOT NULL DEFAULT 'pending'
    CHECK (result_status IN ('pending', 'confirmed', 'corrected', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lobby_participants_pkey PRIMARY KEY (id),
  CONSTRAINT lobby_participants_lobby_id_fkey
    FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id) ON DELETE CASCADE,
  CONSTRAINT lobby_participants_participant_fk
    FOREIGN KEY (participant_id) REFERENCES public.tournament_participants(id)
    ON DELETE CASCADE
);

CREATE TABLE public.participant_round_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  round_id bigint NOT NULL,
  round_seed_number integer NOT NULL CHECK (round_seed_number > 0),
  score integer NOT NULL DEFAULT 0,
  source_edge_id bigint,
  source_rank integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_round_scores_pkey PRIMARY KEY (id),
  CONSTRAINT participant_round_scores_round_fk
    FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE,
  CONSTRAINT participant_round_scores_participant_fk
    FOREIGN KEY (participant_id) REFERENCES public.tournament_participants(id)
    ON DELETE CASCADE
);

-- Important unique indexes:
-- tournament_registrations(tournament_id, riot_puuid) where riot_puuid is not null
-- tournament_participants(tournament_id, registration_id)
-- tournament_participants(tournament_id, seed_number)
-- rounds(tournament_id, format_round_id)
-- lobbies(round_id, game_number, lobby_number)
-- lobby_participants(lobby_id, participant_id)
-- participant_round_scores(participant_id, round_id)
-- participant_round_scores(round_id, round_seed_number)

## Compact graph tournament formats

`format_config` uses schema version 3 and is graph-only. It contains one
`nodeDefaults` object, a `nodes` array, and an `edges` array; it never stores a
duplicate `rounds` array. Node fields inherit from `nodeDefaults`, with a node
field replacing the corresponding default as a whole. Fixed-game nodes use a
positive `games` count; `reseed: 0` disables automatic reseeding. Checkmate
nodes omit `games`, use `reseed: 0`, and declare `winCondition` as
`{"type":"checkmate","threshold":18}`. Omitted ranking metrics default to
`points`.

Each node declares a `lobbySeeding` strategy:

- `"snake"` assigns seeded players across lobbies in alternating directions.
  For two lobbies, seeds 1–4 are distributed 1, 2, 2, 1.
- `"random"` shuffles the node participants before distributing them evenly
  across lobbies.

Lobby assignments are repeated for each fixed-game block. Checkmate nodes
must have exactly eight active participants (including finals), while a
checkmate configuration is only valid on an eight-player destination or final
node. The built-in default uses six games with reseed blocks of two in its
opening node and checkmate in its eight-player final.

The top-level `format_config.placementPoints` object maps finishing placements
to awarded points. The default format awards 8 points for first place, 7 for
second, continuing down to 1 point for eighth place.

Starting a tournament creates every graph node and edge, its round-seeded score
rows, and the first game block for each active entry node in one database
transaction. Formats containing checkmate require at least eight selected
entrants. `generate_round_lobbies(round_id)`
is idempotent and creates the next block only after the current block is fully
scored. It uses tournament totals, current-round firsts, and the round seed for
reseeding; random assignments are persisted in `lobby_participants`.

## Lobby results and round totals

`update_lobby_results(tournament_id, lobby_id, results)` records the placement
for every player in a lobby and derives awarded points from the tournament's
`format_config.placementPoints` mapping. The function requires a complete roster
with unique placements, marks first-time results as `confirmed` and later edits
as `corrected`, then recalculates `participant_round_scores.score` from all
confirmed or corrected lobby points in that round. For checkmate, points after
the decisive game are excluded. The lobby results and round score totals are
therefore updated in one database transaction.

When the last result in a block is saved, the same transaction creates the next
game block. For checkmate, the next single-game block is created only when no
decisive result exists. `finalize_tournament_node(tournament_id, node_id)` locks
a completed node, evaluates its ordered outgoing edges, and activates
destinations after all incoming edges resolve. Completed nodes are read-only.

The testing RPC `randomize_pending_lobby_results(tournament_id, node_id)`
randomizes only pending lobbies in the selected active node and runs the
updates in one transaction.
Existing results are preserved. Once a later reseeded block exists, result edits
to earlier blocks are rejected so persisted lobby assignments cannot diverge from
the standings that produced them.

## Graph tournament runtime

Format snapshots with `schemaVersion: 3` define `nodeDefaults`, `nodes`, and
`edges`. A node contains only overrides for game count, reseed block, lobby
seeding, standings, and win-condition settings. An edge contains a source node,
destination node, priority, and an ordered exclusive `top_n` condition. Edges
are evaluated by priority and consume players from the source standings;
unmatched players are eliminated.

The `rounds` table is used as the runtime node table during the graph migration.
`rounds.format_round_id` identifies the configured node and `rounds.status` may
also be `skipped`. `tournament_edges` stores the runtime edge snapshot and
resolution state. `participant_round_scores.source_edge_id` and `source_rank`
retain the transfer audit trail. A tournament may have several active
rounds/nodes at once; `tournaments.current_round_id` is retained only as a
legacy display pointer and is not used for graph progression. The v3 migration
adds `rounds.node_depth`, allows `skipped` status, and enforces that stored
`format_config` objects contain schema version 3 with no `rounds` property.

`start_tournament(tournament_id, initial_assignments)` creates every graph node
and edge, assigns explicit registrations first, randomly distributes remaining
entrants among entry nodes, and generates lobbies for every active root.
`finalize_tournament_node(tournament_id, node_id)` locks a completed node,
resolves its outgoing edges, and activates a destination only after all of its
incoming edges resolve. Empty destinations are marked `skipped` and propagate
zero-player edges. `randomize_pending_lobby_results(tournament_id, node_id)`
is the graph-aware test helper.
