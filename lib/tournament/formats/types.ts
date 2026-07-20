import type { LobbySeedingStrategy } from "../lobbies/types";

export type TournamentFormatOption = {
  id: string;
  name: string;
};

export type TournamentStartRequirement = {
  minimumEntrants: number;
  exactEntrants: number | null;
};

export type TournamentRankingMetric =
  | "points"
  | "tournament_points"
  | "current_node_firsts"
  | "node_entry_seed"
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

export type TournamentTopNCondition = {
  type: "top_n";
  count: number;
  rankingMetric: "points";
};

export type TournamentAdvancementFormat = {
  type: "top_n";
  count: number;
  rankingMetric: "points";
  destinationRoundId: string;
};

export type TournamentEdgeFormat = {
  id: string;
  sourceNodeId: string;
  destinationNodeId: string;
  priority: number;
  condition: TournamentTopNCondition;
};

export type TournamentNodeMergeSeeding = "random" | "source_rank_interleave";

export type TournamentNodeFormat = {
  id: string;
  name: string;
  initialEntrantSlots?: number | "all";
  mergeSeeding: TournamentNodeMergeSeeding;
  lobbySeeding: LobbySeedingStrategy;
  games?: number;
  reseed: number;
  standings: TournamentStandingsFormat;
  reseedStandings: TournamentStandingsFormat;
  winCondition?: TournamentRoundWinCondition;
  position?: { x: number; y: number };
};

export type TournamentRoundType = "qualifier" | "final";

export type TournamentFixedGamesWinCondition = {
  type: "highest_points_after_games";
  games: number;
  rankingMetric: "points";
};

export type TournamentCheckmateWinCondition = {
  type: "checkmate";
  threshold: number;
  rankingMetric: "points";
  maxGames?: number;
};

export type TournamentRoundWinCondition =
  | TournamentFixedGamesWinCondition
  | TournamentCheckmateWinCondition;

/** @deprecated Use TournamentNodeFormat. Kept for legacy callers during migration. */
export type TournamentRoundFormat = Omit<TournamentNodeFormat, "mergeSeeding" | "initialEntrantSlots"> & {
  type?: TournamentRoundType;
  mergeSeeding?: TournamentNodeMergeSeeding;
  initialEntrantSlots?: number | "all";
  advancement?: TournamentAdvancementFormat;
};

export type TournamentFormat = {
  schemaVersion: 2;
  id: string;
  name: string;
  isDefault?: boolean;
  placementPoints: Record<string, number>;
  startRequirement: TournamentStartRequirement;
  nodes: TournamentNodeFormat[];
  edges: TournamentEdgeFormat[];
};

export type TournamentInitialNodeAssignment = {
  registrationId: string;
  nodeId: string;
};
