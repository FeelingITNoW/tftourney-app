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

export const TOURNAMENT_STATUS_ACCEPTING_PLAYERS = "accepting_players";

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

export async function listTournaments(hostUserId?: string): Promise<TournamentSummary[]> {
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      ...(hostUserId ? { host_user_id: `eq.${hostUserId}` } : {}),
      order: "created_at.desc",
    },
  });

  if (tournaments.length === 0) {
    return [];
  }

  const tournamentIds = tournaments.map((tournament) => tournament.id);
  const registrations = await supabaseRestRequest<
    Pick<TournamentRegistrationRow, "tournament_id">[]
  >("tournament_registrations", {
    query: {
      select: "tournament_id",
      tournament_id: `in.(${tournamentIds.join(",")})`,
    },
  });

  const playerCountByTournamentId = new Map<string, number>();

  for (const registration of registrations) {
    const tournamentId = String(registration.tournament_id);
    playerCountByTournamentId.set(
      tournamentId,
      (playerCountByTournamentId.get(tournamentId) ?? 0) + 1,
    );
  }

  const rounds = tournamentIds.length
    ? await supabaseRestRequest<Pick<TournamentRoundRow, "id" | "round_number" | "tournament_id" | "status">[]>("rounds", {
        query: {
          select: "id,round_number,tournament_id,status",
          tournament_id: `in.(${tournamentIds.join(",")})`,
        },
      })
    : [];
  const currentRoundNumberById = new Map(rounds.map((round) => [String(round.id), round.round_number]));
  const activeNodeIdsByTournament = new Map<string, string[]>();
  for (const round of rounds) {
    if (round.status !== "active") continue;
    const key = String(round.tournament_id);
    activeNodeIdsByTournament.set(key, [...(activeNodeIdsByTournament.get(key) ?? []), String(round.id)]);
  }

  return tournaments.map((tournament) => ({
    ...mapTournamentRow(tournament),
    currentRoundNumber:
      tournament.current_round_id === null
        ? null
        : currentRoundNumberById.get(String(tournament.current_round_id)) ?? null,
    activeNodeIds: activeNodeIdsByTournament.get(String(tournament.id)) ??
      (tournament.current_round_id === null ? [] : [String(tournament.current_round_id)]),
    registeredPlayerCount:
      playerCountByTournamentId.get(String(tournament.id)) ?? 0,
  }));
}

export async function listHostedTournaments(hostUserId: string): Promise<TournamentSummary[]> {
  return listTournaments(hostUserId);
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
