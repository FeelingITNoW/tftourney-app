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
  | "knockout"
  | "attrition";

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

const LOBBY_SIZE = 8;
const SEMIFINAL_SIZE = 16;
const KNOCKOUT_HALVING_FLOOR = 64;
const ATTRITION_QUALIFIER_FLOOR = 32;

function isLobbyMultiple(playerCount: number): boolean {
  return Number.isInteger(playerCount) && playerCount % LOBBY_SIZE === 0;
}

function checkmateFinal(overrides: Partial<TournamentNodeDefinition> = {}): TournamentNodeDefinition {
  return fixedNode("final", "Checkmate Final", {
    lobbySeeding: "random",
    reseed: 0,
    winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points" },
    ...overrides,
  });
}

/**
 * Field sizes for each knockout stage: halve (in whole lobbies) until the
 * field is at most 64, then drop to a 16-player semifinal before the final.
 */
function knockoutStageSizes(playerCount: number): number[] {
  const sizes = [playerCount];
  let size = playerCount;
  while (size > SEMIFINAL_SIZE) {
    size =
      size > KNOCKOUT_HALVING_FLOOR
        ? Math.max(KNOCKOUT_HALVING_FLOOR, Math.floor(size / (LOBBY_SIZE * 2)) * LOBBY_SIZE)
        : SEMIFINAL_SIZE;
    sizes.push(size);
  }
  return sizes;
}

function createKnockout(playerCount: number): TournamentFormat | null {
  if (!isLobbyMultiple(playerCount) || playerCount < SEMIFINAL_SIZE) return null;

  const sizes = knockoutStageSizes(playerCount);
  const nodeId = (size: number) => `knockout-${size}`;
  const nodes = sizes.map((size, index) => {
    const overrides: Partial<TournamentNodeDefinition> = {};
    if (index === 0) overrides.initialEntrantSlots = "all";
    if (size === SEMIFINAL_SIZE) Object.assign(overrides, { games: 2, reseed: 0 });
    const name =
      index === 0
        ? `${size} Player Opening`
        : size === SEMIFINAL_SIZE
          ? `${size} Player Semifinal`
          : `${size} Player Round`;
    return fixedNode(nodeId(size), name, overrides);
  });
  nodes.push({ ...checkmateFinal(), id: "knockout-final" });

  const edges = sizes.map((size, index) => {
    const next = sizes[index + 1];
    return next === undefined
      ? edge(`knockout-${size}-to-final`, nodeId(size), "knockout-final", LOBBY_SIZE)
      : edge(`knockout-${size}-to-${next}`, nodeId(size), nodeId(next), next);
  });

  return format(
    "knockout",
    `${sizes.join(" → ")} → Checkmate`,
    playerCount,
    nodes,
    edges,
  );
}

/** Players cut per attrition stage: roughly an eighth of the field, in whole lobbies. */
function attritionCutSize(playerCount: number): number {
  return Math.max(LOBBY_SIZE, Math.round(playerCount / (LOBBY_SIZE * LOBBY_SIZE)) * LOBBY_SIZE);
}

function attritionStageSizes(playerCount: number): number[] {
  const cut = attritionCutSize(playerCount);
  const sizes = [playerCount];
  while (sizes[sizes.length - 1] - cut >= ATTRITION_QUALIFIER_FLOOR) {
    sizes.push(sizes[sizes.length - 1] - cut);
  }
  return sizes;
}

function createAttrition(playerCount: number): TournamentFormat | null {
  if (!isLobbyMultiple(playerCount)) return null;

  const sizes = attritionStageSizes(playerCount);
  // Needs an early-qualifier stage and a last-chance stage beyond the opening.
  if (sizes.length < 3) return null;

  const nodeId = (size: number) => `attrition-${size}`;
  const lastIndex = sizes.length - 1;
  const nodes = sizes.map((size, index) => {
    if (index === 0) return fixedNode(nodeId(size), `${size} Player Opening`, { initialEntrantSlots: "all" });
    const name = index === lastIndex ? `${size} Player Final Qualifier` : `${size} Player Cut`;
    return fixedNode(nodeId(size), name, { games: index === 1 ? 2 : 1, reseed: 0 });
  });
  nodes.push(checkmateFinal({ mergeSeeding: "source_rank_interleave" }));
  nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], id: "attrition-final" };

  const rankingMetric = "tournament_points" as const;
  const earlyQualifiers = LOBBY_SIZE / 2;
  const edges: TournamentEdgeDefinition[] = [];
  sizes.forEach((size, index) => {
    const next = sizes[index + 1];
    if (next === undefined) {
      edges.push(edge(`attrition-${size}-to-final`, nodeId(size), "attrition-final", earlyQualifiers, 1, rankingMetric));
      return;
    }
    // The first cut stage sends its top finishers straight to the final.
    if (index === 1) {
      edges.push(edge(`attrition-${size}-to-final`, nodeId(size), "attrition-final", earlyQualifiers, 1, rankingMetric));
    }
    edges.push(edge(`attrition-${size}-to-${next}`, nodeId(size), nodeId(next), next, index === 1 ? 2 : 1, rankingMetric));
  });

  return format(
    "attrition",
    `${playerCount} Player Attrition to Checkmate`,
    playerCount,
    nodes,
    edges,
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
    id: "knockout",
    name: "Knockout to checkmate",
    description: "Halve the field each stage, then a 16-player semifinal into an eight-player final.",
    supportsPlayerCount: (playerCount) => createKnockout(playerCount) !== null,
  },
  {
    id: "attrition",
    name: "Attrition to checkmate",
    description: "Cut about an eighth of the field per stage and reserve four early final seats.",
    supportsPlayerCount: (playerCount) => createAttrition(playerCount) !== null,
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
  if (presetId === "knockout") return createKnockout(playerCount);
  if (presetId === "attrition") return createAttrition(playerCount);
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
