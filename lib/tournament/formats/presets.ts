import type {
  TournamentEdgeDefinition,
  TournamentFormat,
  TournamentNodeDefinition,
  TournamentTopNConditionDefinition,
} from "./types";
import { resolveTournamentFormat, validateTournamentFormat } from "./api";

export type TournamentFormatPresetId =
  | "custom"
  | "default"
  | "adjacent-lobby-bracket"
  | "128-knockout"
  | "128-attrition";

export type TournamentFormatPreset = {
  id: TournamentFormatPresetId;
  name: string;
  description: string;
  supportsPlayerCount: (playerCount: number) => boolean;
};

export type TournamentFormatFlowAnalysis = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  nodeProjectedEntrants: Record<string, number | null>;
  edgeProjectedEntrants: Record<string, number | null>;
  edgeEliminatedEntrants: Record<string, number | null>;
};

const tieBreakers = [
  { rankingMetric: "current_node_firsts" as const, sortDirection: "desc" as const },
  { rankingMetric: "node_entry_seed" as const, sortDirection: "asc" as const },
];

const defaultNodeDefaults = {
  mergeSeeding: "random" as const,
  lobbySeeding: "snake" as const,
  games: 6,
  reseed: 2,
  standings: {
    rankingMetric: "points" as const,
    sortDirection: "desc" as const,
    tieBreakers,
  },
  reseedStandings: {
    rankingMetric: "tournament_points" as const,
    sortDirection: "desc" as const,
    tieBreakers,
  },
};

const placementPoints = Object.fromEntries(
  Array.from({ length: 8 }, (_, index) => [String(index + 1), 8 - index]),
);

function fixedNode(
  id: string,
  name: string,
  overrides: Partial<TournamentNodeDefinition> = {},
): TournamentNodeDefinition {
  return { id, name, ...overrides };
}

function edge(
  id: string,
  sourceNodeId: string,
  destinationNodeId: string,
  count: number,
  priority = 1,
  rankingMetric: TournamentTopNConditionDefinition["rankingMetric"] = "points",
): TournamentEdgeDefinition {
  return {
    id,
    sourceNodeId,
    destinationNodeId,
    priority,
    condition: {
      type: "top_n",
      count,
      ...(rankingMetric === "points" ? {} : { rankingMetric }),
    },
  };
}

function format(
  id: string,
  name: string,
  exactEntrants: number,
  nodes: TournamentNodeDefinition[],
  edges: TournamentEdgeDefinition[],
): TournamentFormat {
  return {
    schemaVersion: 3,
    id,
    name,
    startRequirement: { minimumEntrants: exactEntrants, exactEntrants },
    placementPoints,
    nodeDefaults: defaultNodeDefaults,
    nodes,
    edges,
  };
}

function createAdjacentBracket(playerCount: number): TournamentFormat | null {
  const lobbyCount = playerCount / 8;
  if (!Number.isInteger(lobbyCount) || lobbyCount < 2 || (lobbyCount & (lobbyCount - 1)) !== 0) {
    return null;
  }

  const stageCounts: number[] = [];
  for (let count = lobbyCount; count >= 1; count /= 2) stageCounts.push(count);

  const nodes: TournamentNodeDefinition[] = [];
  stageCounts.forEach((count, stage) => {
    for (let index = 0; index < count; index += 1) {
      const isFinal = stage === stageCounts.length - 1;
      nodes.push(
        fixedNode(
          `bracket-${stage + 1}-${index + 1}`,
          isFinal ? "Checkmate Final" : `Bracket ${stage + 1}-${index + 1}`,
          stage === 0
            ? { initialEntrantSlots: 8, games: 1, reseed: 0 }
            : isFinal
              ? {
                  mergeSeeding: "source_rank_interleave",
                  lobbySeeding: "random",
                  reseed: 0,
                  winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points" },
                }
              : { mergeSeeding: "source_rank_interleave", games: 1, reseed: 0 },
        ),
      );
    }
  });

  const edges: TournamentEdgeDefinition[] = [];
  for (let stage = 0; stage < stageCounts.length - 1; stage += 1) {
    for (let index = 0; index < stageCounts[stage]; index += 1) {
      const destinationIndex = Math.floor(index / 2);
      edges.push(
        edge(
          `bracket-${stage + 1}-${index + 1}-to-${stage + 2}-${destinationIndex + 1}`,
          `bracket-${stage + 1}-${index + 1}`,
          `bracket-${stage + 2}-${destinationIndex + 1}`,
          4,
        ),
      );
    }
  }

  return format(
    "adjacent-lobby-bracket",
    `${playerCount}-Player Adjacent Lobby Bracket`,
    playerCount,
    nodes,
    edges,
  );
}

function createKnockout(): TournamentFormat {
  return format(
    "128-knockout",
    "128 → 64 → 16 → Checkmate",
    128,
    [
      fixedNode("knockout-128", "128 Player Opening", { initialEntrantSlots: "all" }),
      fixedNode("knockout-64", "64 Player Round"),
      fixedNode("knockout-16", "16 Player Semifinal", { games: 2, reseed: 0 }),
      fixedNode("knockout-final", "Checkmate Final", {
        lobbySeeding: "random",
        reseed: 0,
        winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points" },
      }),
    ],
    [
      edge("knockout-128-to-64", "knockout-128", "knockout-64", 64),
      edge("knockout-64-to-16", "knockout-64", "knockout-16", 16),
      edge("knockout-16-to-final", "knockout-16", "knockout-final", 8),
    ],
  );
}

function createAttrition(): TournamentFormat {
  const nodes = [
    fixedNode("attrition-128", "128 Player Opening", { initialEntrantSlots: "all" }),
    fixedNode("attrition-112", "112 Player Cut", { games: 2, reseed: 0 }),
    fixedNode("attrition-96", "96 Player Cut", { games: 1, reseed: 0 }),
    fixedNode("attrition-80", "80 Player Cut", { games: 1, reseed: 0 }),
    fixedNode("attrition-64", "64 Player Cut", { games: 1, reseed: 0 }),
    fixedNode("attrition-48", "48 Player Cut", { games: 1, reseed: 0 }),
    fixedNode("attrition-32", "32 Player Final Qualifier", { games: 1, reseed: 0 }),
    fixedNode("attrition-final", "Checkmate Final", {
      mergeSeeding: "source_rank_interleave",
      lobbySeeding: "random",
      reseed: 0,
      winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points" },
    }),
  ];
  const rankingMetric = "tournament_points" as const;

  return format(
    "128-attrition",
    "128 Player Attrition to Checkmate",
    128,
    nodes,
    [
      edge("attrition-128-to-112", "attrition-128", "attrition-112", 112, 1, rankingMetric),
      edge("attrition-112-to-final", "attrition-112", "attrition-final", 4, 1, rankingMetric),
      edge("attrition-112-to-96", "attrition-112", "attrition-96", 96, 2, rankingMetric),
      edge("attrition-96-to-80", "attrition-96", "attrition-80", 80, 1, rankingMetric),
      edge("attrition-80-to-64", "attrition-80", "attrition-64", 64, 1, rankingMetric),
      edge("attrition-64-to-48", "attrition-64", "attrition-48", 48, 1, rankingMetric),
      edge("attrition-48-to-32", "attrition-48", "attrition-32", 32, 1, rankingMetric),
      edge("attrition-32-to-final", "attrition-32", "attrition-final", 4, 1, rankingMetric),
    ],
  );
}

export const TOURNAMENT_FORMAT_PRESETS: TournamentFormatPreset[] = [
  {
    id: "custom",
    name: "Custom format",
    description: "Start with one configurable opening node.",
    supportsPlayerCount: (playerCount) => Number.isInteger(playerCount) && playerCount >= 8,
  },
  {
    id: "default",
    name: "Default TFT",
    description: "Six-game opening with reseeding and an eight-player checkmate final.",
    supportsPlayerCount: (playerCount) => Number.isInteger(playerCount) && playerCount >= 8,
  },
  {
    id: "adjacent-lobby-bracket",
    name: "Adjacent-lobby bracket",
    description: "Top four from each adjacent lobby merge into the next stage.",
    supportsPlayerCount: (playerCount) => createAdjacentBracket(playerCount) !== null,
  },
  {
    id: "128-knockout",
    name: "128 → 64 → 16 → Checkmate",
    description: "A fixed-field knockout path into an eight-player final.",
    supportsPlayerCount: (playerCount) => playerCount === 128,
  },
  {
    id: "128-attrition",
    name: "128-player attrition",
    description: "Cut 16 players per stage and reserve four early final seats.",
    supportsPlayerCount: (playerCount) => playerCount === 128,
  },
];

export function createTournamentFormatPreset(
  presetId: TournamentFormatPresetId,
  playerCount: number,
): TournamentFormat | null {
  if (presetId === "default") {
    return format(
      "default",
      "Default TFT Tournament Format",
      playerCount,
      [
        fixedNode("opening-round", "Opening Round", { initialEntrantSlots: "all" }),
        fixedNode("final-round", "Checkmate Final", {
          lobbySeeding: "random",
          reseed: 0,
          winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points" },
        }),
      ],
      [edge("opening-to-final", "opening-round", "final-round", 8)],
    );
  }
  if (presetId === "adjacent-lobby-bracket") return createAdjacentBracket(playerCount);
  if (presetId === "128-knockout") return playerCount === 128 ? createKnockout() : null;
  if (presetId === "128-attrition") return playerCount === 128 ? createAttrition() : null;
  return format(
    "custom",
    "Custom TFT Tournament Format",
    playerCount,
    [fixedNode("opening-round", "Opening Round", { initialEntrantSlots: "all" })],
    [],
  );
}

function topologicalOrder(nodes: string[], edges: TournamentFormat["edges"]): string[] | null {
  const incoming = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, [] as string[]]));
  edges.forEach((currentEdge) => {
    incoming.set(currentEdge.destinationNodeId, (incoming.get(currentEdge.destinationNodeId) ?? 0) + 1);
    outgoing.get(currentEdge.sourceNodeId)?.push(currentEdge.destinationNodeId);
  });
  const queue = nodes.filter((node) => incoming.get(node) === 0);
  const ordered: string[] = [];
  while (queue.length) {
    const node = queue.shift() as string;
    ordered.push(node);
    for (const destination of outgoing.get(node) ?? []) {
      const next = (incoming.get(destination) ?? 0) - 1;
      incoming.set(destination, next);
      if (next === 0) queue.push(destination);
    }
  }
  return ordered.length === nodes.length ? ordered : null;
}

export function analyzeTournamentFormat(
  value: unknown,
  entrantCount: number,
): TournamentFormatFlowAnalysis {
  const validation = validateTournamentFormat(value);
  const empty: TournamentFormatFlowAnalysis = {
    valid: false,
    errors: validation.success ? [] : [...validation.errors],
    warnings: [],
    nodeProjectedEntrants: {},
    edgeProjectedEntrants: {},
    edgeEliminatedEntrants: {},
  };
  if (!validation.success) return empty;

  const format = resolveTournamentFormat(value);
  if (!format) return empty;
  const nodeIds = format.nodes.map((node) => node.id);
  const order = topologicalOrder(nodeIds, format.edges);
  if (!order) return { ...empty, errors: [...empty.errors, "Format graph must be acyclic."] };

  const incoming = new Set(format.edges.map((currentEdge) => currentEdge.destinationNodeId));
  const projected = new Map<string, number | null>();
  const errors: string[] = [...empty.errors];
  if (format.startRequirement.exactEntrants !== null && format.startRequirement.exactEntrants !== entrantCount) {
    errors.push(`Format requires exactly ${format.startRequirement.exactEntrants} entrants.`);
  }
  if (format.startRequirement.minimumEntrants > entrantCount) {
    errors.push(`Format requires at least ${format.startRequirement.minimumEntrants} entrants.`);
  }
  const warnings: string[] = [];
  const roots = format.nodes.filter((node) => !incoming.has(node.id));
  const allRoots = roots.filter((node) => node.initialEntrantSlots === "all");
  if (allRoots.length > 1) errors.push("Only one entry node may use all entrants.");
  if (allRoots.length === 1 && roots.length > 1) errors.push("An all-entrant entry node cannot be combined with other entry nodes.");

  const rootTotal = roots.reduce((total, node) => total + (typeof node.initialEntrantSlots === "number" ? node.initialEntrantSlots : 0), 0);
  if (roots.length > 1 && allRoots.length === 0 && rootTotal !== entrantCount) {
    errors.push(`Entry node capacities must total ${entrantCount} entrants.`);
  }
  roots.forEach((node) => {
    projected.set(node.id, node.initialEntrantSlots === "all" ? entrantCount : node.initialEntrantSlots ?? null);
  });

  const edgeProjectedEntrants: Record<string, number | null> = {};
  const edgeEliminatedEntrants: Record<string, number | null> = {};
  const outgoing = new Map<string, TournamentFormat["edges"]>();
  format.edges.forEach((currentEdge) => outgoing.set(currentEdge.sourceNodeId, [...(outgoing.get(currentEdge.sourceNodeId) ?? []), currentEdge]));
  outgoing.forEach((sourceEdges) => sourceEdges.sort((first, second) => first.priority - second.priority || first.id.localeCompare(second.id)));

  for (const nodeId of order) {
    const entrants = projected.get(nodeId) ?? null;
    const node = format.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) continue;
    if (node.winCondition?.type === "checkmate" && entrants !== 8) {
      errors.push(`${node.name} must receive exactly 8 entrants for checkmate.`);
    }
    let remaining = entrants;
    for (const currentEdge of outgoing.get(nodeId) ?? []) {
      const count = currentEdge.condition.count;
      const moved = remaining === null ? null : Math.min(count, Math.max(remaining, 0));
      edgeProjectedEntrants[currentEdge.id] = moved;
      edgeEliminatedEntrants[currentEdge.id] = remaining === null ? null : Math.max(remaining - count, 0);
      if (remaining !== null && count > remaining) errors.push(`${currentEdge.id} advances ${count}, but ${node.name} has only ${remaining} entrants.`);
      const destination = currentEdge.destinationNodeId;
      const previous = projected.get(destination);
      projected.set(destination, previous === null || moved === null ? null : (previous ?? 0) + moved);
      remaining = remaining === null ? null : Math.max(remaining - count, 0);
    }
    if (entrants !== null && entrants > 0 && entrants % 8 !== 0) warnings.push(`${node.name} has ${entrants} entrants, which creates a partial TFT lobby.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodeProjectedEntrants: Object.fromEntries(projected),
    edgeProjectedEntrants,
    edgeEliminatedEntrants,
  };
}
