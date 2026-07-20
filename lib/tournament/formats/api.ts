import type {
  TournamentEdgeFormat,
  TournamentFormat,
  TournamentFormatOption,
  TournamentInitialNodeAssignment,
  TournamentNodeFormat,
  TournamentNodeMergeSeeding,
  TournamentRankingMetric,
  TournamentSortDirection,
  TournamentStartRequirement,
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
  // Read old snapshots while users migrate their format definitions.
  "current_round_firsts" as TournamentRankingMetric,
  "round_entry_seed" as TournamentRankingMetric,
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

function validateTieBreakers(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }

  value.forEach((tieBreaker, index) => {
    const tieBreakerPath = `${path}[${index}]`;
    if (!isRecord(tieBreaker) || !isRankingMetric(tieBreaker.rankingMetric)) {
      errors.push(`${tieBreakerPath}.rankingMetric is invalid.`);
    } else if (
      !["current_node_firsts", "node_entry_seed", "current_round_firsts", "round_entry_seed"].includes(
        tieBreaker.rankingMetric,
      )
    ) {
      errors.push(`${tieBreakerPath}.rankingMetric must be a tie-breaker metric.`);
    }
    if (!isRecord(tieBreaker) || !isSortDirection(tieBreaker.sortDirection)) {
      errors.push(`${tieBreakerPath}.sortDirection is invalid.`);
    }
  });
}

function validateStandings(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (!isRankingMetric(value.rankingMetric)) errors.push(`${path}.rankingMetric is invalid.`);
  if (!isSortDirection(value.sortDirection)) errors.push(`${path}.sortDirection is invalid.`);
  validateTieBreakers(value.tieBreakers, `${path}.tieBreakers`, errors);
}

function validateWinCondition(value: unknown, path: string, games: unknown, reseed: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (value.type === "highest_points_after_games") {
    if (value.rankingMetric !== "points") errors.push(`${path}.rankingMetric must be points.`);
    if (!Number.isInteger(value.games) || (value.games as number) <= 0) errors.push(`${path}.games must be positive.`);
    if (!Number.isInteger(games) || games !== value.games) errors.push(`${path.replace("winCondition", "games")} must equal winCondition.games.`);
    return;
  }
  if (value.type === "checkmate") {
    if (value.rankingMetric !== "points") errors.push(`${path}.rankingMetric must be points.`);
    if (!Number.isInteger(value.threshold) || (value.threshold as number) < 0) errors.push(`${path}.threshold must be a non-negative whole number.`);
    if (value.maxGames !== undefined && (!Number.isInteger(value.maxGames) || (value.maxGames as number) <= 0)) errors.push(`${path}.maxGames must be a positive whole number.`);
    if (games !== undefined) errors.push(`${path.replace("winCondition", "games")} must be omitted for checkmate rounds.`);
    if (reseed !== 0) errors.push(`${path.replace("winCondition", "reseed")} must be zero for checkmate rounds.`);
    return;
  }
  errors.push(`${path}.type is invalid.`);
}

function validateNode(value: unknown, index: number, nodeIds: Set<string>, errors: string[]): void {
  const path = `nodes[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (typeof value.id !== "string" || value.id.trim() === "") errors.push(`${path}.id is required.`);
  else if (nodeIds.has(value.id)) errors.push(`${path}.id must be unique.`);
  else nodeIds.add(value.id);
  if (typeof value.name !== "string" || value.name.trim() === "") errors.push(`${path}.name is required.`);
  if (value.initialEntrantSlots !== undefined && value.initialEntrantSlots !== "all" && (!Number.isInteger(value.initialEntrantSlots) || (value.initialEntrantSlots as number) <= 0)) errors.push(`${path}.initialEntrantSlots must be positive or all.`);
  if (value.mergeSeeding !== "random" && value.mergeSeeding !== "source_rank_interleave") errors.push(`${path}.mergeSeeding is invalid.`);
  if (value.lobbySeeding !== "snake" && value.lobbySeeding !== "random") errors.push(`${path}.lobbySeeding must be snake or random.`);
  validateStandings(value.standings, `${path}.standings`, errors);
  validateStandings(value.reseedStandings, `${path}.reseedStandings`, errors);
  if (value.winCondition !== undefined) validateWinCondition(value.winCondition, `${path}.winCondition`, value.games, value.reseed, errors);
  const isCheckmate = isRecord(value.winCondition) && value.winCondition.type === "checkmate";
  if (!isCheckmate && (!Number.isInteger(value.games) || (value.games as number) <= 0)) errors.push(`${path}.games must be a positive whole number.`);
  if (!Number.isInteger(value.reseed) || (value.reseed as number) < 0) errors.push(`${path}.reseed must be a non-negative whole number.`);
  else if (!isCheckmate && Number.isInteger(value.games) && (value.reseed as number) > (value.games as number)) errors.push(`${path}.reseed must be between 0 and games.`);
  if (value.position !== undefined && (!isRecord(value.position) || typeof value.position.x !== "number" || typeof value.position.y !== "number")) errors.push(`${path}.position must contain numeric x and y.`);
}

function validateEdge(value: unknown, index: number, nodeIds: Set<string>, edgeIds: Set<string>, priorities: Map<string, Set<number>>, errors: string[]): void {
  const path = `edges[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
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
  if (!isRecord(value.condition) || value.condition.type !== "top_n") errors.push(`${path}.condition.type must be top_n.`);
  else {
    if (!Number.isInteger(value.condition.count) || (value.condition.count as number) <= 0) errors.push(`${path}.condition.count must be positive.`);
    if (value.condition.rankingMetric !== "points") errors.push(`${path}.condition.rankingMetric must be points.`);
  }
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

export type TournamentFormatValidation =
  | { success: true; data: TournamentFormat; errors: string[] }
  | { success: false; data: null; errors: string[] };

export function normalizeTournamentFormat(value: unknown): TournamentFormat | null {
  if (!isRecord(value)) return null;
  if (Array.isArray(value.nodes) && Array.isArray(value.edges)) return value as unknown as TournamentFormat;
  if (!Array.isArray(value.rounds)) return null;
  const legacyRounds = value.rounds.filter(isRecord);
  const nodes = legacyRounds.map((round, index) => ({
    ...round,
    id: String(round.id ?? `node-${index + 1}`),
    mergeSeeding: "random" as TournamentNodeMergeSeeding,
    initialEntrantSlots: index === 0 ? "all" as const : undefined,
  })) as unknown as TournamentNodeFormat[];
  const edges: TournamentEdgeFormat[] = [];
  legacyRounds.forEach((round, index) => {
    const advancement = isRecord(round.advancement) ? round.advancement : null;
    if (advancement && typeof advancement.destinationRoundId === "string") {
      edges.push({
        id: `${String(round.id)}-advancement`,
        sourceNodeId: String(round.id),
        destinationNodeId: advancement.destinationRoundId,
        priority: 1,
        condition: { type: "top_n", count: Number(advancement.count), rankingMetric: "points" },
      });
    } else if (index > 0) {
      // A legacy terminal round has no outgoing edge.
    }
  });
  return {
    schemaVersion: 2,
    id: String(value.id ?? "format"),
    name: String(value.name ?? "Tournament format"),
    isDefault: value.isDefault === true,
    placementPoints: (value.placementPoints ?? {}) as Record<string, number>,
    startRequirement: getTournamentStartRequirement(value),
    nodes,
    edges,
  };
}

export function validateTournamentFormat(value: unknown): TournamentFormatValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, data: null, errors: ["Format must be an object."] };
  if (typeof value.id !== "string" || value.id.trim() === "") errors.push("Format id is required.");
  if (typeof value.name !== "string" || value.name.trim() === "") errors.push("Format name is required.");
  if (!isRecord(value.placementPoints)) errors.push("placementPoints must be an object.");
  const normalized = normalizeTournamentFormat(value);
  if (!normalized || normalized.nodes.length === 0) errors.push("Format must define at least one node.");
  const nodes = Array.isArray(value.nodes) ? value.nodes : Array.isArray(value.rounds) ? (value.rounds as unknown[]).map((round) => ({ ...((round as Record<string, unknown>) ?? {}), mergeSeeding: "random" })) : [];
  const nodeIds = new Set<string>();
  nodes.forEach((node, index) => validateNode(node, index, nodeIds, errors));
  if (Array.isArray(value.rounds)) {
    const legacyRoundValues = value.rounds as unknown[];
    const legacyIds = new Set<string>();
    legacyRoundValues.forEach((round, index) => {
      if (!isRecord(round)) return;
      const path = `rounds[${index}]`;
      if (typeof round.id === "string") legacyIds.add(round.id);
      const legacyCheckmate = isRecord(round.winCondition) && round.winCondition.type === "checkmate";
      if (!legacyCheckmate && (!Number.isInteger(round.games) || (round.games as number) <= 0)) errors.push(`${path}.games must be a positive whole number.`);
      if (!Number.isInteger(round.reseed) || (round.reseed as number) < 0) errors.push(`${path}.reseed must be a non-negative whole number.`);
      else if (!legacyCheckmate && Number.isInteger(round.games) && (round.reseed as number) > (round.games as number)) errors.push(`${path}.reseed must be between 0 and games.`);
      if (round.winCondition !== undefined) validateWinCondition(round.winCondition, `${path}.winCondition`, round.games, round.reseed, errors);
      validateStandings(round.standings, `${path}.standings`, errors);
      validateStandings(round.reseedStandings, `${path}.reseedStandings`, errors);
    });
    legacyRoundValues.forEach((round, index) => {
      if (!isRecord(round) || !isRecord(round.advancement)) return;
      if (typeof round.advancement.destinationRoundId !== "string" || !legacyIds.has(round.advancement.destinationRoundId)) errors.push(`rounds[${index}].advancement.destinationRoundId must reference a round.`);
      if (!Number.isInteger(round.advancement.count) || (round.advancement.count as number) <= 0) errors.push(`rounds[${index}].advancement.count must be positive.`);
    });
    legacyRoundValues.forEach((round, index) => {
      if (!isRecord(round) || !isRecord(round.winCondition) || round.winCondition.type !== "checkmate" || index === legacyRoundValues.length - 1) return;
      const hasEightPlayerIncoming = legacyRoundValues.some((candidate: unknown) =>
        isRecord(candidate) && isRecord(candidate.advancement) &&
        candidate.advancement.destinationRoundId === round.id && candidate.advancement.count === 8,
      );
      if (!hasEightPlayerIncoming) errors.push(`rounds[${index}].checkmate requires an eight-player round or final round.`);
    });
  }
  const edges = Array.isArray(value.edges) ? value.edges : normalizeTournamentFormat(value)?.edges ?? [];
  const edgeIds = new Set<string>();
  const priorities = new Map<string, Set<number>>();
  edges.forEach((edge, index) => validateEdge(edge, index, nodeIds, edgeIds, priorities, errors));
  if (normalized && !hasCycle(new Set(normalized.nodes.map((node) => node.id)), normalized.edges)) {
    const incoming = new Set(normalized.edges.map((edge) => edge.destinationNodeId));
    const roots = normalized.nodes.filter((node) => !incoming.has(node.id));
    roots.forEach((root) => {
      if (root.initialEntrantSlots === undefined) errors.push(`nodes.${root.id}.initialEntrantSlots is required for an entry node.`);
    });
    normalized.nodes.filter((node) => incoming.has(node.id) && node.initialEntrantSlots !== undefined).forEach((node) => errors.push(`nodes.${node.id}.initialEntrantSlots is only allowed on entry nodes.`));
  } else if (normalized) {
    errors.push("Format graph must be acyclic.");
  }
  const requirement: TournamentStartRequirement = isRecord(value.startRequirement)
    ? {
        minimumEntrants: Number(value.startRequirement.minimumEntrants),
        exactEntrants:
          value.startRequirement.exactEntrants === null || value.startRequirement.exactEntrants === undefined
            ? null
            : Number(value.startRequirement.exactEntrants),
      }
    : getTournamentStartRequirement(value);
  if (!Number.isInteger(requirement.minimumEntrants) || requirement.minimumEntrants < 1) errors.push("startRequirement.minimumEntrants must be positive.");
  if (requirement.exactEntrants !== null && (!Number.isInteger(requirement.exactEntrants) || requirement.exactEntrants < requirement.minimumEntrants)) errors.push("startRequirement.exactEntrants must be null or at least minimumEntrants.");
  if (errors.length) return { success: false, data: null, errors };
  return { success: true, data: normalized as TournamentFormat, errors: [] };
}

export function isValidTournamentFormat(value: unknown): value is TournamentFormat {
  return validateTournamentFormat(value).success;
}

export function getTournamentStartRequirement(value: unknown): TournamentStartRequirement {
  if (isRecord(value) && isRecord(value.startRequirement)) {
    return {
      minimumEntrants: Number(value.startRequirement.minimumEntrants),
      exactEntrants: value.startRequirement.exactEntrants === null || value.startRequirement.exactEntrants === undefined ? null : Number(value.startRequirement.exactEntrants),
    };
  }
  const rounds = isRecord(value) && Array.isArray(value.rounds) ? value.rounds.filter(isRecord) : isRecord(value) && Array.isArray(value.nodes) ? value.nodes.filter(isRecord) : [];
  const hasCheckmate = rounds.some((round) => isRecord(round.winCondition) && round.winCondition.type === "checkmate");
  const firstIsCheckmate = rounds.length > 0 && isRecord(rounds[0]?.winCondition) && rounds[0].winCondition.type === "checkmate";
  return { minimumEntrants: hasCheckmate ? 8 : 1, exactEntrants: firstIsCheckmate ? 8 : null };
}

export function getFormatGraph(value: unknown): { nodes: TournamentNodeFormat[]; edges: TournamentEdgeFormat[] } {
  const normalized = normalizeTournamentFormat(value);
  return normalized ? { nodes: normalized.nodes, edges: normalized.edges } : { nodes: [], edges: [] };
}

/** Keep the legacy SQL lobby generator able to read a v2 snapshot until all
 * database functions have moved to node-native config access. */
export function withLegacyRoundSnapshot(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.nodes) || Array.isArray(value.rounds)) return value;
  const nodes = value.nodes.filter(isRecord);
  const edges = Array.isArray(value.edges) ? value.edges.filter(isRecord) : [];
  return {
    ...value,
    rounds: nodes.map((node) => {
      const outgoing = edges
        .filter((edge) => edge.sourceNodeId === node.id)
        .sort((first, second) => Number(first.priority ?? 1) - Number(second.priority ?? 1))[0];
      const condition = isRecord(outgoing?.condition) ? outgoing.condition : null;
      return {
        ...node,
        ...(outgoing && condition
          ? {
              advancement: {
                type: "top_n",
                count: Number(condition.count),
                rankingMetric: "points",
                destinationRoundId: String(outgoing.destinationNodeId),
              },
            }
          : {}),
      };
    }),
  };
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
