import { DatabaseRequestError, supabaseRestRequest } from "./supabase-rest";
import type { VerifiedRiotAccount } from "@/lib/riot/accounts";

export const TOURNAMENT_STATUS_ACCEPTING_PLAYERS = "accepting_players";

export type TournamentStatus =
  | typeof TOURNAMENT_STATUS_ACCEPTING_PLAYERS
  | "in_progress"
  | "completed"
  | "cancelled";

export type TournamentSummary = {
  id: string;
  name: string;
  playerCount: number;
  formatId: string;
  status: TournamentStatus;
  hasStarted: boolean;
  currentRoundId: string | null;
  currentRoundNumber: number | null;
  createdAt: string;
  registeredPlayerCount: number;
};

export type TournamentPlayer = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type TournamentEntry = {
  id: string;
  tournamentPlayerId: string;
  displayName: string;
  seedNumber: number;
  createdAt: string;
};

export type TournamentScore = {
  id: string;
  tournamentEntryId: string;
  displayName: string;
  seedNumber: number;
  roundId: string;
  score: number;
  createdAt: string;
};

export type TournamentDetail = Omit<
  TournamentSummary,
  "registeredPlayerCount"
> & {
  players: TournamentPlayer[];
  entries: TournamentEntry[];
  scores: TournamentScore[];
};

const STANDARD_HOST_USER_ID = 1;

type TournamentRow = {
  id: string;
  name: string;
  player_count: number;
  format_id: string;
  status: TournamentStatus;
  has_started: boolean;
  current_round_id: string | null;
  current_round_number: number | null;
  created_at: string;
};

type TournamentPlayerRow = {
  id: string;
  tournament_id: string;
  display_name: string | null;
  riot_puuid: string | null;
  created_at: string;
};

type TournamentEntryRow = {
  id: string;
  tournament_id: string;
  tournament_player_id: string;
  seed_number: number;
  display_name: string;
  created_at: string;
};

type TournamentScoreRow = {
  id: string;
  tournament_id: string;
  tournament_entry_id: string;
  round_id: string;
  score: number;
  created_at: string;
};

type StartTournamentRow = {
  tournament_id: string;
  entrant_count: number;
  current_round_id: string;
  current_round_number: number;
};

const tournamentSelect =
  "id,name,player_count,format_id,status,has_started,current_round_id,current_round_number,created_at";

function mapTournamentRow(row: TournamentRow): Omit<
  TournamentSummary,
  "registeredPlayerCount"
> {
  return {
    id: row.id,
    name: row.name,
    playerCount: row.player_count,
    formatId: row.format_id,
    status: row.status,
    hasStarted: row.has_started,
    currentRoundId: row.current_round_id,
    currentRoundNumber: row.current_round_number,
    createdAt: row.created_at,
  };
}

function mapTournamentPlayerRow(row: TournamentPlayerRow): TournamentPlayer {
  return {
    id: row.id,
    displayName: row.display_name ?? row.riot_puuid ?? "Unknown player",
    createdAt: row.created_at,
  };
}

function mapTournamentEntryRow(row: TournamentEntryRow): TournamentEntry {
  return {
    id: row.id,
    tournamentPlayerId: row.tournament_player_id,
    displayName: row.display_name,
    seedNumber: row.seed_number,
    createdAt: row.created_at,
  };
}

export async function createTournament(input: {
  name: string;
  playerCount: number;
  formatId: string;
  formatConfig: unknown;
}): Promise<TournamentSummary> {
  const rows = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    method: "POST",
    query: {
      select: tournamentSelect,
    },
    prefer: "return=representation",
    body: {
      host_user_id: STANDARD_HOST_USER_ID,
      name: input.name,
      player_count: input.playerCount,
      format_id: input.formatId,
      format_config: input.formatConfig,
      status: TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
      has_started: false,
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

export async function listTournaments(): Promise<TournamentSummary[]> {
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      order: "created_at.desc",
    },
  });

  if (tournaments.length === 0) {
    return [];
  }

  const tournamentIds = tournaments.map((tournament) => tournament.id);
  const players = await supabaseRestRequest<
    Pick<TournamentPlayerRow, "tournament_id">[]
  >("tournament_players", {
    query: {
      select: "tournament_id",
      tournament_id: `in.(${tournamentIds.join(",")})`,
    },
  });

  const playerCountByTournamentId = new Map<string, number>();

  for (const player of players) {
    playerCountByTournamentId.set(
      player.tournament_id,
      (playerCountByTournamentId.get(player.tournament_id) ?? 0) + 1,
    );
  }

  return tournaments.map((tournament) => ({
    ...mapTournamentRow(tournament),
    registeredPlayerCount: playerCountByTournamentId.get(tournament.id) ?? 0,
  }));
}

export async function getTournamentDetail(
  tournamentId: string,
): Promise<TournamentDetail | null> {
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${tournamentId}`,
      limit: "1",
    },
  });

  const tournament = tournaments[0];

  if (!tournament) {
    return null;
  }

  const players = await supabaseRestRequest<TournamentPlayerRow[]>(
    "tournament_players",
    {
      query: {
        select: "id,tournament_id,display_name,riot_puuid,created_at",
        tournament_id: `eq.${tournamentId}`,
        order: "created_at.asc",
      },
    },
  );
  const entries = await supabaseRestRequest<TournamentEntryRow[]>(
    "tournament_entries",
    {
      query: {
        select:
          "id,tournament_id,tournament_player_id,seed_number,display_name,created_at",
        tournament_id: `eq.${tournamentId}`,
        order: "seed_number.asc",
      },
    },
  );
  const scores = await supabaseRestRequest<TournamentScoreRow[]>(
    "tournament_scores",
    {
      query: {
        select:
          "id,tournament_id,tournament_entry_id,round_id,score,created_at",
        tournament_id: `eq.${tournamentId}`,
      },
    },
  );
  const entryById = new Map(
    entries.map((entry) => [entry.id, mapTournamentEntryRow(entry)]),
  );

  return {
    ...mapTournamentRow(tournament),
    players: players.map(mapTournamentPlayerRow),
    entries: entries.map(mapTournamentEntryRow),
    scores: scores
      .map((score) => {
        const entry = entryById.get(score.tournament_entry_id);

        if (!entry) {
          return null;
        }

        return {
          id: score.id,
          tournamentEntryId: score.tournament_entry_id,
          displayName: entry.displayName,
          seedNumber: entry.seedNumber,
          roundId: score.round_id,
          score: score.score,
          createdAt: score.created_at,
        };
      })
      .filter((score): score is TournamentScore => score !== null)
      .sort((a, b) => a.seedNumber - b.seedNumber),
  };
}

export async function registerTournamentPlayer(input: {
  tournamentId: string;
  riotAccount: VerifiedRiotAccount;
}): Promise<TournamentPlayer> {
  let rows: TournamentPlayerRow[];
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
    rows = await supabaseRestRequest<TournamentPlayerRow[]>(
      "tournament_players",
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

  return mapTournamentPlayerRow(player);
}

export async function startTournament(input: {
  tournamentId: string;
}): Promise<StartTournamentRow> {
  const rows = await supabaseRestRequest<StartTournamentRow[]>(
    "rpc/start_tournament",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
      },
    },
  );
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return the started tournament.");
  }

  return result;
}
