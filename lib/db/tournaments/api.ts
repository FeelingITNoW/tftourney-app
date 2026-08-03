import {
  DatabaseRequestError,
  supabaseRestRequest,
} from "../supabase-rest/api";
import { unstable_cache } from "next/cache";
import type {
  CreateTournamentInput,
  DeleteTournamentInput,
  RegisterTournamentPlayerInput,
  StartTournamentInput,
  StartTournamentResult,
  TournamentDetail,
  TournamentOverview,
  TournamentRoundDetail,
  TournamentLobbyDetail,
  TournamentLobbyRoster,
  TournamentLobbyRosterParticipant,
  TournamentGameScore,
  TournamentRound,
  TournamentScore,
  TournamentLobby,
  TournamentLobbyParticipantRow,
  TournamentLobbyRow,
  TournamentParticipant,
  TournamentParticipantRow,
  TournamentRegistration,
  TournamentRegistrationRow,
  TournamentRoundRow,
  TournamentScoreRow,
  TournamentRow,
  TournamentSummary,
  TournamentListPageViewModel,
  TournamentDetailPageViewModel,
  TournamentLobbyPageViewModel,
  TournamentExportViewModel,
  TournamentPanelView,
  TournamentSummaryRpcItem,
  TournamentSummaryRpcRow,
  TournamentRoundProgress,
  TournamentProgressionAction,
  TournamentEdge,
  TournamentEdgeRow,
  TournamentNode,
  AddRandomSeededTournamentPlayersInput,
  AddRandomSeededTournamentPlayersResult,
  FinalizeTournamentNodeInput,
  FinalizeTournamentNodeResult,
  RandomizePendingLobbyResultsResult,
  RandomizePendingLobbyResultsInput,
  UpdateLobbyResultsInput,
  UpdateLobbyResultsResult,
} from "./types";
import type { TournamentNodeFormat } from "@/lib/tournament/formats/types";
import { canonicalizeTournamentFormat, getFormatGraph, getTournamentStartRequirement } from "../../tournament/formats/api";
import { resolveCheckmateOutcome } from "../../tournament/checkmate/api";
import {
  getRiotAccountByRiotId,
  RiotAccountNotFoundError,
} from "../../riot/accounts/api";
import { SEEDED_RIOT_IDS, selectRandomSeededRiotIds } from "../../riot/accounts/seed";
import { parseRiotGameTag } from "../../tournament/players/api";
import { buildScoresheetTabs } from "../../tournament/scoring/scoresheet";
import type { GoogleSheetExportStatus } from "../../sheets/types";

export const TOURNAMENT_STATUS_ACCEPTING_PLAYERS = "accepting_players";
export const TOURNAMENT_PAGE_SIZE = 10;

const tournamentSelect =
  "id,host_user_id,name,max_players,format_id,status,current_round_id,format_config,created_at";

const LOBBY_PARTICIPANT_BATCH_SIZE = 64;

function splitIntoBatches<T>(values: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }

  return batches;
}

async function fetchLobbyParticipants(
  lobbyIds: Array<string | number>,
): Promise<TournamentLobbyParticipantRow[]> {
  const batches = splitIntoBatches(lobbyIds, LOBBY_PARTICIPANT_BATCH_SIZE);
  const participantBatches = await Promise.all(
    batches.map((batch) =>
      supabaseRestRequest<TournamentLobbyParticipantRow[]>(
        "lobby_participants",
        {
          query: {
            select:
              "id,lobby_id,participant_id,slot_number,placement,points,result_status",
            lobby_id: `in.(${batch.join(",")})`,
            order: "lobby_id.asc,slot_number.asc,id.asc",
          },
        },
      ),
    ),
  );

  return participantBatches.flat();
}

function getConfiguredRound(
  formatConfig: unknown,
  formatRoundId: string | null | undefined,
): TournamentNodeFormat | null {
  if (!formatRoundId) return null;
  return getFormatGraph(formatConfig).nodes.find((node) => node.id === formatRoundId) ?? null;
}

function getRoundProgress(
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

function currentCheckmateCondition(
  configuredRound: TournamentNodeFormat,
): Extract<NonNullable<TournamentNodeFormat["winCondition"]>, { type: "checkmate" }> | null {
  return configuredRound.winCondition?.type === "checkmate"
    ? configuredRound.winCondition
    : null;
}

function mapTournamentRow(row: TournamentRow): Omit<
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

function mapTournamentSummaryRpcItem(
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

function mapTournamentEdgeRow(row: TournamentEdgeRow): TournamentEdge {
  return {
    id: String(row.id),
    formatEdgeId: row.format_edge_id,
    sourceNodeId: String(row.source_round_id),
    destinationNodeId: String(row.destination_round_id),
    priority: row.priority,
    condition: row.condition,
    status: row.status,
    advancedPlayerCount: row.advanced_player_count,
  };
}

function mapTournamentRegistrationRow(
  row: TournamentRegistrationRow,
): TournamentRegistration {
  return {
    id: String(row.id),
    displayName: row.display_name ?? row.riot_puuid ?? "Unknown player",
    registrationStatus: row.registration_status,
    createdAt: row.created_at,
  };
}

function mapTournamentParticipantRow(
  row: TournamentParticipantRow,
): TournamentParticipant {
  return {
    id: row.id,
    registrationId: String(row.registration_id),
    displayName: row.display_name_at_start,
    seedNumber: row.seed_number,
    createdAt: row.created_at,
  };
}

export async function createTournament(
  input: CreateTournamentInput,
): Promise<TournamentSummary> {
  const rows = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    method: "POST",
    query: {
      select: tournamentSelect,
    },
    prefer: "return=representation",
    body: {
      host_user_id: input.hostUserId,
      name: input.name,
      max_players: input.playerCount,
      format_id: input.formatId,
      format_config: (() => {
        const canonical = canonicalizeTournamentFormat(input.formatConfig);
        if (!canonical) throw new Error("Invalid tournament format configuration.");
        return canonical;
      })(),
      status: TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
    },
  });

  const tournament = rows[0];

  if (!tournament) {
    throw new Error("Database did not return the created tournament.");
  }

  return {
    ...mapTournamentRow(tournament),
    registeredPlayerCount: 0,
  };
}

export async function deleteTournament(
  input: DeleteTournamentInput,
): Promise<void> {
  const deletedTournaments = await supabaseRestRequest<
    Pick<TournamentRow, "id">[]
  >("tournaments", {
    method: "DELETE",
    query: {
      id: `eq.${input.tournamentId}`,
      select: "id",
    },
    prefer: "return=representation",
  });

  if (!deletedTournaments?.length) {
    throw new Error("Tournament was not found.");
  }
}

export type TournamentListOptions = {
  page?: number;
  pageSize?: number;
  hostUserId?: string;
};

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
}

export async function listTournaments(
  options: TournamentListOptions = {},
): Promise<TournamentListPageViewModel> {
  const page = normalizePositiveInteger(options.page, 1);
  const pageSize = Math.min(
    normalizePositiveInteger(options.pageSize, TOURNAMENT_PAGE_SIZE),
    100,
  );
  const rows = await supabaseRestRequest<TournamentSummaryRpcRow[]>(
    "rpc/list_tournament_summaries",
    {
      method: "POST",
      body: {
        p_page: page,
        p_page_size: pageSize,
        p_host_user_id: options.hostUserId ?? null,
      },
    },
  );
  const row = rows[0];

  if (!row) {
    throw new Error("Database did not return the tournament list.");
  }

  const totalCount = Number(row.total_count);
  const returnedPage = Number(row.page);
  const returnedPageSize = Number(row.page_size);
  const totalPages = Math.max(1, Number(row.total_pages));

  return {
    items: Array.isArray(row.items)
      ? row.items.map(mapTournamentSummaryRpcItem)
      : [],
    page: Number.isSafeInteger(returnedPage) && returnedPage > 0 ? returnedPage : page,
    pageSize:
      Number.isSafeInteger(returnedPageSize) && returnedPageSize > 0
        ? returnedPageSize
        : pageSize,
    totalCount: Number.isFinite(totalCount) && totalCount >= 0 ? totalCount : 0,
    totalPages: Number.isSafeInteger(totalPages) ? totalPages : 1,
  };
}

export async function listHostedTournaments(
  hostUserId: string,
  options: Omit<TournamentListOptions, "hostUserId"> = {},
): Promise<TournamentListPageViewModel> {
  return listTournaments({ ...options, hostUserId });
}

type RouteViewModelRpcRow = { view_model?: unknown };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function valueAt(record: Record<string, unknown>, snake: string, camel = snake): unknown {
  return record[camel] ?? record[snake];
}

function asString(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapRpcRegistration(value: unknown): TournamentRegistration {
  const row = asRecord(value);
  return {
    id: asString(valueAt(row, "id")),
    displayName: asString(valueAt(row, "display_name", "displayName"), "Unknown player"),
    registrationStatus: (valueAt(row, "registration_status", "registrationStatus") ?? "registered") as TournamentRegistration["registrationStatus"],
    createdAt: asString(valueAt(row, "created_at", "createdAt")),
  };
}

function mapRpcParticipant(value: unknown): TournamentParticipant {
  const row = asRecord(value);
  return {
    id: asString(valueAt(row, "id")),
    registrationId: asString(valueAt(row, "registration_id", "registrationId")),
    displayName: asString(valueAt(row, "display_name_at_start", "displayName"), "Unknown player"),
    seedNumber: asNumber(valueAt(row, "seed_number", "seedNumber")),
    createdAt: asString(valueAt(row, "created_at", "createdAt")),
  };
}

function mapRpcRound(value: unknown, formatConfig: unknown): TournamentRound {
  const row = asRecord(value);
  return mapTournamentRound(
    {
      id: asString(valueAt(row, "id")),
      tournament_id: valueAt(row, "tournament_id", "tournamentId") as string | number | undefined,
      round_number: asNumber(valueAt(row, "round_number", "roundNumber")),
      format_round_id: (valueAt(row, "format_round_id", "formatNodeId") ?? null) as string | null,
      stage_name: (valueAt(row, "stage_name", "name") ?? null) as string | null,
      status: (valueAt(row, "status") ?? "pending") as TournamentRoundRow["status"],
    },
    formatConfig,
  );
}

function mapRpcScore(value: unknown, participantById: Map<string, TournamentParticipant>): TournamentScore | null {
  const row = asRecord(value);
  const participantId = asString(valueAt(row, "participant_id", "participantId"));
  const participant = participantById.get(participantId) ?? {
    id: participantId,
    registrationId: "",
    displayName: asString(valueAt(row, "display_name", "displayName"), "Unknown player"),
    seedNumber: asNumber(valueAt(row, "seed_number", "seedNumber")),
    createdAt: "",
  };
  return {
    id: asString(valueAt(row, "id"), `${participantId}:${asString(valueAt(row, "round_id", "roundId"))}`),
    participantId,
    displayName: participant.displayName,
    seedNumber: participant.seedNumber,
    roundId: asString(valueAt(row, "round_id", "roundId")),
    roundSeedNumber: asNumber(valueAt(row, "round_seed_number", "roundSeedNumber"), participant.seedNumber),
    score: asNumber(valueAt(row, "score")),
    sourceEdgeId: valueAt(row, "source_edge_id", "sourceEdgeId") == null ? null : asString(valueAt(row, "source_edge_id", "sourceEdgeId")),
    sourceRank: valueAt(row, "source_rank", "sourceRank") == null ? null : asNumber(valueAt(row, "source_rank", "sourceRank")),
    createdAt: asString(valueAt(row, "created_at", "createdAt")),
  };
}

function mapRpcGameScore(value: unknown, participantById: Map<string, TournamentParticipant>): TournamentGameScore | null {
  const row = asRecord(value);
  const participantId = asString(valueAt(row, "participant_id", "participantId"));
  const participant = participantById.get(participantId) ?? {
    id: participantId,
    registrationId: "",
    displayName: asString(valueAt(row, "display_name", "displayName"), "Unknown player"),
    seedNumber: asNumber(valueAt(row, "seed_number", "seedNumber")),
    createdAt: "",
  };
  const score = valueAt(row, "score");
  return {
    participantId,
    displayName: participant.displayName,
    seedNumber: participant.seedNumber,
    roundId: asString(valueAt(row, "round_id", "roundId")),
    gameNumber: asNumber(valueAt(row, "game_number", "gameNumber")),
    placement: valueAt(row, "placement") == null ? null : asNumber(valueAt(row, "placement")),
    score: score == null ? null : asNumber(score),
  };
}

function mapRpcLobby(value: unknown, participantById: Map<string, TournamentParticipant>, scoreByParticipantRound: Map<string, TournamentScore>): TournamentLobby {
  const row = asRecord(value);
  const roundId = asString(valueAt(row, "round_id", "roundId"));
  const participants = asArray(valueAt(row, "participants"))
    .map((entry) => {
      const participantRow = asRecord(entry);
      const id = asString(valueAt(participantRow, "participant_id", "participantId") ?? valueAt(participantRow, "id"));
      const participant = participantById.get(id) ?? {
        id,
        registrationId: "",
        displayName: asString(valueAt(participantRow, "display_name", "displayName"), "Unknown player"),
        seedNumber: asNumber(valueAt(participantRow, "seed_number", "seedNumber")),
        createdAt: "",
      };
      const score = scoreByParticipantRound.get(`${id}:${roundId}`);
      return {
        id,
        displayName: asString(valueAt(participantRow, "display_name", "displayName"), participant.displayName),
        seedNumber: asNumber(valueAt(participantRow, "seed_number", "seedNumber"), participant.seedNumber),
        roundSeedNumber: asNumber(valueAt(participantRow, "round_seed_number", "roundSeedNumber"), score?.roundSeedNumber ?? participant.seedNumber),
        slotNumber: asNumber(valueAt(participantRow, "slot_number", "slotNumber")),
        placement: valueAt(participantRow, "placement") == null ? null : asNumber(valueAt(participantRow, "placement")),
        points: valueAt(participantRow, "points") == null ? null : asNumber(valueAt(participantRow, "points")),
        resultStatus: (valueAt(participantRow, "result_status", "resultStatus") ?? "pending") as TournamentLobby["participants"][number]["resultStatus"],
      };
    })
    .filter((participant): participant is TournamentLobby["participants"][number] => participant !== null)
    .sort((first, second) => first.slotNumber - second.slotNumber);
  return {
    id: asString(valueAt(row, "id")),
    roundId,
    gameNumber: asNumber(valueAt(row, "game_number", "gameNumber")),
    lobbyNumber: asNumber(valueAt(row, "lobby_number", "lobbyNumber")),
    participants,
  };
}

function mapRpcEdge(value: unknown): TournamentEdge {
  const row = asRecord(value);
  return {
    id: asString(valueAt(row, "id")),
    formatEdgeId: asString(valueAt(row, "format_edge_id", "formatEdgeId"), asString(valueAt(row, "id"))),
    sourceNodeId: asString(valueAt(row, "source_round_id", "sourceNodeId")),
    destinationNodeId: asString(valueAt(row, "destination_round_id", "destinationNodeId")),
    priority: asNumber(valueAt(row, "priority"), 1),
    condition: valueAt(row, "condition") ?? null,
    status: (valueAt(row, "status") ?? "pending") as TournamentEdge["status"],
    advancedPlayerCount: asNumber(valueAt(row, "advanced_player_count", "advancedPlayerCount")),
  };
}

function mapRpcNode(value: unknown, formatConfig: unknown): TournamentNode {
  const row = asRecord(value);
  const round = mapRpcRound(value, formatConfig);
  return {
    ...round,
    entrantCount: asNumber(valueAt(row, "entrant_count", "entrantCount")),
    completedGames: asNumber(valueAt(row, "completed_games", "completedGames")),
    configuredGames: valueAt(row, "configured_games", "configuredGames") == null ? round.configuredGames ?? null : asNumber(valueAt(row, "configured_games", "configuredGames")),
    position: (valueAt(row, "position") ?? null) as TournamentNode["position"],
  };
}

function mapRpcProgress(value: unknown): TournamentRoundProgress | null {
  if (!value) return null;
  const row = asRecord(value);
  return {
    roundFormat: (valueAt(row, "round_format", "roundFormat") ?? "fixed_games") as TournamentRoundProgress["roundFormat"],
    completedGames: asNumber(valueAt(row, "completed_games", "completedGames")),
    configuredGames: valueAt(row, "configured_games", "configuredGames") == null ? null : asNumber(valueAt(row, "configured_games", "configuredGames")),
    checkmateThreshold: valueAt(row, "checkmate_threshold", "checkmateThreshold") == null ? null : asNumber(valueAt(row, "checkmate_threshold", "checkmateThreshold")),
    maxGames: valueAt(row, "max_games", "maxGames") == null ? null : asNumber(valueAt(row, "max_games", "maxGames")),
    decisiveGame: valueAt(row, "decisive_game", "decisiveGame") == null ? null : asNumber(valueAt(row, "decisive_game", "decisiveGame")),
    winnerParticipantId: valueAt(row, "winner_participant_id", "winnerParticipantId") == null ? null : asString(valueAt(row, "winner_participant_id", "winnerParticipantId")),
    currentBlockStartGame: valueAt(row, "current_block_start_game", "currentBlockStartGame") == null ? null : asNumber(valueAt(row, "current_block_start_game", "currentBlockStartGame")),
    currentBlockEndGame: valueAt(row, "current_block_end_game", "currentBlockEndGame") == null ? null : asNumber(valueAt(row, "current_block_end_game", "currentBlockEndGame")),
    nextReseedGame: valueAt(row, "next_reseed_game", "nextReseedGame") == null ? null : asNumber(valueAt(row, "next_reseed_game", "nextReseedGame")),
    isComplete: asBoolean(valueAt(row, "is_complete", "isComplete")),
  };
}

function mapRpcSheetStatus(value: unknown): GoogleSheetExportStatus | null {
  if (!value) return null;
  const row = asRecord(value);
  const lastError = valueAt(row, "last_error", "lastError");
  return {
    tournamentId: asString(valueAt(row, "tournament_id", "tournamentId")),
    connectionState: (valueAt(row, "connection_state", "connectionState") ?? "disconnected") as GoogleSheetExportStatus["connectionState"],
    state: (valueAt(row, "state") ?? "not_created") as GoogleSheetExportStatus["state"],
    spreadsheetId: (valueAt(row, "spreadsheet_id", "spreadsheetId") ?? null) as string | null,
    spreadsheetUrl: (valueAt(row, "spreadsheet_url", "spreadsheetUrl") ?? null) as string | null,
    desiredRevision: asNumber(valueAt(row, "desired_revision", "desiredRevision")),
    syncedRevision: asNumber(valueAt(row, "synced_revision", "syncedRevision")),
    dirtyAt: (valueAt(row, "dirty_at", "dirtyAt") ?? null) as string | null,
    lastSyncedAt: (valueAt(row, "last_synced_at", "lastSyncedAt") ?? null) as string | null,
    nextAttemptAt: (valueAt(row, "next_attempt_at", "nextAttemptAt") ?? null) as string | null,
    lastError: lastError
      ? { code: asString(valueAt(asRecord(lastError), "code"), "SHEET_EXPORT_ERROR"), message: asString(valueAt(asRecord(lastError), "message"), "Sheet export failed.") }
      : valueAt(row, "last_error_code", "lastErrorCode") || valueAt(row, "last_error_message", "lastErrorMessage")
        ? { code: asString(valueAt(row, "last_error_code", "lastErrorCode"), "SHEET_EXPORT_ERROR"), message: asString(valueAt(row, "last_error_message", "lastErrorMessage"), "Sheet export failed.") }
        : null,
  };
}

function mapRoutePageViewModel(rawValue: unknown): TournamentDetailPageViewModel {
  const raw = asRecord(rawValue);
  const tournament = asRecord(valueAt(raw, "tournament"));
  const formatConfig = valueAt(tournament, "format_config", "formatConfig") ?? valueAt(raw, "format_config", "formatConfig");
  const summary = mapTournamentSummaryRpcItem({
    id: asString(valueAt(tournament, "id") ?? valueAt(raw, "id")),
    host_user_id: asString(valueAt(tournament, "host_user_id", "hostUserId") ?? valueAt(raw, "host_user_id", "hostUserId")),
    name: asString(valueAt(tournament, "name") ?? valueAt(raw, "name")),
    max_players: asNumber(valueAt(tournament, "max_players", "playerCount") ?? valueAt(raw, "max_players", "playerCount")),
    format_id: asString(valueAt(tournament, "format_id", "formatId") ?? valueAt(raw, "format_id", "formatId")),
    status: (valueAt(tournament, "status") ?? valueAt(raw, "status") ?? "accepting_players") as TournamentSummary["status"],
    has_started: asBoolean(valueAt(tournament, "has_started", "hasStarted") ?? valueAt(raw, "has_started", "hasStarted")),
    current_round_id: (valueAt(tournament, "current_round_id", "currentRoundId") ?? valueAt(raw, "current_round_id", "currentRoundId") ?? null) as string | null,
    current_round_number: valueAt(tournament, "current_round_number", "currentRoundNumber") == null ? null : asNumber(valueAt(tournament, "current_round_number", "currentRoundNumber")),
    active_node_ids: asArray(valueAt(raw, "active_node_ids", "activeNodeIds")).map(String),
    created_at: asString(valueAt(tournament, "created_at", "createdAt") ?? valueAt(raw, "created_at", "createdAt")),
    registered_player_count: asNumber(valueAt(tournament, "registered_player_count", "registeredPlayerCount")),
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
  const gameScores = asArray(valueAt(raw, "game_scores", "gameScores")).map((score) => mapRpcGameScore(score, participantById)).filter((score): score is TournamentGameScore => score !== null);
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
    const progressLobbies = asArray(valueAt(lobbyPanel, "progress_lobbies", "progressLobbies")).map((lobby) => mapRpcLobby(lobby, participantById, scoreByParticipantRound));
    const selectedRound = rounds.find((round) => round.id === asString(valueAt(lobbyPanel, "round_id", "roundId"))) ?? rounds.find((round) => round.id === summary.currentRoundId) ?? rounds.find((round) => round.status === "active") ?? null;
    const configuredRound = selectedRound ? getConfiguredRound(formatConfig, selectedRound.formatNodeId) : null;
    const progress = mapRpcProgress(valueAt(lobbyPanel, "round_progress", "roundProgress"));
    const gameSummaries = asArray(valueAt(lobbyPanel, "game_summaries", "gameSummaries")).map((entry) => {
      const row = asRecord(entry);
      return { gameNumber: asNumber(valueAt(row, "game_number", "gameNumber")), lobbyCount: asNumber(valueAt(row, "lobby_count", "lobbyCount")), completedLobbyCount: asNumber(valueAt(row, "completed_lobby_count", "completedLobbyCount")) };
    });
    const resolvedProgress = progress ?? (configuredRound ? getRoundProgress(progressLobbies.length ? progressLobbies : lobbies, configuredRound) : null);
    panel = {
      view,
      round: selectedRound,
      lobbies,
      gameSummaries,
      selectedGameNumber: valueAt(lobbyPanel, "selected_game_number", "selectedGameNumber") == null ? (gameSummaries[0]?.gameNumber ?? null) : asNumber(valueAt(lobbyPanel, "selected_game_number", "selectedGameNumber")),
      page: asNumber(valueAt(lobbyPanel, "page"), 1),
      pageSize: asNumber(valueAt(lobbyPanel, "page_size", "pageSize"), 8),
      totalCount: asNumber(valueAt(lobbyPanel, "total_count", "totalCount"), lobbies.length),
      totalPages: Math.max(1, asNumber(valueAt(lobbyPanel, "total_pages", "totalPages"), 1)),
      roundProgress: resolvedProgress,
      progressionAction: (valueAt(lobbyPanel, "progression_action", "progressionAction") ?? (summary.status === "in_progress" && selectedRound?.status === "active" && resolvedProgress?.isComplete && tournamentIsGraphFormat(formatConfig) ? "finalize_node" : null)) as TournamentProgressionAction,
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
    activeNodeIds: asArray(valueAt(raw, "active_node_ids", "activeNodeIds")).map(String),
    selectedNodeId: (valueAt(raw, "selected_node_id", "selectedNodeId") ?? null) as string | null,
    sheetStatus: mapRpcSheetStatus(valueAt(raw, "sheet_status", "sheetStatus") ?? valueAt(raw, "google_sheet_status", "googleSheetStatus")),
    panel,
  };
}

export type TournamentPageViewOptions = {
  view: TournamentPanelView;
  selectedNodeId?: string;
  gameNumber?: number;
  page?: number;
  pageSize?: number;
  hostUserId?: string;
};

export async function getTournamentPageViewModel(
  tournamentId: string,
  options: Partial<TournamentPageViewOptions> = {},
): Promise<TournamentDetailPageViewModel | null> {
  const rows = await supabaseRestRequest<RouteViewModelRpcRow[]>("rpc/get_tournament_page_view_model", {
    method: "POST",
    body: {
      p_tournament_id: tournamentId,
      p_view: options.view ?? "lobbies",
      p_selected_node_id: options.selectedNodeId ?? null,
      p_game_number: options.gameNumber ?? null,
      p_lobby_page: options.page ?? 1,
      p_lobby_page_size: options.pageSize ?? 8,
      p_host_user_id: options.hostUserId ?? null,
    },
  });
  const raw = rows[0]?.view_model;
  return raw ? mapRoutePageViewModel(raw) : null;
}

export async function getTournamentLobbyViewModel(
  tournamentId: string,
  lobbyId: string,
): Promise<TournamentLobbyPageViewModel | null> {
  const rows = await supabaseRestRequest<RouteViewModelRpcRow[]>("rpc/get_tournament_lobby_view_model", {
    method: "POST",
    body: { p_tournament_id: tournamentId, p_lobby_id: lobbyId },
  });
  const raw = asRecord(rows[0]?.view_model);
  if (!rows[0]?.view_model) return null;
  const tournament = asRecord(valueAt(raw, "tournament"));
  const formatConfig = valueAt(raw, "format_config", "formatConfig");
  const participantRows = asArray(valueAt(raw, "participants"));
  const participants = participantRows.map(mapRpcParticipant);
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const scoreRows = asArray(valueAt(raw, "scores"));
  const scores = scoreRows.map((score) => mapRpcScore(score, participantById)).filter((score): score is TournamentScore => score !== null);
  const roundRaw = valueAt(raw, "round");
  const lobby = mapRpcLobby(valueAt(raw, "lobby"), participantById, new Map(scores.map((score) => [`${score.participantId}:${score.roundId}`, score])));
  const lobbyParticipants = lobby.participants.length ? lobby.participants : participantRows.map((row) => {
    const mapped = mapRpcLobby({ participants: [row], id: lobby.id, round_id: lobby.roundId, game_number: lobby.gameNumber, lobby_number: lobby.lobbyNumber }, participantById, new Map());
    return mapped.participants[0];
  }).filter((entry): entry is TournamentLobby["participants"][number] => Boolean(entry));
  return {
    tournament: {
      id: asString(valueAt(tournament, "id")),
      hostUserId: asString(valueAt(tournament, "host_user_id", "hostUserId")),
      name: asString(valueAt(tournament, "name")),
      status: (valueAt(tournament, "status") ?? "accepting_players") as TournamentSummary["status"],
      hasStarted: asBoolean(valueAt(tournament, "has_started", "hasStarted")),
    },
    round: mapRpcRound(roundRaw, formatConfig),
    lobby: { ...lobby, participants: lobbyParticipants },
    scores,
  };
}

export async function getTournamentExportViewModel(
  tournamentId: string,
): Promise<TournamentExportViewModel | null> {
  const rows = await supabaseRestRequest<RouteViewModelRpcRow[]>("rpc/get_tournament_export_view_model", {
    method: "POST",
    body: { p_tournament_id: tournamentId },
  });
  const raw = asRecord(rows[0]?.view_model);
  if (!rows[0]?.view_model) return null;
  const tournament = asRecord(valueAt(raw, "tournament"));
  const formatConfig = valueAt(tournament, "format_config", "formatConfig") ?? valueAt(raw, "format_config", "formatConfig");
  const participants = asArray(valueAt(raw, "participants")).map(mapRpcParticipant);
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const rounds = asArray(valueAt(raw, "rounds")).map((round) => mapRpcRound(round, formatConfig));
  return {
    id: asString(valueAt(tournament, "id") ?? valueAt(raw, "id")),
    hostUserId: asString(valueAt(tournament, "host_user_id", "hostUserId")),
    name: asString(valueAt(tournament, "name")),
    status: (valueAt(tournament, "status") ?? "accepting_players") as TournamentSummary["status"],
    formatConfig,
    registrations: asArray(valueAt(raw, "registrations")).map(mapRpcRegistration),
    participants,
    rounds,
    scores: asArray(valueAt(raw, "scores")).map((score) => mapRpcScore(score, participantById)).filter((score): score is TournamentScore => score !== null),
    gameScores: asArray(valueAt(raw, "game_scores", "gameScores")).map((score) => mapRpcGameScore(score, participantById)).filter((score): score is TournamentGameScore => score !== null),
  };
}

export async function assertTournamentHost(tournamentId: string, hostUserId: string): Promise<void> {
  const rows = await supabaseRestRequest<Pick<TournamentRow, "id" | "host_user_id">[]>("tournaments", {
    query: {
      select: "id,host_user_id",
      id: `eq.${tournamentId}`,
      host_user_id: `eq.${hostUserId}`,
      limit: "1",
    },
  });
  if (!rows[0]) throw new Error("TOURNAMENT_NOT_FOUND");
}

function mapTournamentRound(
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

function mapTournamentScoreRow(
  row: TournamentScoreRow,
  participantById: Map<string, TournamentParticipant>,
): TournamentScore | null {
  const participant = participantById.get(row.participant_id);
  if (!participant) return null;
  return {
    id: row.id,
    participantId: row.participant_id,
    displayName: participant.displayName,
    seedNumber: participant.seedNumber,
    roundId: String(row.round_id),
    roundSeedNumber: row.round_seed_number,
    score: row.score,
    sourceEdgeId:
      row.source_edge_id === null || row.source_edge_id === undefined
        ? null
        : String(row.source_edge_id),
    sourceRank: row.source_rank ?? null,
    createdAt: row.created_at,
  };
}

function tournamentIsGraphFormat(formatConfig: unknown): boolean {
  return (
    typeof formatConfig === "object" &&
    formatConfig !== null &&
    Array.isArray((formatConfig as { nodes?: unknown }).nodes)
  );
}

function emptyScoreQuery(): { query: { select: string; limit: string } } {
  return {
    query: {
      select:
        "id,participant_id,round_id,round_seed_number,score,source_edge_id,source_rank,created_at",
      limit: "0",
    },
  };
}

async function fetchParticipantsByIds(
  participantIds: string[],
  tournamentId?: string,
): Promise<TournamentParticipantRow[]> {
  if (participantIds.length === 0) return [];
  return supabaseRestRequest<TournamentParticipantRow[]>(
    "tournament_participants",
    {
      query: {
        select:
          "id,tournament_id,registration_id,seed_number,display_name_at_start,created_at",
        id: `in.(${participantIds.join(",")})`,
        ...(tournamentId ? { tournament_id: `eq.${tournamentId}` } : {}),
        order: "seed_number.asc",
      },
    },
  );
}

async function loadTournamentRoundDetail(
  tournament: TournamentRow,
  round: TournamentRoundRow,
): Promise<TournamentRoundDetail> {
  const [lobbyRows, scoreRows] = await Promise.all([
    supabaseRestRequest<TournamentLobbyRow[]>("lobbies", {
      query: {
        select: "id,round_id,game_number,lobby_number",
        round_id: `eq.${round.id}`,
        order: "game_number.asc,lobby_number.asc",
      },
    }),
    supabaseRestRequest<TournamentScoreRow[]>("participant_round_scores", {
      query: {
        select:
          "id,participant_id,round_id,round_seed_number,score,source_edge_id,source_rank,created_at",
        round_id: `eq.${round.id}`,
      },
    }),
  ]);
  const lobbyIds = lobbyRows.map((lobby) => lobby.id);
  const lobbyParticipantRows = lobbyIds.length
    ? await fetchLobbyParticipants(lobbyIds)
    : [];
  const participantIds = [
    ...new Set([
      ...scoreRows.map((score) => score.participant_id),
      ...lobbyParticipantRows.map((participant) => participant.participant_id),
    ]),
  ];
  const participants = await fetchParticipantsByIds(
    participantIds,
    String(tournament.id),
  );
  const participantById = new Map(
    participants.map((participant) => [
      participant.id,
      mapTournamentParticipantRow(participant),
    ]),
  );
  const lobbyById = new Map(
    lobbyRows.map((lobby) => [String(lobby.id), lobby]),
  );
  const roundSeedByParticipant = new Map(
    scoreRows.map((score) => [score.participant_id, score.round_seed_number]),
  );
  const lobbyParticipantsByLobbyId = new Map<
    string,
    TournamentLobby["participants"]
  >();

  for (const lobbyParticipant of lobbyParticipantRows) {
    const participant = participantById.get(lobbyParticipant.participant_id);
    if (!participant) continue;
    const lobbyId = String(lobbyParticipant.lobby_id);
    const assignedParticipants =
      lobbyParticipantsByLobbyId.get(lobbyId) ?? [];
    assignedParticipants.push({
      id: participant.id,
      displayName: participant.displayName,
      seedNumber: participant.seedNumber,
      roundSeedNumber:
        roundSeedByParticipant.get(participant.id) ?? participant.seedNumber,
      slotNumber: lobbyParticipant.slot_number,
      placement: lobbyParticipant.placement,
      points: lobbyParticipant.points,
      resultStatus: lobbyParticipant.result_status,
    });
    lobbyParticipantsByLobbyId.set(lobbyId, assignedParticipants);
  }

  const lobbies = lobbyRows.map((lobby) => ({
    id: String(lobby.id),
    roundId: String(lobby.round_id),
    gameNumber: lobby.game_number,
    lobbyNumber: lobby.lobby_number,
    participants: [
      ...(lobbyParticipantsByLobbyId.get(String(lobby.id)) ?? []),
    ].sort((first, second) => first.slotNumber - second.slotNumber),
  }));
  const gameScores = lobbyParticipantRows
    .map((lobbyParticipant) => {
      const participant = participantById.get(lobbyParticipant.participant_id);
      const lobby = lobbyById.get(String(lobbyParticipant.lobby_id));
      if (!participant || !lobby) return null;
      return {
        participantId: participant.id,
        displayName: participant.displayName,
        seedNumber: participant.seedNumber,
        roundId: String(lobby.round_id),
        gameNumber: lobby.game_number,
        placement: lobbyParticipant.placement,
        score:
          lobbyParticipant.result_status === "confirmed" ||
          lobbyParticipant.result_status === "corrected"
            ? lobbyParticipant.points
            : null,
      };
    })
    .filter((score): score is TournamentGameScore => score !== null);
  const mappedScores = scoreRows
    .map((score) => mapTournamentScoreRow(score, participantById))
    .filter((score): score is TournamentScore => score !== null)
    .sort((first, second) => first.seedNumber - second.seedNumber);
  const mappedRound = mapTournamentRound(round, tournament.format_config);
  const roundProgress = getRoundProgress(
    lobbies,
    getConfiguredRound(tournament.format_config, round.format_round_id),
  );
  const progressionAction: TournamentProgressionAction =
    tournament.status === "in_progress" &&
    round.status === "active" &&
    roundProgress?.isComplete &&
    tournamentIsGraphFormat(tournament.format_config)
      ? "finalize_node"
      : null;

  return {
    round: mappedRound,
    lobbies,
    gameScores,
    scores: mappedScores,
    roundProgress,
    progressionAction,
  };
}

async function loadTournamentRow(
  tournamentId: string,
): Promise<TournamentRow | null> {
  const rows = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${tournamentId}`,
      limit: "1",
    },
  });
  return rows[0] ?? null;
}

async function loadRoundRow(
  tournamentId: string,
  roundId: string,
): Promise<TournamentRoundRow | null> {
  const rows = await supabaseRestRequest<TournamentRoundRow[]>("rounds", {
    query: {
      select: "id,tournament_id,round_number,format_round_id,stage_name,status",
      id: `eq.${roundId}`,
      tournament_id: `eq.${tournamentId}`,
      limit: "1",
    },
  });
  return rows[0] ?? null;
}

const getCachedCompletedRound = unstable_cache(
  async (tournamentId: string, roundId: string): Promise<TournamentRoundDetail | null> => {
    const [tournament, round] = await Promise.all([
      loadTournamentRow(tournamentId),
      loadRoundRow(tournamentId, roundId),
    ]);
    if (!tournament || !round || round.status !== "completed") return null;
    return loadTournamentRoundDetail(tournament, round);
  },
  ["tournament-completed-round"],
  { revalidate: false },
);

async function readCompletedRound(
  tournamentId: string,
  roundId: string,
): Promise<TournamentRoundDetail | null> {
  try {
    return await getCachedCompletedRound(tournamentId, roundId);
  } catch (error) {
    // The repository is also exercised by the plain Node test runner, where
    // Next's request cache is not installed. Keep the same query semantics in
    // that environment while using the persistent cache in the app runtime.
    if (
      error instanceof Error &&
      error.message.includes("incrementalCache missing in unstable_cache")
    ) {
      const [tournament, round] = await Promise.all([
        loadTournamentRow(tournamentId),
        loadRoundRow(tournamentId, roundId),
      ]);
      if (!tournament || !round || round.status !== "completed") return null;
      return loadTournamentRoundDetail(tournament, round);
    }
    throw error;
  }
}

export async function getTournamentOverview(
  tournamentId: string,
): Promise<TournamentOverview | null> {
  const tournament = await loadTournamentRow(tournamentId);
  if (!tournament) return null;
  const [registrations, participants, rounds, edgeRows] = await Promise.all([
    supabaseRestRequest<TournamentRegistrationRow[]>("tournament_registrations", {
      query: {
        select: "id,tournament_id,display_name,riot_puuid,registration_status,created_at",
        tournament_id: `eq.${tournamentId}`,
        order: "created_at.asc",
      },
    }),
    supabaseRestRequest<TournamentParticipantRow[]>("tournament_participants", {
      query: {
        select:
          "id,tournament_id,registration_id,seed_number,display_name_at_start,created_at",
        tournament_id: `eq.${tournamentId}`,
        order: "seed_number.asc",
      },
    }),
    supabaseRestRequest<TournamentRoundRow[]>("rounds", {
      query: {
        select: "id,tournament_id,round_number,format_round_id,stage_name,status",
        tournament_id: `eq.${tournamentId}`,
        order: "round_number.asc",
      },
    }),
    tournamentIsGraphFormat(tournament.format_config)
      ? supabaseRestRequest<TournamentEdgeRow[]>("tournament_edges", {
          query: {
            select:
              "id,tournament_id,format_edge_id,source_round_id,destination_round_id,priority,condition,status,advanced_player_count",
            tournament_id: `eq.${tournamentId}`,
            order: "priority.asc,id.asc",
          },
        })
      : Promise.resolve([]),
  ]);
  const graph = getFormatGraph(tournament.format_config);
  const mappedRounds = rounds.map((round) =>
    mapTournamentRound(round, tournament.format_config, graph),
  );
  const nodes: TournamentNode[] = mappedRounds.length
    ? mappedRounds.map((round) => ({
        ...round,
        entrantCount: 0,
        completedGames: 0,
        configuredGames: round.configuredGames ?? null,
        position:
          getConfiguredRound(tournament.format_config, round.formatNodeId)?.position ??
          null,
      }))
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
  const currentRoundNumber = mappedRounds.find(
    (round) => round.id === String(tournament.current_round_id),
  )?.roundNumber ?? null;
  const activeNodeIds = mappedRounds
    .filter((round) => round.status === "active")
    .map((round) => round.id);
  const mappedEdges = edgeRows.length
    ? edgeRows.map(mapTournamentEdgeRow)
    : graph.edges.map((edge) => ({
        id: edge.id,
        formatEdgeId: edge.id,
        sourceNodeId: edge.sourceNodeId,
        destinationNodeId: edge.destinationNodeId,
        priority: edge.priority,
        condition: edge.condition,
        status: "pending" as const,
        advancedPlayerCount: 0,
      }));

  return {
    ...mapTournamentRow(tournament),
    formatConfig: tournament.format_config,
    startRequirement: getTournamentStartRequirement(tournament.format_config),
    currentRoundNumber,
    registrations: registrations.map(mapTournamentRegistrationRow),
    participants: participants.map(mapTournamentParticipantRow),
    rounds: mappedRounds,
    nodes,
    edges: mappedEdges,
    activeNodeIds,
    selectedNodeId: null,
  };
}

async function getRoundDetailForOverview(
  tournamentId: string,
  overview: TournamentOverview,
  round: TournamentRound,
): Promise<TournamentRoundDetail | null> {
  if (round.status === "completed") {
    return readCompletedRound(tournamentId, round.id);
  }
  const row: TournamentRoundRow = {
    id: round.id,
    tournament_id: tournamentId,
    round_number: round.roundNumber,
    format_round_id: round.formatNodeId ?? null,
    stage_name: round.name ?? null,
    status: round.status ?? "pending",
  };
  const tournament: TournamentRow = {
    id: overview.id,
    host_user_id: overview.hostUserId,
    name: overview.name,
    max_players: overview.playerCount,
    format_id: overview.formatId,
    status: overview.status,
    current_round_id: overview.currentRoundId,
    format_config: overview.formatConfig,
    created_at: overview.createdAt,
  };
  return loadTournamentRoundDetail(tournament, row);
}

function buildNodesFromRoundDetails(
  overview: TournamentOverview,
  roundDetails: TournamentRoundDetail[],
): TournamentNode[] {
  const detailsByRoundId = new Map(
    roundDetails.map((detail) => [detail.round.id, detail]),
  );
  return overview.nodes.map((node) => {
    const detail = detailsByRoundId.get(node.id);
    return detail
      ? {
          ...node,
          entrantCount: detail.scores.length,
          completedGames: new Set(
            detail.lobbies.map((lobby) => lobby.gameNumber),
          ).size,
        }
      : node;
  });
}

export async function getTournamentPageData(
  tournamentId: string,
  selectedNodeId?: string,
): Promise<TournamentDetail | null> {
  const overview = await getTournamentOverview(tournamentId);
  if (!overview) return null;
  const roundDetails = overview.hasStarted
    ? (
        await Promise.all(
          overview.rounds.map((round) =>
            getRoundDetailForOverview(tournamentId, overview, round),
          ),
        )
      ).filter((detail): detail is TournamentRoundDetail => detail !== null)
    : [];
  const currentRound = overview.rounds.find(
    (round) =>
      round.id === String(selectedNodeId ?? overview.currentRoundId),
  ) ?? overview.rounds.find((round) => round.status === "active") ?? null;
  const selectedDetail = currentRound
    ? roundDetails.find((detail) => detail.round.id === currentRound.id) ?? null
    : null;
  const scores = roundDetails
    .flatMap((detail) => detail.scores)
    .sort((first, second) => first.seedNumber - second.seedNumber);
  return {
    ...overview,
    currentRoundNumber: currentRound?.roundNumber ?? overview.currentRoundNumber,
    lobbies: selectedDetail?.lobbies ?? [],
    gameScores: roundDetails.flatMap((detail) => detail.gameScores),
    scores,
    roundProgress: selectedDetail?.roundProgress ?? null,
    progressionAction: selectedDetail?.progressionAction ?? null,
    nodes: buildNodesFromRoundDetails(overview, roundDetails),
    selectedNodeId: selectedDetail?.round.id ?? null,
  };
}

async function loadLobbyRoster(
  tournamentId: string,
  lobbyId: string,
): Promise<TournamentLobbyRoster | null> {
  const lobbies = await supabaseRestRequest<TournamentLobbyRow[]>("lobbies", {
    query: {
      select: "id,round_id,game_number,lobby_number",
      id: `eq.${lobbyId}`,
      limit: "1",
    },
  });
  const lobby = lobbies[0];
  if (!lobby) return null;
  const participantRows = await supabaseRestRequest<
    TournamentLobbyParticipantRow[]
  >("lobby_participants", {
    query: {
      select: "id,lobby_id,participant_id,slot_number,placement,points,result_status",
      lobby_id: `eq.${lobbyId}`,
      order: "slot_number.asc,id.asc",
    },
  });
  const participants = await fetchParticipantsByIds(
    participantRows.map((participant) => participant.participant_id),
    tournamentId,
  );
  const participantById = new Map(
    participants.map((participant) => [
      participant.id,
      mapTournamentParticipantRow(participant),
    ]),
  );
  return {
    id: String(lobby.id),
    roundId: String(lobby.round_id),
    gameNumber: lobby.game_number,
    lobbyNumber: lobby.lobby_number,
    participants: participantRows
      .map((participant) => {
        const player = participantById.get(participant.participant_id);
        if (!player) return null;
        return {
          id: player.id,
          displayName: player.displayName,
          seedNumber: player.seedNumber,
          slotNumber: participant.slot_number,
        };
      })
      .filter(
        (participant): participant is TournamentLobbyRosterParticipant =>
          participant !== null,
      ),
  };
}

const getCachedLobbyRoster = unstable_cache(
  async (tournamentId: string, lobbyId: string) =>
    loadLobbyRoster(tournamentId, lobbyId),
  ["tournament-lobby-roster"],
  { revalidate: false },
);

async function readLobbyRoster(
  tournamentId: string,
  lobbyId: string,
): Promise<TournamentLobbyRoster | null> {
  try {
    return await getCachedLobbyRoster(tournamentId, lobbyId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("incrementalCache missing in unstable_cache")
    ) {
      return loadLobbyRoster(tournamentId, lobbyId);
    }
    throw error;
  }
}

export async function getTournamentRoundDetail(
  tournamentId: string,
  roundId: string,
): Promise<TournamentRoundDetail | null> {
  const [tournament, round] = await Promise.all([
    loadTournamentRow(tournamentId),
    loadRoundRow(tournamentId, roundId),
  ]);
  if (!tournament || !round) return null;
  if (round.status === "completed") {
    return readCompletedRound(tournamentId, roundId);
  }
  return loadTournamentRoundDetail(tournament, round);
}

export async function getTournamentLobbyDetail(
  tournamentId: string,
  lobbyId: string,
): Promise<TournamentLobbyDetail | null> {
  const [tournament, lobbyRows] = await Promise.all([
    loadTournamentRow(tournamentId),
    supabaseRestRequest<TournamentLobbyRow[]>("lobbies", {
      query: {
        select: "id,round_id,game_number,lobby_number",
        id: `eq.${lobbyId}`,
        limit: "1",
      },
    }),
  ]);
  const lobbyRow = lobbyRows[0];
  if (!tournament || !lobbyRow) return null;
  const round = await loadRoundRow(tournamentId, String(lobbyRow.round_id));
  if (!round) return null;
  const roster = await readLobbyRoster(tournamentId, lobbyId);
  if (!roster) return null;
  const participantRows = await supabaseRestRequest<
    TournamentLobbyParticipantRow[]
  >("lobby_participants", {
    query: {
      select: "id,lobby_id,participant_id,slot_number,placement,points,result_status",
      lobby_id: `eq.${lobbyId}`,
      order: "slot_number.asc,id.asc",
    },
  });
  const participantIds = roster.participants.map((participant) => participant.id);
  const scoreRows = participantIds.length
    ? await supabaseRestRequest<TournamentScoreRow[]>("participant_round_scores", {
        query: {
          select:
            "id,participant_id,round_id,round_seed_number,score,source_edge_id,source_rank,created_at",
          round_id: `eq.${round.id}`,
          participant_id: `in.(${participantIds.join(",")})`,
        },
      })
    : await supabaseRestRequest<TournamentScoreRow[]>(
        "participant_round_scores",
        emptyScoreQuery(),
      );
  const scoreByParticipantId = new Map(
    scoreRows.map((score) => [score.participant_id, score]),
  );
  const resultByParticipantId = new Map(
    participantRows.map((participant) => [participant.participant_id, participant]),
  );
  const mappedLobby: TournamentLobby = {
    ...roster,
    participants: roster.participants
      .map((participant) => {
        const result = resultByParticipantId.get(participant.id);
        const score = scoreByParticipantId.get(participant.id);
        return {
          ...participant,
          roundSeedNumber: score?.round_seed_number ?? participant.seedNumber,
          placement: result?.placement ?? null,
          points: result?.points ?? null,
          resultStatus: result?.result_status ?? "pending",
        };
      })
      .sort((first, second) => first.slotNumber - second.slotNumber),
  };
  const mappedRound = mapTournamentRound(round, tournament.format_config);
  const participantById = new Map(
    roster.participants.map((participant) => [participant.id, participant]),
  );
  const scores = scoreRows
    .map((score): TournamentScore | null => {
      const participant = participantById.get(score.participant_id);
      if (!participant) return null;
      return {
        id: score.id,
        participantId: score.participant_id,
        displayName: participant.displayName,
        seedNumber: participant.seedNumber,
        roundId: String(score.round_id),
        roundSeedNumber: score.round_seed_number,
        score: score.score,
        sourceEdgeId:
          score.source_edge_id === null || score.source_edge_id === undefined
            ? null
            : String(score.source_edge_id),
        sourceRank: score.source_rank ?? null,
        createdAt: score.created_at,
      };
    })
    .filter((score): score is TournamentScore => score !== null);
  const summary = mapTournamentRow(tournament);
  return {
    tournament: {
      id: summary.id,
      hostUserId: summary.hostUserId,
      name: summary.name,
      status: summary.status,
      hasStarted: summary.hasStarted,
    },
    round: mappedRound,
    lobby: mappedLobby,
    scores,
  };
}

export async function getTournamentExportDetail(
  tournamentId: string,
): Promise<TournamentDetail | null> {
  return getTournamentPageData(tournamentId);
}

/** @deprecated Use the scoped query functions or getTournamentExportDetail. */
export async function getTournamentDetail(
  tournamentId: string,
  selectedNodeId?: string,
): Promise<TournamentDetail | null> {
  return getTournamentPageData(tournamentId, selectedNodeId);
}

export async function getTournamentNodeIdForLobby(lobbyId: string): Promise<string | null> {
  const rows = await supabaseRestRequest<Pick<TournamentLobbyRow, "round_id">[]>("lobbies", {
    query: { select: "round_id", id: `eq.${lobbyId}`, limit: "1" },
  });
  return rows[0] ? String(rows[0].round_id) : null;
}

export async function registerTournamentPlayer(
  input: RegisterTournamentPlayerInput,
): Promise<TournamentRegistration> {
  let rows: TournamentRegistrationRow[];
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${input.tournamentId}`,
      limit: "1",
    },
  });
  const tournament = tournaments[0];

  if (!tournament) {
    throw new Error("Tournament was not found.");
  }

  if (tournament.status !== TOURNAMENT_STATUS_ACCEPTING_PLAYERS) {
    throw new Error("Registration is closed because the tournament has started.");
  }

  try {
    rows = await supabaseRestRequest<TournamentRegistrationRow[]>(
      "tournament_registrations",
      {
        method: "POST",
        query: {
          select: "id,tournament_id,display_name,riot_puuid,created_at",
        },
        prefer: "return=representation",
        body: {
          tournament_id: input.tournamentId,
          riot_puuid: input.riotAccount.puuid,
          display_name: input.riotAccount.gameTag,
        },
      },
    );
  } catch (error) {
    if (
      error instanceof DatabaseRequestError &&
      error.message.includes("23505")
    ) {
      throw new Error("That Riot account is already registered.");
    }

    throw error;
  }

  const player = rows[0];

  if (!player) {
    throw new Error("Database did not return the registered player.");
  }

  return mapTournamentRegistrationRow(player);
}

export async function addRandomSeededTournamentPlayers(
  input: AddRandomSeededTournamentPlayersInput,
): Promise<AddRandomSeededTournamentPlayersResult> {
  const requestedCount = Number.isFinite(input.count)
    ? Math.max(0, Math.floor(input.count))
    : 0;
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${input.tournamentId}`,
      limit: "1",
    },
  });
  const tournament = tournaments[0];

  if (!tournament) {
    throw new Error("Tournament was not found.");
  }

  if (tournament.status !== TOURNAMENT_STATUS_ACCEPTING_PLAYERS) {
    throw new Error("Random test players can only be added before the tournament starts.");
  }

  const registrations = await supabaseRestRequest<
    Pick<TournamentRegistrationRow, "display_name" | "riot_puuid">[]
  >("tournament_registrations", {
    query: {
      select: "display_name,riot_puuid",
      tournament_id: `eq.${input.tournamentId}`,
    },
  });
  const remainingSlots = Math.max(0, tournament.max_players - registrations.length);
  const targetCount = Math.min(requestedCount, remainingSlots);

  if (targetCount === 0) {
    return {
      requestedCount,
      addedCount: 0,
      skippedCount: 0,
      remainingSlots,
    };
  }

  const existingIds = registrations
    .map((registration) => registration.display_name)
    .filter((displayName): displayName is string => Boolean(displayName));
  const existingPuuids = new Set(
    registrations
      .map((registration) => registration.riot_puuid)
      .filter((puuid): puuid is string => Boolean(puuid)),
  );
  const candidates = selectRandomSeededRiotIds(existingIds, SEEDED_RIOT_IDS.length);
  let addedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    if (addedCount >= targetCount) {
      break;
    }

    const parsed = parseRiotGameTag(candidate);
    if (!parsed) {
      skippedCount += 1;
      continue;
    }

    let riotAccount;
    try {
      riotAccount = await getRiotAccountByRiotId({
        gameName: parsed.gameName,
        tagLine: parsed.tagLine,
      });
    } catch (error) {
      if (error instanceof RiotAccountNotFoundError) {
        skippedCount += 1;
        continue;
      }

      throw error;
    }

    if (existingPuuids.has(riotAccount.puuid)) {
      skippedCount += 1;
      continue;
    }

    try {
      await registerTournamentPlayer({
        tournamentId: input.tournamentId,
        riotAccount,
      });
      existingPuuids.add(riotAccount.puuid);
      addedCount += 1;
    } catch (error) {
      if (
        error instanceof DatabaseRequestError &&
        error.message.includes("23505")
      ) {
        skippedCount += 1;
        continue;
      }
      if (error instanceof Error && error.message === "That Riot account is already registered.") {
        skippedCount += 1;
        continue;
      }

      throw error;
    }
  }

  skippedCount += Math.max(0, targetCount - addedCount - skippedCount);

  return {
    requestedCount,
    addedCount,
    skippedCount,
    remainingSlots: remainingSlots - addedCount,
  };
}

export async function startTournament(
  input: StartTournamentInput,
): Promise<StartTournamentResult> {
  const rows = await supabaseRestRequest<StartTournamentResult[]>(
    "rpc/start_tournament",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_initial_assignments: input.initialAssignments ?? [],
      },
    },
  );
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return the started tournament.");
  }

  return result;
}

export async function updateLobbyResults(
  input: UpdateLobbyResultsInput,
): Promise<UpdateLobbyResultsResult> {
  const rows = await supabaseRestRequest<UpdateLobbyResultsResult[]>(
    "rpc/update_lobby_results",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_lobby_id: input.lobbyId,
        p_results: input.results.map((result) => ({
          participantId: result.participantId,
          placement: result.placement,
        })),
      },
    },
  );
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return the updated lobby.");
  }

  return result;
}

export async function randomizePendingLobbyResults(
  input: RandomizePendingLobbyResultsInput,
): Promise<RandomizePendingLobbyResultsResult> {
  const rows = await supabaseRestRequest<RandomizePendingLobbyResultsResult[]>("rpc/randomize_pending_lobby_results", {
    method: "POST",
    body: { p_tournament_id: input.tournamentId, p_node_id: input.nodeId },
  });
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return randomized lobby results.");
  }

  return result;
}

export async function finalizeTournamentNode(
  input: FinalizeTournamentNodeInput,
): Promise<FinalizeTournamentNodeResult> {
  const rows = await supabaseRestRequest<FinalizeTournamentNodeResult[]>(
    "rpc/finalize_tournament_node",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_node_id: input.nodeId,
      },
    },
  );
  const result = rows[0];
  if (!result) throw new Error("Database did not return the node transition.");
  return result;
}
