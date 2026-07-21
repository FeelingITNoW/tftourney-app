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
  | "node_entry_seed";

export type TournamentSortDirection = "asc" | "desc";

export type TournamentAdvancementRankingMetric = "points" | "tournament_points";

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
  rankingMetric: TournamentAdvancementRankingMetric;
};

export type TournamentTopNConditionDefinition = Omit<TournamentTopNCondition, "rankingMetric"> & {
  rankingMetric?: TournamentAdvancementRankingMetric;
};

export type TournamentNodeMergeSeeding = "random" | "source_rank_interleave";

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

export type TournamentWinConditionDefinition =
  | Omit<TournamentFixedGamesWinCondition, "rankingMetric"> & { rankingMetric?: "points" }
  | Omit<TournamentCheckmateWinCondition, "rankingMetric"> & { rankingMetric?: "points" };

/** Complete node configuration after `nodeDefaults` have been applied. */
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

/** Optional per-node overrides in the compact v3 JSON. */
export type TournamentNodeDefinition = Pick<TournamentNodeFormat, "id" | "name"> &
  Partial<Omit<TournamentNodeFormat, "id" | "name">> & {
    winCondition?: TournamentWinConditionDefinition;
  };

/** Shared node fields. Structured fields are overridden as a whole. */
export type TournamentNodeDefaults = Omit<
  TournamentNodeFormat,
  "id" | "name" | "initialEntrantSlots" | "position" | "winCondition"
>;

export type TournamentEdgeFormat = {
  id: string;
  sourceNodeId: string;
  destinationNodeId: string;
  priority: number;
  condition: TournamentTopNCondition;
};

export type TournamentEdgeDefinition = Omit<TournamentEdgeFormat, "condition"> & {
  condition: TournamentTopNConditionDefinition;
};

/** Canonical serialized tournament format. */
export type TournamentFormat = {
  schemaVersion: 3;
  id: string;
  name: string;
  isDefault?: boolean;
  placementPoints: Record<string, number>;
  startRequirement: {
    minimumEntrants: number;
    exactEntrants?: number;
  };
  nodeDefaults: TournamentNodeDefaults;
  nodes: TournamentNodeDefinition[];
  edges: TournamentEdgeDefinition[];
};

export type ResolvedTournamentFormat = Omit<TournamentFormat, "startRequirement" | "nodeDefaults" | "nodes" | "edges"> & {
  startRequirement: TournamentStartRequirement;
  nodeDefaults: TournamentNodeDefaults;
  nodes: TournamentNodeFormat[];
  edges: TournamentEdgeFormat[];
};

export type TournamentInitialNodeAssignment = {
  registrationId: string;
  nodeId: string;
};
