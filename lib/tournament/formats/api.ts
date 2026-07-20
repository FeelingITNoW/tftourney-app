import type {
  TournamentEdgeDefinition,
  TournamentEdgeFormat,
  TournamentFormat,
  TournamentFormatOption,
  TournamentInitialNodeAssignment,
  TournamentNodeDefinition,
  TournamentNodeDefaults,
  TournamentNodeFormat,
  TournamentRankingMetric,
  TournamentRoundWinCondition,
  TournamentSortDirection,
  TournamentStandingsFormat,
  TournamentStartRequirement,
  ResolvedTournamentFormat,
} from "./types";

export const DEFAULT_TOURNAMENT_FORMAT_ID = "default";

export const TOURNAMENT_FORMAT_OPTIONS: TournamentFormatOption[] = [
  { id: DEFAULT_TOURNAMENT_FORMAT_ID, name: "Default TFT Tournament Format" },
];

export function isValidTournamentFormatId(formatId: string): boolean {
  return TOURNAMENT_FORMAT_OPTIONS.some((format) => format.id === formatId);
}

const rankingMetrics: TournamentRankingMetric[] = [
  "points",
  "tournament_points",
  "current_node_firsts",
  "node_entry_seed",
];
const sortDirections: TournamentSortDirection[] = ["asc", "desc"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRankingMetric(value: unknown): value is TournamentRankingMetric {
  return typeof value === "string" && rankingMetrics.includes(value as TournamentRankingMetric);
}

function isSortDirection(value: unknown): value is TournamentSortDirection {
  return typeof value === "string" && sortDirections.includes(value as TournamentSortDirection);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: string[], path: string, errors: string[]): void {
  Object.keys(value).forEach((key) => {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not supported in schema v3.`);
  });
}

function validateTieBreakers(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }

  value.forEach((tieBreaker, index) => {
    const tieBreakerPath = `${path}[${index}]`;
    if (!isRecord(tieBreaker)) {
      errors.push(`${tieBreakerPath} must be an object.`);
      return;
    }
    assertKnownKeys(tieBreaker, ["rankingMetric", "sortDirection"], tieBreakerPath, errors);
    if (!isRankingMetric(tieBreaker.rankingMetric) || !["current_node_firsts", "node_entry_seed"].includes(tieBreaker.rankingMetric)) {
      errors.push(`${tieBreakerPath}.rankingMetric must be a node tie-breaker metric.`);
    }
    if (!isSortDirection(tieBreaker.sortDirection)) errors.push(`${tieBreakerPath}.sortDirection is invalid.`);
  });
}

function validateStandings(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  assertKnownKeys(value, ["rankingMetric", "sortDirection", "tieBreakers"], path, errors);
  if (!isRankingMetric(value.rankingMetric)) errors.push(`${path}.rankingMetric is invalid.`);
  if (!isSortDirection(value.sortDirection)) errors.push(`${path}.sortDirection is invalid.`);
  validateTieBreakers(value.tieBreakers, `${path}.tieBreakers`, errors);
}

function validateWinCondition(
  value: unknown,
  path: string,
  games: unknown,
  reseed: unknown,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  assertKnownKeys(value, ["type", "games", "threshold", "maxGames", "rankingMetric"], path, errors);
  if (value.rankingMetric !== undefined && value.rankingMetric !== "points") errors.push(`${path}.rankingMetric must be points.`);
  if (value.type === "highest_points_after_games") {
    if (!Number.isInteger(value.games) || (value.games as number) <= 0) errors.push(`${path}.games must be positive.`);
    if (!Number.isInteger(games) || games !== value.games) errors.push(`${path.replace("winCondition", "games")} must equal winCondition.games.`);
    return;
  }
  if (value.type === "checkmate") {
    if (!Number.isInteger(value.threshold) || (value.threshold as number) < 0) errors.push(`${path}.threshold must be a non-negative whole number.`);
    if (value.maxGames !== undefined && (!Number.isInteger(value.maxGames) || (value.maxGames as number) <= 0)) errors.push(`${path}.maxGames must be a positive whole number.`);
    if (games !== undefined) errors.push(`${path.replace("winCondition", "games")} must be omitted for checkmate nodes.`);
    if (reseed !== 0) errors.push(`${path.replace("winCondition", "reseed")} must be zero for checkmate nodes.`);
    return;
  }
  errors.push(`${path}.type is invalid.`);
}

function validateDefaults(value: unknown, errors: string[]): void {
  const path = "nodeDefaults";
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  assertKnownKeys(value, ["mergeSeeding", "lobbySeeding", "games", "reseed", "standings", "reseedStandings"], path, errors);
  if (value.mergeSeeding !== "random" && value.mergeSeeding !== "source_rank_interleave") errors.push(`${path}.mergeSeeding is invalid.`);
  if (value.lobbySeeding !== "snake" && value.lobbySeeding !== "random") errors.push(`${path}.lobbySeeding must be snake or random.`);
  if (value.games !== undefined && (!Number.isInteger(value.games) || (value.games as number) <= 0)) errors.push(`${path}.games must be a positive whole number.`);
  if (!Number.isInteger(value.reseed) || (value.reseed as number) < 0) errors.push(`${path}.reseed must be a non-negative whole number.`);
  validateStandings(value.standings, `${path}.standings`, errors);
  validateStandings(value.reseedStandings, `${path}.reseedStandings`, errors);
}

function mergeNode(defaults: Record<string, unknown>, node: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...defaults, ...node };
  if (isRecord(merged.winCondition) && merged.winCondition.type === "checkmate") delete merged.games;
  return merged;
}

function validateNode(
  value: unknown,
  resolved: Record<string, unknown>,
  index: number,
  nodeIds: Set<string>,
  errors: string[],
): void {
  const path = `nodes[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  assertKnownKeys(value, ["id", "name", "initialEntrantSlots", "mergeSeeding", "lobbySeeding", "games", "reseed", "standings", "reseedStandings", "winCondition", "position"], path, errors);
  if (typeof value.id !== "string" || value.id.trim() === "") errors.push(`${path}.id is required.`);
  else if (nodeIds.has(value.id)) errors.push(`${path}.id must be unique.`);
  else nodeIds.add(value.id);
  if (typeof value.name !== "string" || value.name.trim() === "") errors.push(`${path}.name is required.`);
  if (value.initialEntrantSlots !== undefined && value.initialEntrantSlots !== "all" && (!Number.isInteger(value.initialEntrantSlots) || (value.initialEntrantSlots as number) <= 0)) errors.push(`${path}.initialEntrantSlots must be positive or all.`);
  if (resolved.mergeSeeding !== "random" && resolved.mergeSeeding !== "source_rank_interleave") errors.push(`${path}.mergeSeeding is invalid.`);
  if (resolved.lobbySeeding !== "snake" && resolved.lobbySeeding !== "random") errors.push(`${path}.lobbySeeding must be snake or random.`);
  validateStandings(resolved.standings, `${path}.standings`, errors);
  validateStandings(resolved.reseedStandings, `${path}.reseedStandings`, errors);
  if (value.winCondition !== undefined && resolved.winCondition === undefined) errors.push(`${path}.winCondition is invalid.`);
  if (resolved.winCondition !== undefined) validateWinCondition(resolved.winCondition, `${path}.winCondition`, resolved.games, resolved.reseed, errors);
  const isCheckmate = isRecord(resolved.winCondition) && resolved.winCondition.type === "checkmate";
  if (!isCheckmate && (!Number.isInteger(resolved.games) || (resolved.games as number) <= 0)) errors.push(`${path}.games must be a positive whole number.`);
  if (!Number.isInteger(resolved.reseed) || (resolved.reseed as number) < 0) errors.push(`${path}.reseed must be a non-negative whole number.`);
  else if (!isCheckmate && Number.isInteger(resolved.games) && (resolved.reseed as number) > (resolved.games as number)) errors.push(`${path}.reseed must be between 0 and games.`);
  if (resolved.position !== undefined && (!isRecord(resolved.position) || typeof resolved.position.x !== "number" || typeof resolved.position.y !== "number")) errors.push(`${path}.position must contain numeric x and y.`);
}

function validateEdge(value: unknown, index: number, nodeIds: Set<string>, edgeIds: Set<string>, priorities: Map<string, Set<number>>, errors: string[]): void {
  const path = `edges[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  assertKnownKeys(value, ["id", "sourceNodeId", "destinationNodeId", "priority", "condition"], path, errors);
  if (typeof value.id !== "string" || value.id.trim() === "") errors.push(`${path}.id is required.`);
  else if (edgeIds.has(value.id)) errors.push(`${path}.id must be unique.`);
  else edgeIds.add(value.id);
  const source = value.sourceNodeId;
  const destination = value.destinationNodeId;
  if (typeof source !== "string" || !nodeIds.has(source)) errors.push(`${path}.sourceNodeId must reference a node.`);
  if (typeof destination !== "string" || !nodeIds.has(destination)) errors.push(`${path}.destinationNodeId must reference a node.`);
  if (source === destination) errors.push(`${path} cannot connect a node to itself.`);
  if (!Number.isInteger(value.priority) || (value.priority as number) <= 0) errors.push(`${path}.priority must be positive.`);
  else if (typeof source === "string") {
    const sourcePriorities = priorities.get(source) ?? new Set<number>();
    if (sourcePriorities.has(value.priority as number)) errors.push(`${path}.priority must be unique for its source node.`);
    sourcePriorities.add(value.priority as number);
    priorities.set(source, sourcePriorities);
  }
  if (!isRecord(value.condition)) {
    errors.push(`${path}.condition must be an object.`);
    return;
  }
  assertKnownKeys(value.condition, ["type", "count", "rankingMetric"], `${path}.condition`, errors);
  if (value.condition.type !== "top_n") errors.push(`${path}.condition.type must be top_n.`);
  if (!Number.isInteger(value.condition.count) || (value.condition.count as number) <= 0) errors.push(`${path}.condition.count must be positive.`);
  if (value.condition.rankingMetric !== undefined && value.condition.rankingMetric !== "points") errors.push(`${path}.condition.rankingMetric must be points.`);
}

function hasCycle(nodes: Set<string>, edges: TournamentEdgeFormat[]): boolean {
  const incoming = new Map([...nodes].map((node) => [node, 0]));
  const outgoing = new Map<string, string[]>([...nodes].map((node) => [node, []]));
  for (const edge of edges) {
    incoming.set(edge.destinationNodeId, (incoming.get(edge.destinationNodeId) ?? 0) + 1);
    outgoing.get(edge.sourceNodeId)?.push(edge.destinationNodeId);
  }
  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([node]) => node);
  let visited = 0;
  while (queue.length) {
    const node = queue.shift() as string;
    visited += 1;
    for (const destination of outgoing.get(node) ?? []) {
      const next = (incoming.get(destination) ?? 0) - 1;
      incoming.set(destination, next);
      if (next === 0) queue.push(destination);
    }
  }
  return visited !== nodes.size;
}

function resolvedWinCondition(value: unknown): TournamentRoundWinCondition | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "highest_points_after_games") {
    return { type: "highest_points_after_games", games: Number(value.games), rankingMetric: "points" };
  }
  if (value.type === "checkmate") {
    return {
      type: "checkmate",
      threshold: Number(value.threshold),
      rankingMetric: "points",
      ...(value.maxGames === undefined ? {} : { maxGames: Number(value.maxGames) }),
    };
  }
  return undefined;
}

function resolveNode(defaults: TournamentNodeDefaults, node: TournamentNodeDefinition): TournamentNodeFormat {
  const merged = mergeNode(defaults as unknown as Record<string, unknown>, node as unknown as Record<string, unknown>);
  return {
    id: String(merged.id),
    name: String(merged.name),
    ...(merged.initialEntrantSlots === undefined ? {} : { initialEntrantSlots: merged.initialEntrantSlots as number | "all" }),
    mergeSeeding: merged.mergeSeeding as TournamentNodeFormat["mergeSeeding"],
    lobbySeeding: merged.lobbySeeding as TournamentNodeFormat["lobbySeeding"],
    ...(merged.games === undefined ? {} : { games: Number(merged.games) }),
    reseed: Number(merged.reseed),
    standings: merged.standings as TournamentStandingsFormat,
    reseedStandings: merged.reseedStandings as TournamentStandingsFormat,
    ...(merged.winCondition === undefined ? {} : { winCondition: resolvedWinCondition(merged.winCondition) }),
    ...(merged.position === undefined ? {} : { position: merged.position as { x: number; y: number } }),
  };
}

function resolveEdge(edge: TournamentEdgeDefinition): TournamentEdgeFormat {
  return {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    destinationNodeId: edge.destinationNodeId,
    priority: edge.priority,
    condition: { type: "top_n", count: edge.condition.count, rankingMetric: "points" },
  };
}

export type TournamentFormatValidation =
  | { success: true; data: ResolvedTournamentFormat; errors: string[] }
  | { success: false; data: null; errors: string[] };

export function validateTournamentFormat(value: unknown): TournamentFormatValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, data: null, errors: ["Format must be an object."] };
  assertKnownKeys(value, ["schemaVersion", "id", "name", "isDefault", "placementPoints", "startRequirement", "nodeDefaults", "nodes", "edges"], "format", errors);
  if (value.schemaVersion !== 3) errors.push("schemaVersion must be 3.");
  if (typeof value.id !== "string" || value.id.trim() === "") errors.push("Format id is required.");
  if (typeof value.name !== "string" || value.name.trim() === "") errors.push("Format name is required.");
  if (value.isDefault !== undefined && typeof value.isDefault !== "boolean") errors.push("isDefault must be boolean.");
  if (!isRecord(value.placementPoints)) errors.push("placementPoints must be an object.");
  else Object.entries(value.placementPoints).forEach(([placement, points]) => {
    if (!/^\d+$/.test(placement) || !Number.isFinite(points) || (points as number) < 0) errors.push(`placementPoints.${placement} must be a non-negative number.`);
  });
  if (!isRecord(value.startRequirement)) errors.push("startRequirement must be an object.");
  else assertKnownKeys(value.startRequirement, ["minimumEntrants", "exactEntrants"], "startRequirement", errors);
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) errors.push("Format must define at least one node.");
  if (!Array.isArray(value.edges)) errors.push("edges must be an array.");
  validateDefaults(value.nodeDefaults, errors);

  const defaults = isRecord(value.nodeDefaults) ? value.nodeDefaults : {};
  const nodeValues = Array.isArray(value.nodes) ? value.nodes : [];
  const nodeIds = new Set<string>();
  const resolvedNodes = nodeValues.map((node) => resolveNode(defaults as unknown as TournamentNodeDefaults, node as TournamentNodeDefinition));
  nodeValues.forEach((node, index) => validateNode(node, resolvedNodes[index] as unknown as Record<string, unknown>, index, nodeIds, errors));

  const edgeValues = Array.isArray(value.edges) ? value.edges : [];
  const edgeIds = new Set<string>();
  const priorities = new Map<string, Set<number>>();
  edgeValues.forEach((edge, index) => validateEdge(edge, index, nodeIds, edgeIds, priorities, errors));
  const resolvedEdges = edgeValues.map((edge) => resolveEdge(edge as TournamentEdgeDefinition));

  if (!hasCycle(nodeIds, resolvedEdges)) {
    const incoming = new Set(resolvedEdges.map((edge) => edge.destinationNodeId));
    resolvedNodes.filter((node) => !incoming.has(node.id)).forEach((root) => {
      if (root.initialEntrantSlots === undefined) errors.push(`nodes.${root.id}.initialEntrantSlots is required for an entry node.`);
    });
    resolvedNodes.filter((node) => incoming.has(node.id) && node.initialEntrantSlots !== undefined).forEach((node) => errors.push(`nodes.${node.id}.initialEntrantSlots is only allowed on entry nodes.`));
  } else {
    errors.push("Format graph must be acyclic.");
  }

  const requirementValue = isRecord(value.startRequirement) ? value.startRequirement : {};
  const requirement: TournamentStartRequirement = {
    minimumEntrants: Number(requirementValue.minimumEntrants),
    exactEntrants: requirementValue.exactEntrants === undefined || requirementValue.exactEntrants === null ? null : Number(requirementValue.exactEntrants),
  };
  if (!Number.isInteger(requirement.minimumEntrants) || requirement.minimumEntrants < 1) errors.push("startRequirement.minimumEntrants must be positive.");
  if (requirement.exactEntrants !== null && (!Number.isInteger(requirement.exactEntrants) || requirement.exactEntrants < requirement.minimumEntrants)) errors.push("startRequirement.exactEntrants must be at least minimumEntrants.");

  if (errors.length) return { success: false, data: null, errors };
  return {
    success: true,
    data: {
      schemaVersion: 3,
      id: value.id as string,
      name: value.name as string,
      ...(value.isDefault === true ? { isDefault: true } : {}),
      placementPoints: value.placementPoints as Record<string, number>,
      startRequirement: requirement,
      nodeDefaults: defaults as TournamentNodeDefaults,
      nodes: resolvedNodes,
      edges: resolvedEdges,
    },
    errors: [],
  };
}

export function resolveTournamentFormat(value: unknown): ResolvedTournamentFormat | null {
  const result = validateTournamentFormat(value);
  return result.success ? result.data : null;
}

export function isValidTournamentFormat(value: unknown): value is TournamentFormat {
  return validateTournamentFormat(value).success;
}

export function canonicalizeTournamentFormat(value: unknown): TournamentFormat | null {
  const result = validateTournamentFormat(value);
  if (!result.success) return null;
  const resolved = result.data;
  const defaults = resolved.nodeDefaults as unknown as Record<string, unknown>;
  const nodes = resolved.nodes.map((node) => {
    const compact: Record<string, unknown> = { id: node.id, name: node.name };
    (["initialEntrantSlots", "position"] as const).forEach((key) => {
      if (node[key] !== undefined) compact[key] = node[key];
    });
    (["mergeSeeding", "lobbySeeding", "games", "reseed", "standings", "reseedStandings"] as const).forEach((key) => {
      if (node[key] !== undefined && JSON.stringify(node[key]) !== JSON.stringify(defaults[key])) compact[key] = node[key];
    });
    if (node.winCondition) {
      const condition: Record<string, unknown> = { type: node.winCondition.type };
      if (node.winCondition.type === "highest_points_after_games") condition.games = node.winCondition.games;
      else {
        condition.threshold = node.winCondition.threshold;
        if (node.winCondition.maxGames !== undefined) condition.maxGames = node.winCondition.maxGames;
      }
      compact.winCondition = condition;
    }
    return compact as TournamentNodeDefinition;
  });
  return {
    schemaVersion: 3,
    id: resolved.id,
    name: resolved.name,
    ...(resolved.isDefault ? { isDefault: true } : {}),
    placementPoints: resolved.placementPoints,
    startRequirement: {
      minimumEntrants: resolved.startRequirement.minimumEntrants,
      ...(resolved.startRequirement.exactEntrants === null ? {} : { exactEntrants: resolved.startRequirement.exactEntrants }),
    },
    nodeDefaults: resolved.nodeDefaults,
    nodes,
    edges: resolved.edges.map((edge) => ({
      ...edge,
      condition: { type: "top_n", count: edge.condition.count },
    })),
  };
}

export function getTournamentStartRequirement(value: unknown): TournamentStartRequirement {
  if (isRecord(value) && isRecord(value.startRequirement)) {
    return {
      minimumEntrants: Number(value.startRequirement.minimumEntrants),
      exactEntrants: value.startRequirement.exactEntrants === undefined || value.startRequirement.exactEntrants === null ? null : Number(value.startRequirement.exactEntrants),
    };
  }
  return { minimumEntrants: 1, exactEntrants: null };
}

export function getFormatGraph(value: unknown): { nodes: TournamentNodeFormat[]; edges: TournamentEdgeFormat[] } {
  const resolved = resolveTournamentFormat(value);
  return resolved ? { nodes: resolved.nodes, edges: resolved.edges } : { nodes: [], edges: [] };
}

export type OrderedAdvancement = TournamentEdgeFormat & { participantIds: string[] };

export function selectOrderedTopNAdvancements<T extends { id: string }>(players: T[], edges: TournamentEdgeFormat[]): { advancements: OrderedAdvancement[]; eliminatedParticipantIds: string[] } {
  const remaining = [...players];
  const advancements = [...edges].sort((first, second) => first.priority - second.priority || first.id.localeCompare(second.id)).map((edge) => {
    const selected = remaining.splice(0, edge.condition.count);
    return { ...edge, participantIds: selected.map((player) => player.id) };
  });
  return { advancements, eliminatedParticipantIds: remaining.map((player) => player.id) };
}

export function getInitialNodeAssignments(value: unknown, assignments: TournamentInitialNodeAssignment[]): TournamentInitialNodeAssignment[] {
  const graph = getFormatGraph(value);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const incoming = new Set(graph.edges.map((edge) => edge.destinationNodeId));
  return assignments.filter((assignment) => nodeIds.has(assignment.nodeId) && !incoming.has(assignment.nodeId));
}
