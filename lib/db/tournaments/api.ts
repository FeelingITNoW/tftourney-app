import { DatabaseRequestError } from "../supabase-rest/errors";
import { supabaseRestRequest } from "../supabase-rest/api";
import type { VerifiedRiotAccount } from "@/lib/riot/accounts/types";
import {
  TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
  type TournamentDetail,
  type TournamentPlayer,
  type TournamentPlayerRow,
  type TournamentRow,
  type TournamentSummary,
} from "./types";

const STANDARD_HOST_USER_ID = 1;

const tournamentSelect =
  "id,name,player_count,format_id,status,has_started,created_at";

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

  return {
    ...mapTournamentRow(tournament),
    players: players.map(mapTournamentPlayerRow),
  };
}

export async function registerTournamentPlayer(input: {
  tournamentId: string;
  riotAccount: VerifiedRiotAccount;
}): Promise<TournamentPlayer> {
  let rows: TournamentPlayerRow[];

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
