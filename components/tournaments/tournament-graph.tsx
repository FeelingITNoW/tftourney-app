import Link from "next/link";
import type { TournamentEdge, TournamentNode } from "@/lib/db/tournaments/types";

type TournamentGraphProps = {
  tournamentId: string;
  nodes: TournamentNode[];
  edges: TournamentEdge[];
  started: boolean;
  selectedNodeId?: string | null;
};

function statusClasses(status: TournamentNode["status"]): string {
  switch (status) {
    case "active":
      return "border-emerald-500 bg-emerald-50";
    case "completed":
      return "border-sky-500 bg-sky-50";
    case "skipped":
      return "border-zinc-300 bg-zinc-100";
    case "cancelled":
      return "border-red-300 bg-red-50";
    default:
      return "border-zinc-200 bg-white";
  }
}

function statusLabel(status: TournamentNode["status"]): string {
  return status === "pending" ? "Waiting" : status ?? "Configured";
}

export function TournamentGraph({
  tournamentId,
  nodes,
  edges,
  started,
  selectedNodeId,
}: TournamentGraphProps) {
  if (nodes.length === 0) return null;

  const nodeById = new Map<string, TournamentNode>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
    if (node.formatNodeId) nodeById.set(node.formatNodeId, node);
  }
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceNodeId)?.id;
    const destination = nodeById.get(edge.destinationNodeId)?.id;
    if (!source || !destination) continue;
    incoming.set(destination, (incoming.get(destination) ?? 0) + 1);
    outgoing.get(source)?.push(destination);
  }

  const depth = new Map<string, number>();
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const nodeId of queue) depth.set(nodeId, 0);
  while (queue.length) {
    const source = queue.shift() as string;
    for (const destination of outgoing.get(source) ?? []) {
      depth.set(destination, Math.max(depth.get(destination) ?? 0, (depth.get(source) ?? 0) + 1));
      queue.push(destination);
    }
  }
  const columns = new Map<number, TournamentNode[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }
  const maxColumn = Math.max(...columns.keys(), 0);
  const positions = new Map<string, { x: number; y: number }>();
  const savedPositions = nodes
    .map((node) => node.position)
    .filter((position): position is { x: number; y: number } => Boolean(position));
  const savedBounds = savedPositions.length
    ? {
        minX: Math.min(...savedPositions.map((position) => position.x)),
        maxX: Math.max(...savedPositions.map((position) => position.x)),
        minY: Math.min(...savedPositions.map((position) => position.y)),
        maxY: Math.max(...savedPositions.map((position) => position.y)),
      }
    : null;
  for (const [column, columnNodes] of columns) {
    columnNodes.forEach((node, row) => {
      const saved = node.position;
      const savedX = saved && savedBounds
        ? savedBounds.maxX === savedBounds.minX
          ? 50
          : ((saved.x - savedBounds.minX) / (savedBounds.maxX - savedBounds.minX)) * 82 + 9
        : null;
      const savedY = saved && savedBounds
        ? savedBounds.maxY === savedBounds.minY
          ? 50
          : ((saved.y - savedBounds.minY) / (savedBounds.maxY - savedBounds.minY)) * 82 + 7
        : null;
      positions.set(node.id, {
        x: savedX ?? (maxColumn === 0 ? 50 : (column / maxColumn) * 82 + 9),
        y: savedY ?? ((row + 1) / (columnNodes.length + 1)) * 82 + 7,
      });
    });
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-950">Tournament graph</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Nodes are stages; edges show ordered Top-N advancement. A node with multiple inputs waits for every input.
          </p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>

      <div className="relative mt-6 min-h-[27rem] overflow-x-auto rounded-md bg-stone-50 p-3">
        <div className="relative min-w-[46rem]" style={{ aspectRatio: "1.7" }}>
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            {edges.map((edge) => {
              const source = positions.get(nodeById.get(edge.sourceNodeId)?.id ?? "");
              const destination = positions.get(nodeById.get(edge.destinationNodeId)?.id ?? "");
              if (!source || !destination) return null;
              const middle = (source.x + destination.x) / 2;
              return (
                <path
                  d={`M ${source.x} ${source.y} C ${middle} ${source.y}, ${middle} ${destination.y}, ${destination.x} ${destination.y}`}
                  fill="none"
                  key={edge.id}
                  markerEnd="url(#graph-arrow)"
                  stroke="#a1a1aa"
                  strokeWidth="0.45"
                />
              );
            })}
            <defs>
              <marker id="graph-arrow" markerHeight="5" markerWidth="5" orient="auto" refX="4" refY="2.5" viewBox="0 0 5 5">
                <path d="M 0 0 L 5 2.5 L 0 5 z" fill="#71717a" />
              </marker>
            </defs>
          </svg>

          {nodes.map((node) => {
            const position = positions.get(node.id) ?? { x: 50, y: 50 };
            const isSelected = node.id === selectedNodeId;
            const content = (
              <div className={`w-44 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 p-3 text-left shadow-sm transition ${statusClasses(node.status)} ${isSelected ? "ring-2 ring-amber-500 ring-offset-2" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-zinc-950">{node.name ?? node.formatNodeId ?? node.id}</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{statusLabel(node.status)}</span>
                </div>
                <p className="mt-2 text-xs text-zinc-600">
                  {node.entrantCount} entrant{node.entrantCount === 1 ? "" : "s"}
                  {node.configuredGames ? ` · ${node.completedGames}/${node.configuredGames} games` : ""}
                </p>
                {started && node.status === "active" ? <p className="mt-1 text-xs font-medium text-emerald-800">Open for results</p> : null}
              </div>
            );
            return (
              <div className="absolute" key={node.id} style={{ left: `${position.x}%`, top: `${position.y}%` }}>
                {started ? <Link href={`/tournaments/${tournamentId}?node=${encodeURIComponent(node.id)}`}>{content}</Link> : content}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-600">
        {edges.map((edge) => (
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1" key={`label-${edge.id}`}>
            {edge.condition && typeof edge.condition === "object" && "count" in edge.condition
              ? `Top ${String(edge.condition.count)}${"rankingMetric" in edge.condition && edge.condition.rankingMetric === "tournament_points" ? " · cumulative" : ""}`
              : "Advances"}
          </span>
        ))}
      </div>
    </section>
  );
}
