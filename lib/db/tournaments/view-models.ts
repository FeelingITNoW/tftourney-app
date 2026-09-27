import { supabaseRestRequest } from "../supabase-rest/api";
import type {
  TournamentRow,
  TournamentScore,
  TournamentLobby,
  TournamentListPageViewModel,
  TournamentDetailPageViewModel,
  TournamentLobbyPageViewModel,
  TournamentExportViewModel,
  TournamentPanelView,
  TournamentSummary,
  TournamentSummaryRpcRow,
} from "./types";
import type { TournamentGameScore } from "./types";
import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  mapRpcGameScore,
  mapRpcLobby,
  mapRpcParticipant,
  mapRpcRegistration,
  mapRpcRound,
  mapRpcScore,
  mapRoutePageViewModel,
  mapTournamentSummaryRpcItem,
  valueAt,
} from "./mappers";

export const TOURNAMENT_PAGE_SIZE = 10;

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
  const formatConfig = valueAt(raw, "format_config");
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
      hostUserId: asString(valueAt(tournament, "host_user_id")),
      name: asString(valueAt(tournament, "name")),
      status: (valueAt(tournament, "status") ?? "accepting_players") as TournamentSummary["status"],
      hasStarted: asBoolean(valueAt(tournament, "has_started")),
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
  const formatConfig = valueAt(tournament, "format_config") ?? valueAt(raw, "format_config");
  const participants = asArray(valueAt(raw, "participants")).map(mapRpcParticipant);
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const rounds = asArray(valueAt(raw, "rounds")).map((round) => mapRpcRound(round, formatConfig));
  return {
    id: asString(valueAt(tournament, "id") ?? valueAt(raw, "id")),
    hostUserId: asString(valueAt(tournament, "host_user_id")),
    name: asString(valueAt(tournament, "name")),
    status: (valueAt(tournament, "status") ?? "accepting_players") as TournamentSummary["status"],
    formatConfig,
    registrations: asArray(valueAt(raw, "registrations")).map(mapRpcRegistration),
    participants,
    rounds,
    scores: asArray(valueAt(raw, "scores")).map((score) => mapRpcScore(score, participantById)).filter((score): score is TournamentScore => score !== null),
    gameScores: asArray(valueAt(raw, "game_scores")).map((score) => mapRpcGameScore(score, participantById)).filter((score): score is TournamentGameScore => score !== null),
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
