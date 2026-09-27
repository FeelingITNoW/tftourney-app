import type {
  TournamentGameScore,
  TournamentRound,
  TournamentScore,
  TournamentLobby,
  TournamentParticipant,
  TournamentRegistration,
  TournamentRegistrationRow,
  TournamentRoundRow,
  TournamentRow,
  TournamentSummary,
  TournamentDetailPageViewModel,
  TournamentPanelView,
  TournamentSummaryRpcItem,
  TournamentRoundProgress,
  TournamentProgressionAction,
  TournamentEdge,
  TournamentNode,
} from "./types";
import type { TournamentNodeFormat } from "@/lib/tournament/formats/types";
import { getFormatGraph, getTournamentStartRequirement } from "../../tournament/formats/api";
import { resolveCheckmateOutcome } from "../../tournament/checkmate/api";
import { buildScoresheetTabs } from "../../tournament/scoring/scoresheet";
import type { GoogleSheetExportStatus } from "../../sheets/types";
import type { TournamentDiscordConfig, TournamentCheckInState, TournamentCheckInRegistration } from "../../discord/api";

export const TOURNAMENT_STATUS_ACCEPTING_PLAYERS = "accepting_players";

export function getConfiguredRound(
  formatConfig: unknown,
  formatRoundId: string | null | undefined,
): TournamentNodeFormat | null {
  if (!formatRoundId) return null;
  return getFormatGraph(formatConfig).nodes.find((node) => node.id === formatRoundId) ?? null;
}

export function getRoundProgress(
  lobbies: TournamentLobby[],
  configuredRound: TournamentNodeFormat | null,
): TournamentRoundProgress | null {
  if (!configuredRound) {
    return null;
  }

  const checkmate = currentCheckmateCondition(configuredRound);
  const games = new Map<number, TournamentLobby[]>();
  for (const lobby of lobbies) {
    games.set(lobby.gameNumber, [...(games.get(lobby.gameNumber) ?? []), lobby]);
  }

  const completedGameNumbers = new Set(
    [...games.entries()]
      .filter(
        ([, gameLobbies]) =>
          gameLobbies.length > 0 &&
          gameLobbies.every(
            (lobby) =>
              lobby.participants.length > 0 &&
              lobby.participants.every(
                (participant) =>
                  participant.resultStatus === "confirmed" ||
                  participant.resultStatus === "corrected",
              ),
          ),
      )
      .map(([gameNumber]) => gameNumber),
  );
  const allGamesComplete = Array.from(
    { length: configuredRound.games ?? 0 },
    (_, index) => index + 1,
  ).every((gameNumber) => completedGameNumbers.has(gameNumber));
  const maxGameNumber = Math.max(...games.keys(), 0);

  if (checkmate) {
    const playerMap = new Map<string, { id: string; displayName: string; roundEntrySeed: number }>();
    const results = lobbies.flatMap((lobby) =>
      lobby.participants
        .filter((participant) => participant.placement !== null && participant.points !== null)
        .map((participant) => {
          playerMap.set(participant.id, {
            id: participant.id,
            displayName: participant.displayName,
            roundEntrySeed: participant.roundSeedNumber,
          });
          return {
            participantId: participant.id,
            gameNumber: lobby.gameNumber,
            placement: participant.placement as number,
            points: participant.points as number,
          };
        }),
    );
    const outcome = resolveCheckmateOutcome([...playerMap.values()], results, checkmate);
    const blockStart = maxGameNumber || null;
    return {
      roundFormat: "checkmate",
      completedGames: outcome.completedGames,
      configuredGames: checkmate.maxGames ?? null,
      checkmateThreshold: checkmate.threshold,
      maxGames: checkmate.maxGames ?? null,
      decisiveGame: outcome.decisiveGame,
      winnerParticipantId: outcome.winnerId,
      currentBlockStartGame: blockStart,
      currentBlockEndGame: blockStart,
      nextReseedGame: null,
      isComplete: outcome.isComplete,
    };
  }
  const blockSize =
    configuredRound.reseed > 0 ? configuredRound.reseed : (configuredRound.games ?? 1);
  const currentBlockStartGame = maxGameNumber
    ? Math.floor((maxGameNumber - 1) / blockSize) * blockSize + 1
    : null;
  const currentBlockEndGame = currentBlockStartGame
    ? Math.min(currentBlockStartGame + blockSize - 1, configuredRound.games ?? 0)
    : null;

  return {
    roundFormat: "fixed_games",
    completedGames: completedGameNumbers.size,
    configuredGames: configuredRound.games ?? 0,
    checkmateThreshold: null,
    maxGames: null,
    decisiveGame: null,
    winnerParticipantId: null,
    currentBlockStartGame,
    currentBlockEndGame,
    nextReseedGame:
      currentBlockEndGame && currentBlockEndGame < (configuredRound.games ?? 0)
        ? currentBlockEndGame + 1
        : null,
    isComplete: allGamesComplete,
  };
}

// The fixed-games counterpart to getRoundProgress's non-checkmate branch,
// sourced from game_summaries instead of the round's full lobby+participant
// data. The RPC only sends that full detail (progress_lobbies) for rounds
// with at most 8 entrants -- every other fixed-games round's progress is
// fully derivable from game_summaries, which it always sends. Not used for
// checkmate: resolving a checkmate outcome genuinely needs per-participant
// placement/points across the round, which is exactly the case
// progress_lobbies keeps covering (checkmate always has exactly 8 entrants).
export function getFixedGamesSummaryProgress(
  gameSummaries: Array<{ gameNumber: number; lobbyCount: number; completedLobbyCount: number }>,
  configuredRound: TournamentNodeFormat,
): TournamentRoundProgress {
  const completedGameNumbers = new Set(
    gameSummaries
      .filter((summary) => summary.lobbyCount > 0 && summary.completedLobbyCount === summary.lobbyCount)
      .map((summary) => summary.gameNumber),
  );
  const maxGameNumber = Math.max(0, ...gameSummaries.map((summary) => summary.gameNumber));
  const allGamesComplete = Array.from(
    { length: configuredRound.games ?? 0 },
    (_, index) => index + 1,
  ).every((gameNumber) => completedGameNumbers.has(gameNumber));
  const blockSize =
    configuredRound.reseed > 0 ? configuredRound.reseed : (configuredRound.games ?? 1);
  const currentBlockStartGame = maxGameNumber
    ? Math.floor((maxGameNumber - 1) / blockSize) * blockSize + 1
    : null;
  const currentBlockEndGame = currentBlockStartGame
    ? Math.min(currentBlockStartGame + blockSize - 1, configuredRound.games ?? 0)
    : null;

  return {
    roundFormat: "fixed_games",
    completedGames: completedGameNumbers.size,
    configuredGames: configuredRound.games ?? 0,
    checkmateThreshold: null,
    maxGames: null,
    decisiveGame: null,
    winnerParticipantId: null,
    currentBlockStartGame,
    currentBlockEndGame,
    nextReseedGame:
      currentBlockEndGame && currentBlockEndGame < (configuredRound.games ?? 0)
        ? currentBlockEndGame + 1
        : null,
    isComplete: allGamesComplete,
  };
}

export function currentCheckmateCondition(
  configuredRound: TournamentNodeFormat,
): Extract<NonNullable<TournamentNodeFormat["winCondition"]>, { type: "checkmate" }> | null {
  return configuredRound.winCondition?.type === "checkmate"
    ? configuredRound.winCondition
    : null;
}

export function mapTournamentRow(row: TournamentRow): Omit<
  TournamentSummary,
  "registeredPlayerCount"
> {
  return {
    id: String(row.id),
    hostUserId: String(row.host_user_id ?? 1),
    name: row.name,
    playerCount: row.max_players,
    formatId: row.format_id,
    status: row.status,
    hasStarted: row.status !== TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
    currentRoundId:
      row.current_round_id === null ? null : String(row.current_round_id),
    currentRoundNumber: null,
    activeNodeIds: row.current_round_id === null ? [] : [String(row.current_round_id)],
    createdAt: row.created_at,
  };
}

export function mapTournamentSummaryRpcItem(
  row: TournamentSummaryRpcItem,
): TournamentSummary {
  return {
    id: String(row.id),
    hostUserId: String(row.host_user_id),
    name: row.name,
    playerCount: row.max_players,
    formatId: row.format_id,
    status: row.status,
    hasStarted: row.has_started,
    currentRoundId:
      row.current_round_id === null ? null : String(row.current_round_id),
    currentRoundNumber: row.current_round_number,
    activeNodeIds: Array.isArray(row.active_node_ids)
      ? row.active_node_ids.map(String)
      : [],
    createdAt: row.created_at,
    registeredPlayerCount: row.registered_player_count,
  };
}

export function mapTournamentRegistrationRow(
  row: TournamentRegistrationRow,
): TournamentRegistration {
  return {
    id: String(row.id),
    displayName: row.display_name ?? row.riot_puuid ?? "Unknown player",
    registrationStatus: row.registration_status,
    createdAt: row.created_at,
  };
}

export function mapTournamentRound(
  row: TournamentRoundRow,
  formatConfig: unknown,
  graph = getFormatGraph(formatConfig),
): TournamentRound {
  const configuredRound = getConfiguredRound(formatConfig, row.format_round_id);
  return {
    id: String(row.id),
    roundNumber: row.round_number,
    formatNodeId: row.format_round_id,
    name:
      row.stage_name ??
      graph.nodes.find((node) => node.id === row.format_round_id)?.name ??
      row.format_round_id,
    isCheckmate: configuredRound?.winCondition?.type === "checkmate",
    configuredGames: configuredRound?.games ?? null,
    status: row.status,
  };
}

export function tournamentIsGraphFormat(formatConfig: unknown): boolean {
  return (
    typeof formatConfig === "object" &&
    formatConfig !== null &&
    Array.isArray((formatConfig as { nodes?: unknown }).nodes)
  );
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

// The get_*_view_model RPCs this maps all emit snake_case keys only (verified
// against every route-scoped view model in supabase/migrations/); there is no
// camelCase fallback to check.
export function valueAt(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

export function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function mapRpcRegistration(value: unknown): TournamentRegistration {
  const row = asRecord(value);
  return {
    id: asString(valueAt(row, "id")),
    displayName: asString(valueAt(row, "display_name"), "Unknown player"),
    registrationStatus: (valueAt(row, "registration_status") ?? "registered") as TournamentRegistration["registrationStatus"],
    createdAt: asString(valueAt(row, "created_at")),
  };
}

export function mapRpcParticipant(value: unknown): TournamentParticipant {
  const row = asRecord(value);
  return {
    id: asString(valueAt(row, "id")),
    registrationId: asString(valueAt(row, "registration_id")),
    displayName: asString(valueAt(row, "display_name_at_start"), "Unknown player"),
    seedNumber: asNumber(valueAt(row, "seed_number")),
    createdAt: asString(valueAt(row, "created_at")),
  };
}

export function mapRpcRound(value: unknown, formatConfig: unknown): TournamentRound {
  const row = asRecord(value);
  return mapTournamentRound(
    {
      id: asString(valueAt(row, "id")),
      tournament_id: valueAt(row, "tournament_id") as string | number | undefined,
      round_number: asNumber(valueAt(row, "round_number")),
      format_round_id: (valueAt(row, "format_round_id") ?? null) as string | null,
      stage_name: (valueAt(row, "stage_name") ?? null) as string | null,
      status: (valueAt(row, "status") ?? "pending") as TournamentRoundRow["status"],
    },
    formatConfig,
  );
}

export function mapRpcScore(value: unknown, participantById: Map<string, TournamentParticipant>): TournamentScore | null {
  const row = asRecord(value);
  const participantId = asString(valueAt(row, "participant_id"));
  const participant = participantById.get(participantId) ?? {
    id: participantId,
    registrationId: "",
    displayName: asString(valueAt(row, "display_name"), "Unknown player"),
    seedNumber: asNumber(valueAt(row, "seed_number")),
    createdAt: "",
  };
  return {
    id: asString(valueAt(row, "id"), `${participantId}:${asString(valueAt(row, "round_id"))}`),
    participantId,
    displayName: participant.displayName,
    seedNumber: participant.seedNumber,
    roundId: asString(valueAt(row, "round_id")),
    roundSeedNumber: asNumber(valueAt(row, "round_seed_number"), participant.seedNumber),
    score: asNumber(valueAt(row, "score")),
    sourceEdgeId: valueAt(row, "source_edge_id") == null ? null : asString(valueAt(row, "source_edge_id")),
    sourceRank: valueAt(row, "source_rank") == null ? null : asNumber(valueAt(row, "source_rank")),
    createdAt: asString(valueAt(row, "created_at")),
  };
}

export function mapRpcGameScore(value: unknown, participantById: Map<string, TournamentParticipant>): TournamentGameScore | null {
  const row = asRecord(value);
  const participantId = asString(valueAt(row, "participant_id"));
  const participant = participantById.get(participantId) ?? {
    id: participantId,
    registrationId: "",
    displayName: asString(valueAt(row, "display_name"), "Unknown player"),
    seedNumber: asNumber(valueAt(row, "seed_number")),
    createdAt: "",
  };
  const score = valueAt(row, "score");
  return {
    participantId,
    displayName: participant.displayName,
    seedNumber: participant.seedNumber,
    roundId: asString(valueAt(row, "round_id")),
    gameNumber: asNumber(valueAt(row, "game_number")),
    placement: valueAt(row, "placement") == null ? null : asNumber(valueAt(row, "placement")),
    score: score == null ? null : asNumber(score),
  };
}

export function mapRpcLobby(value: unknown, participantById: Map<string, TournamentParticipant>, scoreByParticipantRound: Map<string, TournamentScore>): TournamentLobby {
  const row = asRecord(value);
  const roundId = asString(valueAt(row, "round_id"));
  const participants = asArray(valueAt(row, "participants"))
    .map((entry) => {
      const participantRow = asRecord(entry);
      const id = asString(valueAt(participantRow, "participant_id") ?? valueAt(participantRow, "id"));
      const participant = participantById.get(id) ?? {
        id,
        registrationId: "",
        displayName: asString(valueAt(participantRow, "display_name"), "Unknown player"),
        seedNumber: asNumber(valueAt(participantRow, "seed_number")),
        createdAt: "",
      };
      const score = scoreByParticipantRound.get(`${id}:${roundId}`);
      return {
        id,
        displayName: asString(valueAt(participantRow, "display_name"), participant.displayName),
        seedNumber: asNumber(valueAt(participantRow, "seed_number"), participant.seedNumber),
        roundSeedNumber: asNumber(valueAt(participantRow, "round_seed_number"), score?.roundSeedNumber ?? participant.seedNumber),
        slotNumber: asNumber(valueAt(participantRow, "slot_number")),
        placement: valueAt(participantRow, "placement") == null ? null : asNumber(valueAt(participantRow, "placement")),
        points: valueAt(participantRow, "points") == null ? null : asNumber(valueAt(participantRow, "points")),
        resultStatus: (valueAt(participantRow, "result_status") ?? "pending") as TournamentLobby["participants"][number]["resultStatus"],
      };
    })
    .filter((participant): participant is TournamentLobby["participants"][number] => participant !== null)
    .sort((first, second) => first.slotNumber - second.slotNumber);
  return {
    id: asString(valueAt(row, "id")),
    roundId,
    gameNumber: asNumber(valueAt(row, "game_number")),
    lobbyNumber: asNumber(valueAt(row, "lobby_number")),
    participants,
  };
}

export function mapRpcEdge(value: unknown): TournamentEdge {
  const row = asRecord(value);
  return {
    id: asString(valueAt(row, "id")),
    formatEdgeId: asString(valueAt(row, "format_edge_id"), asString(valueAt(row, "id"))),
    sourceNodeId: asString(valueAt(row, "source_round_id")),
    destinationNodeId: asString(valueAt(row, "destination_round_id")),
    priority: asNumber(valueAt(row, "priority"), 1),
    condition: valueAt(row, "condition") ?? null,
    status: (valueAt(row, "status") ?? "pending") as TournamentEdge["status"],
    advancedPlayerCount: asNumber(valueAt(row, "advanced_player_count")),
  };
}

export function mapRpcNode(value: unknown, formatConfig: unknown): TournamentNode {
  const row = asRecord(value);
  const round = mapRpcRound(value, formatConfig);
  return {
    ...round,
    entrantCount: asNumber(valueAt(row, "entrant_count")),
    completedGames: asNumber(valueAt(row, "completed_games")),
    configuredGames: valueAt(row, "configured_games") == null ? round.configuredGames ?? null : asNumber(valueAt(row, "configured_games")),
    position: (valueAt(row, "position") ?? null) as TournamentNode["position"],
  };
}

export function mapRpcProgress(value: unknown): TournamentRoundProgress | null {
  if (!value) return null;
  const row = asRecord(value);
  return {
    roundFormat: (valueAt(row, "round_format") ?? "fixed_games") as TournamentRoundProgress["roundFormat"],
    completedGames: asNumber(valueAt(row, "completed_games")),
    configuredGames: valueAt(row, "configured_games") == null ? null : asNumber(valueAt(row, "configured_games")),
    checkmateThreshold: valueAt(row, "checkmate_threshold") == null ? null : asNumber(valueAt(row, "checkmate_threshold")),
    maxGames: valueAt(row, "max_games") == null ? null : asNumber(valueAt(row, "max_games")),
    decisiveGame: valueAt(row, "decisive_game") == null ? null : asNumber(valueAt(row, "decisive_game")),
    winnerParticipantId: valueAt(row, "winner_participant_id") == null ? null : asString(valueAt(row, "winner_participant_id")),
    currentBlockStartGame: valueAt(row, "current_block_start_game") == null ? null : asNumber(valueAt(row, "current_block_start_game")),
    currentBlockEndGame: valueAt(row, "current_block_end_game") == null ? null : asNumber(valueAt(row, "current_block_end_game")),
    nextReseedGame: valueAt(row, "next_reseed_game") == null ? null : asNumber(valueAt(row, "next_reseed_game")),
    isComplete: asBoolean(valueAt(row, "is_complete")),
  };
}

export function mapRpcSheetStatus(value: unknown): GoogleSheetExportStatus | null {
  if (!value) return null;
  const row = asRecord(value);
  const lastError = valueAt(row, "last_error");
  return {
    tournamentId: asString(valueAt(row, "tournament_id")),
    connectionState: (valueAt(row, "connection_state") ?? "disconnected") as GoogleSheetExportStatus["connectionState"],
    state: (valueAt(row, "state") ?? "not_created") as GoogleSheetExportStatus["state"],
    spreadsheetId: (valueAt(row, "spreadsheet_id") ?? null) as string | null,
    spreadsheetUrl: (valueAt(row, "spreadsheet_url") ?? null) as string | null,
    desiredRevision: asNumber(valueAt(row, "desired_revision")),
    syncedRevision: asNumber(valueAt(row, "synced_revision")),
    dirtyAt: (valueAt(row, "dirty_at") ?? null) as string | null,
    lastSyncedAt: (valueAt(row, "last_synced_at") ?? null) as string | null,
    nextAttemptAt: (valueAt(row, "next_attempt_at") ?? null) as string | null,
    lastError: lastError
      ? { code: asString(valueAt(asRecord(lastError), "code"), "SHEET_EXPORT_ERROR"), message: asString(valueAt(asRecord(lastError), "message"), "Sheet export failed.") }
      : valueAt(row, "last_error_code") || valueAt(row, "last_error_message")
        ? { code: asString(valueAt(row, "last_error_code"), "SHEET_EXPORT_ERROR"), message: asString(valueAt(row, "last_error_message"), "Sheet export failed.") }
        : null,
  };
}

export function mapRpcDiscordConfig(value: unknown): TournamentDiscordConfig | null {
  if (!value) return null;
  const row = asRecord(value);
  return {
    tournamentId: asString(valueAt(row, "tournament_id")),
    guildId: asString(valueAt(row, "guild_id")),
    guildName: (valueAt(row, "guild_name") ?? null) as string | null,
    categoryId: (valueAt(row, "category_id") ?? null) as string | null,
    signupChannelId: (valueAt(row, "signup_channel_id") ?? null) as string | null,
    checkinChannelId: (valueAt(row, "checkin_channel_id") ?? null) as string | null,
    scoreChannelId: (valueAt(row, "score_channel_id") ?? null) as string | null,
    managerRoleId: (valueAt(row, "manager_role_id") ?? null) as string | null,
    signupMessageId: (valueAt(row, "signup_message_id") ?? null) as string | null,
    checkinMessageId: (valueAt(row, "checkin_message_id") ?? null) as string | null,
    state: (valueAt(row, "state") ?? "pending") as TournamentDiscordConfig["state"],
    lastError: (valueAt(row, "last_error") ?? null) as string | null,
    lastHeartbeatAt: (valueAt(row, "last_heartbeat_at") ?? null) as string | null,
    createdAt: (valueAt(row, "created_at") ?? null) as string | null,
    updatedAt: (valueAt(row, "updated_at") ?? null) as string | null,
    cleanupAction: (valueAt(row, "cleanup_action") ?? null) as TournamentDiscordConfig["cleanupAction"],
    cleanupRequestedAt: (valueAt(row, "cleanup_requested_at") ?? null) as string | null,
    cleanupCompletedAt: (valueAt(row, "cleanup_completed_at") ?? null) as string | null,
  };
}

export function mapRpcCheckInState(value: unknown): TournamentCheckInState | null {
  if (!value) return null;
  const row = asRecord(value);
  return {
    status: (valueAt(row, "status") ?? "not_started") as TournamentCheckInState["status"],
    openedAt: (valueAt(row, "opened_at") ?? null) as string | null,
    closedAt: (valueAt(row, "closed_at") ?? null) as string | null,
    registeredCount: asNumber(valueAt(row, "registered_count")),
    checkedInCount: asNumber(valueAt(row, "checked_in_count")),
    checkedInRegisteredCount: asNumber(valueAt(row, "checked_in_registered_count")),
    registrations: asArray(valueAt(row, "registrations")).map((entry) => {
      const registrationRow = asRecord(entry);
      return {
        registrationId: asString(valueAt(registrationRow, "registration_id")),
        displayName: asString(valueAt(registrationRow, "display_name"), "Unknown player"),
        registrationStatus: (valueAt(registrationRow, "registration_status") ?? "registered") as TournamentCheckInRegistration["registrationStatus"],
        checkedInAt: (valueAt(registrationRow, "checked_in_at") ?? null) as string | null,
        hasDiscord: asBoolean(valueAt(registrationRow, "has_discord")),
      };
    }),
  };
}

export function mapRoutePageViewModel(rawValue: unknown): TournamentDetailPageViewModel {
  const raw = asRecord(rawValue);
  const tournament = asRecord(valueAt(raw, "tournament"));
  const formatConfig = valueAt(tournament, "format_config") ?? valueAt(raw, "format_config");
  const summary = mapTournamentSummaryRpcItem({
    id: asString(valueAt(tournament, "id") ?? valueAt(raw, "id")),
    host_user_id: asString(valueAt(tournament, "host_user_id") ?? valueAt(raw, "host_user_id")),
    name: asString(valueAt(tournament, "name") ?? valueAt(raw, "name")),
    max_players: asNumber(valueAt(tournament, "max_players") ?? valueAt(raw, "max_players")),
    format_id: asString(valueAt(tournament, "format_id") ?? valueAt(raw, "format_id")),
    status: (valueAt(tournament, "status") ?? valueAt(raw, "status") ?? "accepting_players") as TournamentSummary["status"],
    has_started: asBoolean(valueAt(tournament, "has_started") ?? valueAt(raw, "has_started")),
    current_round_id: (valueAt(tournament, "current_round_id") ?? valueAt(raw, "current_round_id") ?? null) as string | null,
    current_round_number: valueAt(tournament, "current_round_number") == null ? null : asNumber(valueAt(tournament, "current_round_number")),
    active_node_ids: asArray(valueAt(raw, "active_node_ids")).map(String),
    created_at: asString(valueAt(tournament, "created_at") ?? valueAt(raw, "created_at")),
    registered_player_count: asNumber(valueAt(tournament, "registered_player_count")),
  });
  const rounds = asArray(valueAt(raw, "rounds")).map((round) => mapRpcRound(round, formatConfig));
  const nodes = asArray(valueAt(raw, "nodes")).map((node) => mapRpcNode(node, formatConfig));
  const graph = getFormatGraph(formatConfig);
  const fallbackNodes = nodes.length
    ? nodes
    : rounds.length
      ? rounds.map((round) => ({ ...round, entrantCount: 0, completedGames: 0, configuredGames: round.configuredGames ?? null, position: null }))
      : graph.nodes.map((node, index) => ({
          id: node.id,
          roundNumber: index + 1,
          formatNodeId: node.id,
          name: node.name,
          isCheckmate: node.winCondition?.type === "checkmate",
          status: "pending" as const,
          entrantCount: 0,
          completedGames: 0,
          configuredGames: node.games ?? null,
          position: node.position ?? null,
        }));
  const edges = asArray(valueAt(raw, "edges")).map(mapRpcEdge);
  const fallbackEdges = edges.length ? edges : graph.edges.map((edge) => ({
    id: edge.id,
    formatEdgeId: edge.id,
    sourceNodeId: edge.sourceNodeId,
    destinationNodeId: edge.destinationNodeId,
    priority: edge.priority,
    condition: edge.condition,
    status: "pending" as const,
    advancedPlayerCount: 0,
  }));
  const requestedPanelView = valueAt(raw, "view") ?? valueAt(asRecord(valueAt(raw, "panel")), "view") ?? valueAt(asRecord(valueAt(raw, "panel")), "type");
  const view: TournamentPanelView = ["lobbies", "scoresheet", "graph", "details"].includes(String(requestedPanelView))
    ? String(requestedPanelView) as TournamentPanelView
    : summary.hasStarted ? "lobbies" : "details";
  const participants = asArray(valueAt(raw, "participants")).map(mapRpcParticipant);
  const registrations = asArray(valueAt(raw, "registrations")).map(mapRpcRegistration);
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const scores = asArray(valueAt(raw, "scores")).map((score) => mapRpcScore(score, participantById)).filter((score): score is TournamentScore => score !== null);
  const scoreByParticipantRound = new Map(scores.map((score) => [`${score.participantId}:${score.roundId}`, score]));
  const gameScores = asArray(valueAt(raw, "game_scores")).map((score) => mapRpcGameScore(score, participantById)).filter((score): score is TournamentGameScore => score !== null);
  let panel: TournamentDetailPageViewModel["panel"];
  if (view === "scoresheet") {
    panel = { view, tabs: buildScoresheetTabs(rounds, scores, gameScores) };
  } else if (view === "graph") {
    panel = { view, nodes: fallbackNodes, edges: fallbackEdges };
  } else if (view === "details") {
    panel = { view, registrations, participants };
  } else {
    const lobbyPanel = asRecord(valueAt(raw, "panel"));
    const lobbies = asArray(valueAt(lobbyPanel, "lobbies") ?? valueAt(raw, "lobbies")).map((lobby) => mapRpcLobby(lobby, participantById, scoreByParticipantRound));
    const progressLobbies = asArray(valueAt(lobbyPanel, "progress_lobbies")).map((lobby) => mapRpcLobby(lobby, participantById, scoreByParticipantRound));
    const selectedRound = rounds.find((round) => round.id === asString(valueAt(lobbyPanel, "round_id"))) ?? rounds.find((round) => round.id === summary.currentRoundId) ?? rounds.find((round) => round.status === "active") ?? null;
    const configuredRound = selectedRound ? getConfiguredRound(formatConfig, selectedRound.formatNodeId) : null;
    const progress = mapRpcProgress(valueAt(lobbyPanel, "round_progress"));
    const gameSummaries = asArray(valueAt(lobbyPanel, "game_summaries")).map((entry) => {
      const row = asRecord(entry);
      return { gameNumber: asNumber(valueAt(row, "game_number")), lobbyCount: asNumber(valueAt(row, "lobby_count")), completedLobbyCount: asNumber(valueAt(row, "completed_lobby_count")) };
    });
    const resolvedProgress = progress ?? (configuredRound
      ? currentCheckmateCondition(configuredRound)
        ? getRoundProgress(progressLobbies.length ? progressLobbies : lobbies, configuredRound)
        : getFixedGamesSummaryProgress(gameSummaries, configuredRound)
      : null);
    panel = {
      view,
      round: selectedRound,
      lobbies,
      gameSummaries,
      selectedGameNumber: valueAt(lobbyPanel, "selected_game_number") == null ? (gameSummaries[0]?.gameNumber ?? null) : asNumber(valueAt(lobbyPanel, "selected_game_number")),
      page: asNumber(valueAt(lobbyPanel, "page"), 1),
      pageSize: asNumber(valueAt(lobbyPanel, "page_size"), 8),
      totalCount: asNumber(valueAt(lobbyPanel, "total_count"), lobbies.length),
      totalPages: Math.max(1, asNumber(valueAt(lobbyPanel, "total_pages"), 1)),
      roundProgress: resolvedProgress,
      progressionAction: (valueAt(lobbyPanel, "progression_action") ?? (summary.status === "in_progress" && selectedRound?.status === "active" && resolvedProgress?.isComplete && tournamentIsGraphFormat(formatConfig) ? "finalize_node" : null)) as TournamentProgressionAction,
    };
  }
  return {
    ...summary,
    currentRoundNumber: summary.currentRoundNumber ?? rounds.find((round) => round.id === summary.currentRoundId)?.roundNumber ?? null,
    formatConfig,
    startRequirement: getTournamentStartRequirement(formatConfig),
    rounds,
    nodes: fallbackNodes,
    edges: fallbackEdges,
    activeNodeIds: asArray(valueAt(raw, "active_node_ids")).map(String),
    selectedNodeId: (valueAt(raw, "selected_node_id") ?? null) as string | null,
    sheetStatus: mapRpcSheetStatus(valueAt(raw, "sheet_status") ?? valueAt(raw, "google_sheet_status")),
    discordConfig: mapRpcDiscordConfig(valueAt(raw, "discord_config")),
    checkInState: mapRpcCheckInState(valueAt(raw, "check_in_state")),
    panel,
  };
}
