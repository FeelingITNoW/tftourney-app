# Database migration function reference

This document is the functional map for the PostgreSQL routines introduced by
the tournament migrations. It describes the current routines installed in the
public schema, rather than every historical version of a routine. Later
migrations intentionally replace earlier definitions; the migration history is
listed in the final section for tracing behavior changes.

## Runtime lifecycle

The normal tournament flow is:

1. start_tournament locks the tournament, chooses the graph or linear start
   path, creates participants, rounds, edges, and the first lobbies.
2. update_lobby_results records each lobby's placements and recalculates the
   round score totals.
3. generate_round_lobbies creates the next game block when the current block is
   complete. Checkmate progress is checked with checkmate_decisive_game.
4. Once a graph node is complete, finalize_tournament_node resolves its
   outgoing edges and activates destinations whose incoming edges are resolved.
5. Trigger functions protect registration and result-edit invariants while
   randomize_pending_lobby_results provides a test-only result generator.

## Tournament and format functions

### public.list_tournament_summaries

    list_tournament_summaries(
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

Returns one page of tournament summary view-model items for the public list or
the requested organizer. The function uses deterministic newest-first ordering
with the tournament ID as a tie-breaker, computes registered-player counts and
active node IDs in the database, and clamps page inputs to safe bounds. It is
granted only to `service_role`.

### public.start_tournament

    start_tournament(
      p_tournament_id text,
      p_initial_assignments jsonb default '[]'::jsonb
    )
    returns table (
      started_tournament_id text,
      started_entrant_count integer,
      started_round_id text,
      started_round_number integer
    )

The public entry point for starting a tournament. It locks the tournament and
rejects tournaments that have already started. Graph configurations are
validated through their entry-node capacities, entrant requirements, and
explicit {registrationId, nodeId} assignments. It creates participants,
runtime rounds, and runtime edges, assigns remaining entrants randomly to root
nodes, activates root nodes, generates their lobbies, and changes the
tournament status to in_progress.

For a non-graph configuration it delegates to start_linear_tournament. The
operation is transactional, so validation or lobby-generation failures roll
back the start.

### public.start_linear_tournament

    start_linear_tournament(p_tournament_id text)
    returns table (
      started_tournament_id text,
      started_entrant_count integer,
      started_round_id text,
      started_round_number integer
    )

Starts the legacy sequential-round format. It selects registered players up to
the tournament limit, creates participant and round score rows, activates the
first round, and generates its lobbies. It remains an internal compatibility
path called by start_tournament when no graph arrays are present.

### public.compact_tournament_format_v3

    compact_tournament_format_v3(p_config jsonb) returns jsonb

Canonicalizes a format snapshot into schema version 3. It moves shared node
settings into nodeDefaults, keeps only node overrides, normalizes edge
conditions and priorities, applies default ranking metrics, and rejects legacy
round-based snapshots. This is a pure format transformation used before a
format is persisted.

### public.graph_config_node

    graph_config_node(p_config jsonb, p_node_id text) returns jsonb

Returns the node object with the requested ID from p_config.nodes, or SQL NULL
when it does not exist. Runtime functions use it to read a node's games,
reseed, lobby seeding, standings, and win-condition settings.

### public.graph_config_edges

    graph_config_edges(p_config jsonb)
    returns table (
      edge_id text,
      source_node_id text,
      destination_node_id text,
      priority integer,
      condition jsonb
    )

Expands p_config.edges into relational rows for insertion into
tournament_edges. Missing priorities default to 1; missing conditions default to
an empty object. The current graph runtime also supplies the default
rankingMetric: points condition behavior.

## Lobby, scoring, and progression functions

### public.generate_round_lobbies

    generate_round_lobbies(p_round_id text)
    returns table (
      generated_lobby_count integer,
      assigned_participant_count integer
    )

Generates the next game block for an active round. It is idempotent and does
nothing if the current block is incomplete or the next block already exists.
The function applies the node's game/reseed settings, calculates standings and
tie-breakers, then assigns players using snake or random lobby seeding. Random
assignments are persisted in lobby_participants so later reads are stable.

### public.update_lobby_results

    update_lobby_results(
      p_tournament_id text,
      p_lobby_id text,
      p_results jsonb
    )
    returns table (
      updated_lobby_id text,
      updated_participant_count integer
    )

Validates and records a complete lobby result payload. Every lobby participant
must be present exactly once with a valid, unique placement. Points are derived
from format_config.placementPoints; first submissions become confirmed and
later permitted edits become corrected. Round score totals are recalculated
from all confirmed/corrected games. When a block is complete, the function calls
generate_round_lobbies; it also enforces checkmate-specific scoring and
progression rules.

### public.checkmate_decisive_game

    checkmate_decisive_game(p_round_id text, p_threshold integer) returns integer

Examines confirmed checkmate game results and returns the first game number in
which a participant exceeds the configured point threshold. It returns NULL
when no decisive game exists yet. The result is used to stop additional
checkmate games and to exclude games after the decisive game from scoring.

### public.finalize_tournament_node

    finalize_tournament_node(
      p_tournament_id text,
      p_node_id text
    )
    returns table (
      transition_type text,
      completed_node_id text,
      activated_node_ids text[],
      skipped_node_ids text[],
      advanced_player_count integer
    )

Finalizes an active graph node after all required lobby results (or checkmate
conditions) are complete. Outgoing edges are evaluated by priority; each edge
consumes its selected players, records source_edge_id and source_rank, and is
marked resolved. A destination activates only after every incoming edge is
resolved. Empty destinations become skipped and propagate zero-player
transitions.

Before activating a destination receiving players from multiple sources, the
function temporarily offsets existing round_seed_number values and then
assigns ranked contiguous seeds. This two-phase reseed preserves the immediate
unique (round_id, round_seed_number) index and prevents transient duplicate
key errors. Calling the function again for a completed node returns
node_already_finalized without changing data.

### public.randomize_pending_lobby_results

    randomize_pending_lobby_results(
      p_tournament_id text,
      p_node_id text
    )
    returns table (
      randomized_lobby_count integer,
      randomized_participant_count integer
    )

Testing-only helper for graph tournaments. It locks the tournament and selected
active node, finds the first pending game block, creates valid random
placements for its lobbies, and routes them through update_lobby_results.
Existing results are preserved and completed tournaments are rejected.

## Route-scoped read functions

### public.get_tournament_page_view_model

    get_tournament_page_view_model(
      p_tournament_id text, p_view text, p_selected_node_id text,
      p_game_number integer, p_lobby_page integer, p_lobby_page_size integer,
      p_host_user_id bigint
    ) returns table (view_model jsonb)

Returns the common tournament shell and exactly one `lobbies`, `scoresheet`,
`graph`, or `details` panel. Lobby pages are clamped to a safe page size of
eight. The function is executable only by `service_role`.

### public.get_tournament_lobby_view_model

    get_tournament_lobby_view_model(p_tournament_id text, p_lobby_id text)
    returns table (view_model jsonb)

Returns the tournament, round, roster, and round scores needed by the lobby
editor in one request.

### public.get_tournament_export_view_model

    get_tournament_export_view_model(p_tournament_id text)
    returns table (view_model jsonb)

Returns registrations, participants, rounds, scores, game scores, and format
configuration for the workbook worker. No graph or lobby duplication is sent.

### public.get_google_sheet_export_status_view_model

    get_google_sheet_export_status_view_model(
      p_tournament_id text, p_host_user_id bigint
    ) returns table (view_model jsonb)

Returns connection/export state only for the verified tournament host. All five
functions revoke `public`, `anon`, and `authenticated` execution and grant it
to `service_role`.

### public.get_discord_reconcile_view_model

    get_discord_reconcile_view_model() returns table (view_model jsonb)

Returns the whole payload for the bot's 10-second reconcile poll
(`app/api/internal/discord/reconcile`) in one query: every non-disabled
`tournament_discord_configs` row with its tournament name, status, check-in
status, registered/checked-in counts, the raw snake_case `config` block, the
lobbies of active rounds with their participants' `discord_user_id` and
display name, and all lobby threads for the tournament. Skips `'disabled'`
configs, and skips `'completed'`/`'cancelled'` tournaments once they have no
`discord_lobby_threads` row left in `state = 'active'` -- the extra condition
guarantees one final tick to archive threads and disable the sign-up panel
before the tournament drops out. Replaces a handler that issued eight
sequential reads per tournament per tick. Executable only by `service_role`.

## Discord queue and score functions

These functions back the Discord bot integration (`bot/index.ts` and the
`app/api/internal/discord/**` routes); see `docs/discord-bot.md` for the
end-to-end flow. All revoke `public`, `anon`, and `authenticated` execution
and grant it to `service_role`.

### public.enqueue_discord_score_submission

    enqueue_discord_score_submission(
      p_tournament_id text, p_thread_id text, p_discord_message_id text,
      p_discord_user_id text, p_received_at timestamptz, p_storage_path text,
      p_mime_type text, p_byte_size integer
    ) returns table (
      submission_id text, submission_status text, queue_position integer,
      round_id text, lobby_number integer, accepted_image_count integer,
      retry_after_seconds integer
    )

Locks the mapped `discord_lobby_threads` row and queues a screenshot, or
inserts it as a terminal rejection: `rejected_cooldown` if the lobby's
`score_cooldown_seconds` has not elapsed since `last_accepted_at`,
`rejected_overflow` beyond three pending jobs per thread, or `rejected_spam`
within a ten-second per-user/thread window. Deduplicates by
`discord_message_id`.

### public.claim_discord_score_submission

    claim_discord_score_submission(p_lease_seconds integer default 120)
    returns table (
      submission_id text, tournament_id text, round_id text, thread_id text,
      lobby_id text, game_number integer, lease_token text, storage_path text,
      attempt_count integer, claim_status text, discord_message_id text,
      retry_after_seconds integer
    )

Expires stale leases, then leases the oldest queued row in a thread with no
other job processing or awaiting review. If the lobby's cooldown became
active after the row was queued, rejects it (`claim_status =
'rejected_cooldown'`) without leasing it or counting an attempt; otherwise
reserves the earliest pending game for that round/lobby number and marks it
`processing` (`claim_status = 'claimed'`).

### public.mark_discord_submission_review

    mark_discord_submission_review(
      p_submission_id text, p_lease_token text, p_ocr_result jsonb,
      p_error_code text, p_error_message text
    ) returns table (updated_submission_id text, updated_status text)

Moves a leased submission to `needs_review`, storing the raw OCR result for
audit. Requires the caller's lease token to still be valid.

### public.submit_lobby_results

    submit_lobby_results(
      p_tournament_id text, p_lobby_id text, p_results jsonb,
      p_idempotency_key text default null, p_source text default 'web',
      p_submission_id text default null, p_mode text default 'record'
    ) returns table (
      updated_lobby_id text, updated_participant_count integer,
      round_id text, lobby_number integer, game_number integer,
      replayed boolean
    )

The shared idempotent score-write boundary used by both the Discord worker
and the web API (`update_lobby_results` is now a thin wrapper calling this
with mode `correct`). Locks the tournament, round, and lobby; validates the
full roster and unique placements; derives points from the format's
`placementPoints`; recalculates round totals; and, when `p_submission_id` is
given, marks that Discord submission `accepted` and — only the first time a
previously-pending game is recorded — increments
`discord_lobby_threads.accepted_image_count`, stamps `last_game_number`, and
starts that thread's score cooldown by setting `last_accepted_at = now()`.
Calls `generate_round_lobbies` to create the next game block when the current
one completes.

### public.discord_score_cooldown_remaining_seconds

    discord_score_cooldown_remaining_seconds(
      p_last_accepted_at timestamptz, p_cooldown_seconds integer
    ) returns integer

Pure helper: seconds remaining before a lobby thread's score cooldown clears
(`0` when there is no prior accept or the cooldown is disabled). Shared by
the enqueue and claim functions above so the two cooldown checks can never
disagree.

### public.check_in_discord_player

    check_in_discord_player(p_tournament_id text, p_discord_user_id text)
    returns table (registration_id text, display_name text, checked_in_at timestamptz)

Marks a registered/waitlisted player checked in while check-in is open.
Idempotent: repeat calls do not move an already-recorded `checked_in_at`.

## Player and organizer account functions

### public.claim_or_create_organizer

    claim_or_create_organizer(p_auth_user_id uuid, p_email text)
    returns table (id bigint, email text, auth_user_id uuid)

Resolves the `users` row for an organizer's Supabase auth identity: matches by
`auth_user_id`, then by lowercased email (raising on a unique-violation if
that email is already bound to a different auth user), then adopts the
unclaimed legacy `users.id = 1` seed row, else inserts a new row.

### public.claim_or_create_player_by_discord

    claim_or_create_player_by_discord(
      p_discord_user_id text, p_discord_username text default null,
      p_discord_avatar text default null
    )
    returns table (
      id bigint, auth_user_id uuid, discord_user_id text, discord_username text,
      discord_avatar text, riot_puuid text, riot_game_tag text, email text,
      created_at timestamptz, updated_at timestamptz
    )

Idempotently claims the player account for a Discord identity: the first call
creates it, later calls refresh the cached username/avatar and return the same
row. Used by the Discord bot's sign-up flow (never by the web sign-in flow,
which does not auto-create accounts -- see create_player_account below).

### public.create_player_account

    create_player_account(
      p_username text, p_password_hash text, p_email text default null,
      p_discord_user_id text default null, p_discord_username text default null,
      p_discord_avatar text default null
    )
    returns table (
      id bigint, auth_user_id uuid, username text, discord_user_id text,
      discord_username text, discord_avatar text, riot_puuid text,
      riot_game_tag text, email text, created_at timestamptz,
      updated_at timestamptz, last_signed_in_at timestamptz
    )

Creates a brand-new player account from a username/password, the only way a
web account is created. Raises a distinct message for a taken username vs. a
Discord id already linked to another account (`discord_user_id` is optional,
used when a player signs up right after "Continue with Discord" resolved to
no existing account).

### public.find_player_account_by_username

    find_player_account_by_username(p_username text)
    returns table (..., password_hash text, ...)

Case-insensitive username lookup including `password_hash`, for sign-in
verification only. No other player_accounts read function returns the hash.

### public.touch_player_account_last_signed_in

    touch_player_account_last_signed_in(p_player_account_id text) returns void

Records a successful sign-in. Kept separate from the `stable` read functions
above so a read can never have a write side effect.

### public.set_player_credentials

    set_player_credentials(
      p_player_account_id text, p_username text default null,
      p_password_hash text default null, p_email text default null
    )
    returns table (... same shape as create_player_account minus password_hash ...)

Sets or changes a player's username/password/email. A null argument leaves
that column untouched, so a password-only change does not require resending
the username. Used both to claim a credential-less (bot-created) account and
to change credentials later.

### public.link_riot_account_to_player

    link_riot_account_to_player(
      p_player_account_id text, p_riot_puuid text, p_riot_game_tag text
    )
    returns table (... player_accounts row ...)

Attaches a verified Riot identity to a player account. Refuses to move a
`riot_puuid` already linked to a different account.

### public.link_discord_account_to_player / public.unlink_discord_account_from_player

    link_discord_account_to_player(
      p_player_account_id text, p_discord_user_id text,
      p_discord_username text default null, p_discord_avatar text default null
    ) returns table (... player_accounts row ...)
    unlink_discord_account_from_player(p_player_account_id text)
      returns table (... player_accounts row ...)

Lets an already-signed-in player link or unlink a Discord identity from their
account page. `link_discord_account_to_player` refuses a Discord id already
linked to a different account, mirroring `link_riot_account_to_player`.

### public.check_in_player_account

    check_in_player_account(p_tournament_id text, p_player_account_id text)
    returns table (registration_id text, display_name text, checked_in_at timestamptz)

Web check-in keyed on the player's durable account id instead of Discord id.
Same guards and idempotency as `check_in_discord_player`; this is the
counterpart for a player who registered without linking Discord.

### public.get_player_dashboard_view_model

    get_player_dashboard_view_model(p_player_account_id text)
    returns table (view_model jsonb)

One-round-trip read model for the player dashboard/account pages: the
account's own profile fields (username, email, Discord, Riot) plus, per
visible tournament, whether the player registered, checked in, and actually
played (a `tournament_participants` row exists for their registration).

## Integrity and trigger functions

### public.set_updated_at

    set_updated_at() returns trigger

Generic before-update trigger function that sets NEW.updated_at = now(). It is
attached to mutable tournament tables so application code does not need to
maintain timestamps manually.

### public.prevent_registration_after_start

    prevent_registration_after_start() returns trigger

Rejects registration changes that would add or materially alter a roster after
the tournament has left accepting_players. This protects the participant and
seed snapshots created by the start functions.

### public.prevent_late_lobby_result_edits

    prevent_late_lobby_result_edits() returns trigger

Runs before placement, points, or result-status updates on lobby_participants.
Once a later reseeded game block has been generated, earlier block results
cannot be edited because doing so would invalidate persisted lobby assignments
and downstream standings. No-op updates are allowed.

## Migration history and replacements

Migrations are append-only. Several early migrations define the same routine
while the schema evolves; the last definition is the one installed in the
database:

| Migration family | Main additions or replacements |
| --- | --- |
| 20260709000000 / 20260711010000 | Base tables and set_updated_at. |
| 20260716000000–20260717000000 | Initial lobby generation, linear start, result updates, round progression, and checkmate support. |
| 20260718000000 | Late-result protection and pending-result randomization. |
| 20260720000000 | Graph nodes/edges, graph start, node finalization, and graph randomization. |
| 20260721000000 | Compact schema-v3 format normalization and graph-aware replacements. |
| 20260722000000 | Runtime graph support and the two-argument graph start/finalize APIs. |
| 20260723000000 | Safe two-phase destination reseeding for the unique seed index. |
| 20260808010000 | Discord tournament integration: guild/channel provisioning config, manager roles and invites, lobby-thread mapping, the screenshot queue and claim/lease functions, and the shared `submit_lobby_results` score boundary. |
| 20260914000000 | Per-lobby-thread score cooldown (`score_cooldown_seconds`, `last_accepted_at`, `rejected_cooldown`, `discord_score_cooldown_remaining_seconds`) and fixes for ambiguous-column bugs in `claim_discord_score_submission`, `submit_lobby_results`, `check_in_discord_player`, and a NULL-output bug in `enqueue_discord_score_submission`. |
| 20260919000000 | `get_discord_reconcile_view_model`, replacing the reconcile route's per-tournament fan-out with one read model, and skipping settled completed/cancelled tournaments. |
| 20260921000000–20260921000003 | `player_accounts` table, `claim_or_create_player_by_discord`, `link_riot_account_to_player`, `get_player_dashboard_view_model`, `playerAccountId` on the reconcile view model, and a fix for ambiguous-column bugs in the two claim/link functions. |
| 20260922000000 | `username`/`password_hash`/`last_signed_in_at` on `player_accounts`; `create_player_account`, `find_player_account_by_username`, `touch_player_account_last_signed_in`, `set_player_credentials` -- player accounts can now be created and signed into with a username/password instead of requiring Discord. |
| 20260922000001 | `link_discord_account_to_player`, `unlink_discord_account_from_player`, `check_in_player_account` -- Discord becomes an optional link on an existing account, and web check-in no longer requires one. |
| 20260922000002 | `get_player_dashboard_view_model` extended with the account's profile fields and per-tournament `check_in_status`/`checked_in`/`participated`. |

Historical overloads such as start_tournament(uuid),
start_tournament(bigint), and the old one-argument graph helpers are removed
by later migrations. Callers should use the signatures documented above.

### Retired migration-only routines

These names appeared in intermediate migrations but are not present in the
current database function catalog:

- progress_tournament_round: replaced by result-driven block generation and
  graph node finalization.
- progress_fixed_tournament_round: temporary fixed-round progression helper,
  removed with the compact graph runtime.
- generate_fixed_round_lobbies: superseded by generate_round_lobbies.
- The one-argument randomize_pending_lobby_results(tournament_id) helper:
  superseded by the graph-aware two-argument form.

They are documented here so old migration files remain understandable; new
application code must not call them.
