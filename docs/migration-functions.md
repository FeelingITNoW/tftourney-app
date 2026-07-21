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
