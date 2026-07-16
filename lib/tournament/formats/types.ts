import type { LobbySeedingStrategy } from "../lobbies/types";

export type TournamentFormatOption = {
  id: string;
  name: string;
};

export type TournamentRankingMetric =
  | "points"
  | "tournament_points"
  | "current_round_firsts"
  | "round_entry_seed";

export type TournamentSortDirection = "asc" | "desc";

export type TournamentTieBreaker = {
  rankingMetric: Exclude<TournamentRankingMetric, "points" | "tournament_points">;
  sortDirection: TournamentSortDirection;
};

export type TournamentStandingsFormat = {
  rankingMetric: TournamentRankingMetric;
  sortDirection: TournamentSortDirection;
  tieBreakers: TournamentTieBreaker[];
};

export type TournamentAdvancementFormat = {
  type: "top_n";
  count: number;
  rankingMetric: "points";
  destinationRoundId: string;
};

export type TournamentRoundFormat = {
  id: string;
  name: string;
  lobbySeeding: LobbySeedingStrategy;
  games: number;
  reseed: number;
  standings: TournamentStandingsFormat;
  reseedStandings: TournamentStandingsFormat;
  advancement?: TournamentAdvancementFormat;
  winCondition?: {
    type: "highest_points_after_games";
    games: number;
    rankingMetric: "points";
  };
};

export type TournamentFormat = {
  id: string;
  name: string;
  isDefault?: boolean;
  placementPoints: Record<string, number>;
  rounds: TournamentRoundFormat[];
};
