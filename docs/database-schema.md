-- WARNING: This schema is for context only and is not meant to be run.
-- The live database currently uses bigint identity keys for tournaments,
-- registrations, rounds, and lobbies. Participant and score records use uuid.

CREATE TABLE public.users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  email character varying NOT NULL UNIQUE,
  auth_user_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- Durable player identity, separate from organizer `users`. Links a Discord
-- identity (the bot's contact + lobby-thread membership key) and a verified
-- Riot identity so sign-up is seamless on the web and in the bot.
CREATE TABLE public.player_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  auth_user_id uuid UNIQUE,
  discord_user_id text UNIQUE,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_accounts_pkey PRIMARY KEY (id)
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
  CONSTRAINT tournaments_host_user_id_fkey
    FOREIGN KEY (host_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
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
  discord_user_id text,
  player_account_id bigint,
  checked_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_registrations_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_registrations_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT tournament_registrations_player_account_fkey
    FOREIGN KEY (player_account_id) REFERENCES public.player_accounts(id) ON DELETE SET NULL
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
-- tournaments(created_at desc, id desc)
-- tournaments(host_user_id, created_at desc, id desc)
-- tournament_registrations(tournament_id) where registration_status = 'registered'
-- rounds(tournament_id, id) where status = 'active'
-- rounds(tournament_id, status, round_number, id)
-- tournament_edges(tournament_id, priority, id)
-- tournament_registrations(tournament_id, riot_puuid) where riot_puuid is not null
-- tournament_registrations(tournament_id, player_account_id) where player_account_id is not null
-- player_accounts(auth_user_id), player_accounts(discord_user_id) (unique, partial)
-- tournament_participants(tournament_id, registration_id)
-- tournament_participants(tournament_id, seed_number)
-- rounds(tournament_id, format_round_id)
-- lobbies(round_id, game_number, lobby_number)
-- lobby_participants(lobby_id, participant_id)
-- participant_round_scores(participant_id, round_id)
-- participant_round_scores(round_id, round_seed_number)

The tournament list pages use the service-role-only RPC
`list_tournament_summaries(p_page, p_page_size, p_host_user_id)`. It returns one
row containing the JSON `items` page plus `total_count`, `page`, `page_size`,
and `total_pages`. Results are ordered by `created_at desc, id desc`; a null
host filter returns public tournaments and a host ID returns only that
organizer's tournaments. Each item includes the current round number, active
runtime node IDs, and a count of registrations whose status is `registered`.
The RPC clamps pages to at least 1 and page sizes to 1–100. Supporting indexes
cover the public and host ordering, registered-registration counts, and active
round lookup.

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
incoming edges resolve. Before activating a destination with multiple incoming
edges, its existing seeds are temporarily moved outside the final range before
ranked contiguous seeds are assigned; this preserves the unique
`(round_id, round_seed_number)` index during reseeding. Empty destinations are
marked `skipped` and propagate zero-player edges. `randomize_pending_lobby_results(tournament_id, node_id)`
is the graph-aware test helper.

## Google Sheets exports

The `tournament_sheet_exports` table stores one public workbook publication per
tournament. Tournament and result mutations mark an existing export dirty and
increment `desired_revision`; `claim_tournament_sheet_exports` leases queued
rows to the scheduled worker. Organizer mutations also wake a targeted worker
after the response, so score changes normally publish within a few seconds.
The worker calls
`complete_tournament_sheet_export` after writing the Players, Scores, and
Checkmate tabs, or `fail_tournament_sheet_export` with retry and re-auth state.
Batch claims are processed by a bounded pool across different tournaments;
leases and the one-export-per-tournament row keep writes to one workbook
serialized. A targeted worker drains up to three consecutive revisions when a
new mutation arrives during an active write. The scheduled worker remains the
backstop for retry delays and out-of-band database changes.

`organizer_google_connections` stores organizer metadata and encrypted refresh
tokens. Refresh tokens must be encrypted before persistence and are never
returned by application endpoints.

Lobby numbers are unique per `(round_id, game_number, lobby_number)`. The
forward migration `20260727000000_fix_lobby_game_uniqueness.sql` removes the
legacy two-column uniqueness rule so multi-game rounds can reuse lobby numbers.
The targeted `claim_tournament_sheet_export` function leases one queued export
for an explicit Generate/Publish request; the scheduled batch claim remains
responsible for retries and automatic dirty revisions.

## Discord tournament operations

The Discord migration adds `tournament_discord_configs` (one guild/category
setup per tournament), `tournament_managers`, one-time
`tournament_manager_invites`, `discord_lobby_threads`, durable
`discord_score_submissions`, `discord_score_idempotency`, and
`discord_outbox`. Registrations retain their Riot identity and may now store a
`discord_user_id` and `checked_in_at`. Tournaments store the check-in state and
an `ended_at` timestamp for screenshot retention cleanup.

`enqueue_discord_score_submission` locks the mapped thread, enforces the
three-item queue cap and ten-second uploader cooldown, and deduplicates Discord
message IDs. `claim_discord_score_submission` leases the oldest eligible row,
reserves the earliest pending game, and permits only one active worker per
thread. `submit_lobby_results` is the shared idempotent score boundary used by
the bot and web API; it locks the tournament/round/lobby, applies the format’s
placement points, recalculates round totals, and increments the thread’s
accepted-image count when a Discord submission is accepted.
The migration also records `tournaments.ended_at` when a tournament is completed
or cancelled so retention cleanup can remove Discord images after seven days.

`20260914000000_add_discord_score_cooldown.sql` adds a configurable per-lobby
score cooldown and fixes latent bugs in the functions above. New columns:
`tournament_discord_configs.score_cooldown_seconds` (integer, default `60`,
`0`-`3600`, `0` disables the cooldown) and
`discord_lobby_threads.last_accepted_at` (set only when a Discord submission
records a previously-pending game). `discord_score_submissions.status` gains
`rejected_cooldown`. The helper `discord_score_cooldown_remaining_seconds(last_accepted_at,
cooldown_seconds)` computes the remaining wait and is used by both
`enqueue_discord_score_submission` (rejects a screenshot posted while the
lobby's cooldown is active, before the overflow/spam checks) and
`claim_discord_score_submission` (rejects an already-queued screenshot that
reaches the front of the queue after the cooldown started, without leasing it
or counting an attempt). Both now also return `retry_after_seconds`, and
`claim_discord_score_submission` additionally returns `claim_status`
(`'claimed'` or `'rejected_cooldown'`) and `discord_message_id` so a rejection
can be replied to directly. The same migration qualifies every table
reference in `claim_discord_score_submission`, `submit_lobby_results`, and
`check_in_discord_player` that previously collided with a same-named
`returns table` output column — those unqualified references made PostgreSQL
raise "column reference is ambiguous" on every call — and fixes
`enqueue_discord_score_submission`'s inserts to `returning *` instead of
`returning id`, which had left `status`/`queue_position` NULL on every
rejection branch.

`20260915000000_discord_connect_ux.sql` adds `tournament_discord_configs.guild_name`
(text, populated by the bot from `guild.name` on each provisioning tick) so the
tournament page can show a server name instead of a raw snowflake. It also
changes application-level semantics, not schema: `check_in_status` no longer
gates `start_tournament` -- a connected tournament with check-in never opened
(`not_started`, the default) starts with every registered player exactly as an
unconnected one does; opening or closing check-in only narrows the roster once
the host has used it, and starting while check-in is open closes it first.
Manual host check-in (setting/clearing a registration's `checked_in_at` from
the web UI, for players without a `discord_user_id`) uses the same column the
Discord check-in button writes.

`20260916000000_discord_disconnect_cleanup.sql` adds
`tournament_discord_configs.cleanup_action` (`'archive'` or `'delete'`,
nullable), `cleanup_requested_at`, and `cleanup_completed_at`. Disconnecting a
tournament (`state` becomes `"disabled"`) sets `cleanup_action` and
`cleanup_requested_at`; the bot's `/api/internal/discord/cleanup` poll picks
up disabled configs with a pending (not-yet-completed) cleanup action, since
disabled tournaments are otherwise excluded from the normal reconcile
payload, archives or permanently deletes the provisioned category/channels/
role accordingly, and stamps `cleanup_completed_at`. Reconnecting resets all
three columns to null.

## Route-scoped read models

`20260803010000_route_scoped_view_models.sql` adds composite lookup indexes for
ordered rounds (`rounds(tournament_id, status, round_number, id)`) and runtime
edges (`tournament_edges(tournament_id, priority, id)`). It also adds four
service-role-only JSON read functions: `get_tournament_page_view_model` returns
one selected server tab and at most eight lobbies for one game/page;
`get_tournament_lobby_view_model` returns one lobby editor projection;
`get_tournament_export_view_model` returns the minimal workbook projection; and
`get_google_sheet_export_status_view_model` returns Sheets state only when the
requested host owns the tournament. IDs are serialized as text and refresh
tokens are never included.

`20260919000000_discord_reconcile_view_model.sql` adds
`get_discord_reconcile_view_model`, which returns the entire payload for the
bot's 10-second reconcile poll in one request. It replaces a route that issued
eight sequential PostgREST reads per connected tournament, so a tick cost
`1 + 8N` round trips and never stopped paying for finished tournaments. Two
filters are applied inside the query: `tournament_discord_configs` rows in
`state = 'disabled'`, and tournaments whose `status` is `'completed'` or
`'cancelled'` **and** that have no `discord_lobby_threads` row left in
`state = 'active'`. The second filter is deliberately not a bare status check:
the reconcile tick is the only thing that archives a lobby thread and the only
thing that flips a sign-up button to disabled, so a tournament that ended while
the bot was offline still gets one final tick to finish that work before it
drops out of the payload. The payload shape matches the retired handler exactly,
including the snake_case `config` block the bot reads.

## Player accounts

`20260921000000_add_player_accounts.sql` adds the `player_accounts` table, a
durable player identity separate from organizer `users`. Each account links at
most one Discord identity (`discord_user_id`, unique) and one verified Riot
identity (`riot_puuid` + `riot_game_tag`), and optionally a Supabase
`auth_user_id` and `email`. `tournament_registrations.player_account_id`
references it with `on delete set null`, backfilling the existing flat
`discord_user_id`/`riot_puuid` columns so bot and web flows share one identity.

Two service-role-only RPCs back the repository:

- `claim_or_create_player_by_discord(p_discord_user_id, p_discord_username,
  p_discord_avatar)` idempotently claims or creates the account for a Discord
  user, refreshing the cached username/avatar. Discord identity can never fork
  into two accounts.
- `link_riot_account_to_player(p_player_account_id, p_riot_puuid,
  p_riot_game_tag)` attaches a verified Riot identity and refuses to move a
  `puuid` already linked to another account.

`20260921000001_player_reconcile_membership.sql` replaces
`get_discord_reconcile_view_model` with an otherwise identical payload that adds
`playerAccountId` to every active lobby participant, so the bot can verify a
thread member belongs to a lobby by account identity. The bot reads participants
by index and ignores unknown fields, so the change is backwards compatible.

`20260921000002_player_dashboard_view_model.sql` adds
`get_player_dashboard_view_model(p_player_account_id)`, returning in one round
trip the player's `riot_game_tag` and every visible tournament with a
`registered` flag and the player's own `registration_status`. The player page
uses it to show all tournaments plus which ones the signed-in player has joined.

Web players sign in with Discord (`/api/auth/discord/player`) using an
`identify`-scoped OAuth flow and a stateless HMAC-signed cookie
(`tftourney-player-session`, see `lib/auth/player-session.ts`). The authorize
step reuses the already-registered `/api/auth/discord/callback` redirect URI and
sets a `tftourney-player-discord-state` cookie; the shared callback detects that
cookie and routes to the player flow (`lib/auth/player-discord-oauth.ts`),
avoids a second redirect URL in the Discord Developer Portal, and fails with
`invalid oauth2 redirect_uri` if a new one is used without being registered.
Sign-up reuses the account's stored Riot identity when present, otherwise
verifies a newly entered `GameName#TAG` with Riot and links it first
(`lib/players/registration.ts`). The bot's
`/api/internal/discord/signup` resolves/creates the same account and links the
verified Riot identity before writing the registration.
