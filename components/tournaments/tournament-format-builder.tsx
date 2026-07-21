"use client";

import {
  applyNodeChanges,
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useActionState, useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import {
  createCustomTournamentAction,
} from "@/app/actions";
import { initialCustomTournamentCreationState } from "@/lib/tournament/formats/creation-state";
import {
  analyzeTournamentFormat,
  createTournamentFormatPreset,
  TOURNAMENT_FORMAT_PRESETS,
  type TournamentFormatPresetId,
  type TournamentFormatFlowAnalysis,
} from "@/lib/tournament/formats/presets";
import { resolveTournamentFormat } from "@/lib/tournament/formats/api";
import type {
  TournamentEdgeDefinition,
  TournamentFormat,
  TournamentNodeDefinition,
} from "@/lib/tournament/formats/types";

type BuilderNodeData = {
  node: TournamentNodeDefinition;
  projectedEntrants: number | null;
};

type BuilderNode = Node<BuilderNodeData, "formatNode">;
type BuilderEdge = Edge<{ edge: TournamentEdgeDefinition }>;

const inputClass =
  "mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100";
const buttonClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2";

function defaultPosition(index: number, nodes: TournamentNodeDefinition[], edges: TournamentEdgeDefinition[]) {
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    incoming.set(edge.destinationNodeId, (incoming.get(edge.destinationNodeId) ?? 0) + 1);
    outgoing.get(edge.sourceNodeId)?.push(edge.destinationNodeId);
  });
  const depth = new Map<string, number>();
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  queue.forEach((nodeId) => depth.set(nodeId, 0));
  while (queue.length) {
    const source = queue.shift() as string;
    for (const destination of outgoing.get(source) ?? []) {
      const nextDepth = (depth.get(source) ?? 0) + 1;
      depth.set(destination, Math.max(depth.get(destination) ?? 0, nextDepth));
      queue.push(destination);
    }
  }
  const columnNodes = new Map<number, TournamentNodeDefinition[]>();
  nodes.forEach((node) => {
    const column = depth.get(node.id) ?? 0;
    columnNodes.set(column, [...(columnNodes.get(column) ?? []), node]);
  });
  const maxColumn = Math.max(...columnNodes.keys(), 0);
  const node = nodes[index];
  const column = depth.get(node.id) ?? 0;
  const row = (columnNodes.get(column) ?? []).findIndex((candidate) => candidate.id === node.id);
  return {
    x: maxColumn === 0 ? 360 : column * 260 + 80,
    y: row * 150 + 80,
  };
}

function graphId(prefix: string, ids: string[]): string {
  const used = new Set(ids);
  let index = ids.length + 1;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function wouldCreateCycle(sourceNodeId: string, destinationNodeId: string, edges: TournamentEdgeDefinition[]): boolean {
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge.destinationNodeId]));
  const stack = [destinationNodeId];
  const visited = new Set<string>();
  while (stack.length) {
    const nodeId = stack.pop() as string;
    if (nodeId === sourceNodeId) return true;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    stack.push(...(outgoing.get(nodeId) ?? []));
  }
  return false;
}

function toFlowNodes(format: TournamentFormat, analysis: TournamentFormatFlowAnalysis): BuilderNode[] {
  return format.nodes.map((node, index) => ({
    id: node.id,
    type: "formatNode",
    position: node.position ?? defaultPosition(index, format.nodes, format.edges),
    // React Flow hides nodes until it knows their dimensions. Providing a
    // stable initial size keeps the graph visible during SSR/hydration and
    // while the custom card is being measured in the browser.
    initialWidth: 192,
    initialHeight: 96,
    // React Flow's drag calculations require measured dimensions (the initial
    // dimensions above only control visibility/viewport fitting). Seed the
    // measurement so a node can be dragged immediately after it appears.
    measured: { width: 192, height: 96 },
    data: {
      node,
      projectedEntrants: analysis.nodeProjectedEntrants[node.id] ?? null,
    },
  }));
}

function toFlowEdges(format: TournamentFormat, analysis: TournamentFormatFlowAnalysis): BuilderEdge[] {
  return format.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.destinationNodeId,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#047857" },
    label: `Top ${edge.condition.count} · ${edge.condition.rankingMetric === "tournament_points" ? "cumulative" : "node points"}`,
    labelStyle: { fill: "#3f3f46", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#fafafa", fillOpacity: 0.95 },
    data: { edge },
    animated: analysis.edgeProjectedEntrants[edge.id] === null,
  }));
}

type InspectorNode = NonNullable<ReturnType<typeof resolveTournamentFormat>>["nodes"][number];

function inspectorNode(format: TournamentFormat, node: TournamentNodeDefinition): InspectorNode {
  const checkmate = node.winCondition?.type === "checkmate";
  return {
    id: node.id,
    name: node.name,
    ...(node.initialEntrantSlots === undefined ? {} : { initialEntrantSlots: node.initialEntrantSlots }),
    mergeSeeding: node.mergeSeeding ?? format.nodeDefaults.mergeSeeding,
    lobbySeeding: node.lobbySeeding ?? format.nodeDefaults.lobbySeeding,
    ...(checkmate ? {} : { games: node.games ?? format.nodeDefaults.games }),
    reseed: node.reseed ?? format.nodeDefaults.reseed,
    standings: node.standings ?? format.nodeDefaults.standings,
    reseedStandings: node.reseedStandings ?? format.nodeDefaults.reseedStandings,
    ...(node.position === undefined ? {} : { position: node.position }),
    ...(node.winCondition === undefined
      ? {}
      : checkmate
        ? { winCondition: { ...node.winCondition, rankingMetric: "points" as const } }
        : { winCondition: { ...node.winCondition, rankingMetric: "points" as const } }),
  };
}

function FormatCanvasNode({ data, selected }: NodeProps<BuilderNode>) {
  const condition = data.node.winCondition?.type === "checkmate" ? "Checkmate" : `${data.node.games ?? "default"} games`;
  return (
    <div className={`min-w-48 rounded-lg border-2 bg-white p-3 shadow-md ${selected ? "border-amber-500 ring-2 ring-amber-200" : "border-emerald-600"}`}>
      <Handle className="!h-3 !w-3 !border-2 !border-white !bg-emerald-700" position={Position.Left} type="target" />
      <Handle className="!h-3 !w-3 !border-2 !border-white !bg-emerald-700" position={Position.Right} type="source" />
      <p className="truncate text-sm font-semibold text-zinc-950">{data.node.name}</p>
      <p className="mt-1 text-xs text-zinc-500">{condition} · reseed {data.node.reseed}</p>
      <p className="mt-2 text-xs font-medium text-emerald-800">
        {data.projectedEntrants === null ? "Entrants unknown" : `${data.projectedEntrants} projected entrant${data.projectedEntrants === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}

const nodeTypes = { formatNode: FormatCanvasNode };

function formatErrorSummary(errors: string[]): string {
  return errors.length > 0 ? errors[0] : "The format could not be saved.";
}

export function TournamentFormatBuilder() {
  const [tournamentName, setTournamentName] = useState("");
  const [playerCount, setPlayerCount] = useState(128);
  const [presetId, setPresetId] = useState<TournamentFormatPresetId>("custom");
  const [format, setFormat] = useState<TournamentFormat>(() => createTournamentFormatPreset("custom", 128) as TournamentFormat);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<BuilderNode, BuilderEdge> | null>(null);
  const [state, formAction, pending] = useActionState(createCustomTournamentAction, initialCustomTournamentCreationState);
  const analysis = useMemo(() => analyzeTournamentFormat(format, playerCount), [format, playerCount]);
  const resolved = useMemo(() => resolveTournamentFormat(format), [format]);
  const selectedNode = format.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = format.edges.find((edge) => edge.id === selectedEdgeId);
  const rootIds = useMemo(() => {
    const incoming = new Set(format.edges.map((edge) => edge.destinationNodeId));
    return new Set(format.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id));
  }, [format.edges, format.nodes]);
  const baseFlowNodes = useMemo(() => toFlowNodes(format, analysis), [analysis, format]);
  const [flowNodes, setFlowNodes] = useState<BuilderNode[]>(() => baseFlowNodes);
  const flowEdges = useMemo(() => toFlowEdges(format, analysis), [analysis, format]);
  const flowStructureKey = useMemo(
    () => `${format.nodes.map((node) => node.id).join(",")}|${format.edges.map((edge) => edge.id).join(",")}`,
    [format.edges, format.nodes],
  );

  useEffect(() => {
    // Keep the controlled React Flow nodes synchronized with format edits,
    // while onNodesChange below retains measured dimensions and drag state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlowNodes(baseFlowNodes);
  }, [baseFlowNodes]);

  useEffect(() => {
    if (!flowInstance) return;
    const frame = requestAnimationFrame(() => {
      flowInstance.fitView({ padding: 0.2, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flowInstance, flowStructureKey]);

  function updateFormat(next: (current: TournamentFormat) => TournamentFormat) {
    setFormat((current) => next(current));
    setPresetId("custom");
  }

  function updateNode(nodeId: string, patch: Partial<TournamentNodeDefinition>) {
    updateFormat((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
  }

  function updateEdge(edgeId: string, patch: Partial<TournamentEdgeDefinition>) {
    updateFormat((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
  }

  function handlePresetChange(nextPreset: TournamentFormatPresetId) {
    const nextFormat = createTournamentFormatPreset(nextPreset, playerCount);
    setPresetId(nextPreset);
    if (nextFormat) {
      setFormat(nextFormat);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    }
  }

  function handlePlayerCountChange(value: string) {
    const nextPlayerCount = Number(value);
    setPlayerCount(Number.isInteger(nextPlayerCount) ? nextPlayerCount : 0);
    if (presetId !== "custom") {
      const nextFormat = createTournamentFormatPreset(presetId, nextPlayerCount);
      if (nextFormat) {
        setFormat(nextFormat);
      } else {
        setPresetId("custom");
        setFormat(createTournamentFormatPreset("custom", nextPlayerCount) as TournamentFormat);
      }
    } else {
      setFormat((current) => ({
        ...current,
        startRequirement: {
          minimumEntrants: nextPlayerCount,
          exactEntrants: nextPlayerCount,
        },
      }));
    }
  }

  function handleNodesChange(changes: NodeChange<BuilderNode>[]) {
    setFlowNodes((current) => applyNodeChanges(changes, current));
    const removed = changes.filter((change) => change.type === "remove").map((change) => change.id);
    if (removed.length) {
      updateFormat((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !removed.includes(node.id)),
        edges: current.edges.filter((edge) => !removed.includes(edge.sourceNodeId) && !removed.includes(edge.destinationNodeId)),
      }));
    }
  }

  function handleNodeDragStop(_: MouseEvent | TouchEvent, node: BuilderNode) {
    updateNode(node.id, { position: { x: node.position.x, y: node.position.y } });
  }

  function handleEdgesChange(changes: EdgeChange<BuilderEdge>[]) {
    const removed = changes.filter((change) => change.type === "remove").map((change) => change.id);
    if (removed.length) {
      updateFormat((current) => ({ ...current, edges: current.edges.filter((edge) => !removed.includes(edge.id)) }));
    }
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    if (format.edges.some((edge) => edge.sourceNodeId === connection.source && edge.destinationNodeId === connection.target)) return;
    if (wouldCreateCycle(connection.source, connection.target, format.edges)) return;
    const sourceEdges = format.edges.filter((edge) => edge.sourceNodeId === connection.source);
    const nextId = graphId("edge", format.edges.map((edge) => edge.id));
    const nextPriority = sourceEdges.reduce((highest, edge) => Math.max(highest, edge.priority), 0) + 1;
    const nextEdge = edgeFromConnection(nextId, connection.source, connection.target, nextPriority);
    updateFormat((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (
        node.id === connection.target ? { ...node, initialEntrantSlots: undefined } : node
      )),
      edges: [...current.edges, nextEdge],
    }));
    setSelectedEdgeId(nextId);
    setSelectedNodeId(null);
  }

  function removeNode(nodeId: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this node and its connected edges?")) return;
    updateFormat((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.destinationNodeId !== nodeId),
    }));
    setSelectedNodeId(null);
  }

  function removeEdge(edgeId: string) {
    updateFormat((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }));
    setSelectedEdgeId(null);
  }

  function addNode() {
    const nextId = graphId("node", format.nodes.map((node) => node.id));
    const node: TournamentNodeDefinition = {
      id: nextId,
      name: nextId.replace("-", " ").replace(/\b\w/g, (character) => character.toUpperCase()),
      initialEntrantSlots: 8,
      position: { x: 360, y: (format.nodes.length + 1) * 100 },
    };
    updateFormat((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }

  const selectedNodeResolved = selectedNode
    ? resolved?.nodes.find((node) => node.id === selectedNode.id) ?? inspectorNode(format, selectedNode)
    : undefined;
  const edgeSourceName = selectedEdge ? format.nodes.find((node) => node.id === selectedEdge.sourceNodeId)?.name ?? "Unknown source" : "";
  const edgeDestinationName = selectedEdge ? format.nodes.find((node) => node.id === selectedEdge.destinationNodeId)?.name ?? "Unknown destination" : "";
  const graphErrors = Array.from(new Set([...analysis.errors, ...state.graphErrors]));

  return (
    <form action={formAction} className="space-y-5">
      <input name="formatConfig" type="hidden" value={JSON.stringify(format)} />
      <div className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_12rem_18rem]">
        <div>
          <label className="text-sm font-medium text-zinc-800" htmlFor="builderTournamentName">Tournament name</label>
          <input className={inputClass} id="builderTournamentName" name="tournamentName" onChange={(event) => setTournamentName(event.target.value)} value={tournamentName} />
          {state.fieldErrors.name ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.name}</p> : null}
        </div>
        <div>
          <label className="text-sm font-medium text-zinc-800" htmlFor="builderPlayerCount">Entrants</label>
          <input className={inputClass} id="builderPlayerCount" inputMode="numeric" max={512} min={8} name="playerCount" onChange={(event) => handlePlayerCountChange(event.target.value)} step={8} type="number" value={playerCount || ""} />
          {state.fieldErrors.playerCount ? <p className="mt-1 text-xs text-red-700">{state.fieldErrors.playerCount}</p> : null}
        </div>
        <div>
          <label className="text-sm font-medium text-zinc-800" htmlFor="builderPreset">Preset</label>
          <select className={inputClass} id="builderPreset" onChange={(event) => handlePresetChange(event.target.value as TournamentFormatPresetId)} value={presetId}>
            {TOURNAMENT_FORMAT_PRESETS.map((preset) => (
              <option disabled={!preset.supportsPlayerCount(playerCount)} key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">{TOURNAMENT_FORMAT_PRESETS.find((preset) => preset.id === presetId)?.description}</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
        <aside className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <div>
            <label className="text-sm font-medium text-zinc-800" htmlFor="builderFormatName">Format name</label>
            <input className={inputClass} id="builderFormatName" onChange={(event) => updateFormat((current) => ({ ...current, name: event.target.value }))} value={format.name} />
          </div>
          <button className={`${buttonClass} w-full`} onClick={addNode} type="button">Add node</button>
          <p className="text-xs leading-5 text-zinc-500">Drag from a node’s right handle to another node’s left handle to create an advancement edge.</p>
          <div className="border-t border-zinc-200 pt-3 text-xs text-zinc-600">
            <p className="font-semibold text-zinc-900">Graph status</p>
            <p className={`mt-1 ${analysis.valid ? "text-emerald-700" : "text-red-700"}`}>{analysis.valid ? "Ready to save" : formatErrorSummary(analysis.errors)}</p>
            <p className="mt-1">{format.nodes.length} nodes · {format.edges.length} edges</p>
          </div>
        </aside>

        <div className="h-[38rem] overflow-hidden rounded-lg border border-zinc-200 bg-stone-50 shadow-sm">
          <ReactFlow
            connectionLineType={ConnectionLineType.SmoothStep}
            defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }}
            edges={flowEdges}
            fitView
            isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target && !wouldCreateCycle(connection.source, connection.target, format.edges) && !format.edges.some((edge) => edge.sourceNodeId === connection.source && edge.destinationNodeId === connection.target))}
            nodes={flowNodes}
            nodeTypes={nodeTypes}
            onConnect={handleConnect}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
            onEdgesChange={handleEdgesChange}
            onInit={setFlowInstance}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            onNodeDragStop={handleNodeDragStop}
            onNodesChange={handleNodesChange}
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background color="#d4d4d8" gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          {selectedNode && selectedNodeResolved ? (
            <NodeInspector node={selectedNode} resolvedNode={selectedNodeResolved} isRoot={rootIds.has(selectedNode.id)} onChange={(patch) => updateNode(selectedNode.id, patch)} onDelete={() => removeNode(selectedNode.id)} />
          ) : selectedEdge ? (
            <EdgeInspector destinationName={edgeDestinationName} edge={selectedEdge} onChange={(patch) => updateEdge(selectedEdge.id, patch)} onDelete={() => removeEdge(selectedEdge.id)} sourceName={edgeSourceName} />
          ) : (
            <div className="text-sm text-zinc-600"><p className="font-semibold text-zinc-900">Select a node or edge</p><p className="mt-2 leading-6">Use the canvas to arrange stages and connect advancement paths. The inspector will expose the settings for the selected item.</p></div>
          )}
        </aside>
      </div>

      {graphErrors.length > 0 ? <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-semibold">Format needs attention</p><ul className="mt-2 list-disc space-y-1 pl-5">{graphErrors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
      {analysis.warnings.length > 0 ? <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Format warnings</p><ul className="mt-2 list-disc space-y-1 pl-5">{analysis.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
      {state.message ? <p aria-live="polite" className="text-sm font-medium text-red-700">{state.message}</p> : null}
      <button className="flex h-12 w-full items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={pending || !analysis.valid} type="submit">{pending ? "Creating tournament…" : "Create tournament with this format"}</button>
    </form>
  );
}

function edgeFromConnection(id: string, sourceNodeId: string, destinationNodeId: string, priority: number): TournamentEdgeDefinition {
  return { id, sourceNodeId, destinationNodeId, priority, condition: { type: "top_n", count: 1 } };
}

function NodeInspector({ node, resolvedNode, isRoot, onChange, onDelete }: { node: TournamentNodeDefinition; resolvedNode: InspectorNode; isRoot: boolean; onChange: (patch: Partial<TournamentNodeDefinition>) => void; onDelete: () => void }) {
  const checkmate = resolvedNode.winCondition?.type === "checkmate";
  return (
    <div className="space-y-4 text-sm">
      <div><p className="font-semibold text-zinc-950">Node settings</p><p className="mt-1 text-xs text-zinc-500">{isRoot ? "Entry node" : "Advancement node"}</p></div>
      <label className="block">Name<input className={inputClass} onChange={(event) => onChange({ name: event.target.value })} value={node.name} /></label>
      <label className="block">Node type<select className={inputClass} onChange={(event) => onChange(event.target.value === "checkmate" ? { games: undefined, reseed: 0, winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points" } } : { winCondition: undefined, games: resolvedNode.games ?? 6 })} value={checkmate ? "checkmate" : "fixed"}><option value="fixed">Fixed games</option><option value="checkmate">Checkmate final</option></select></label>
      {!checkmate ? <label className="block">Games in node<input className={inputClass} min={1} onChange={(event) => { const games = Math.max(1, Number(event.target.value) || 1); onChange({ games, ...(resolvedNode.reseed > games ? { reseed: games } : {}) }); }} type="number" value={resolvedNode.games ?? 1} /></label> : <label className="block">Checkmate threshold<input className={inputClass} min={0} onChange={(event) => onChange({ winCondition: { type: "checkmate", threshold: Math.max(0, Number(event.target.value) || 0), rankingMetric: "points" } })} type="number" value={resolvedNode.winCondition?.type === "checkmate" ? resolvedNode.winCondition.threshold : 18} /></label>}
      <label className="block">Reseed every<select className={inputClass} disabled={checkmate} onChange={(event) => onChange({ reseed: Number(event.target.value) })} value={resolvedNode.reseed}><option value={0}>Never</option>{Array.from({ length: Math.max(resolvedNode.games ?? 1, 1) }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Every {value} game{value === 1 ? "" : "s"}</option>)}</select></label>
      <label className="block">Lobby seeding<select className={inputClass} onChange={(event) => onChange({ lobbySeeding: event.target.value as "snake" | "random" })} value={resolvedNode.lobbySeeding}><option value="snake">Snake</option><option value="random">Random</option></select></label>
      <label className="block">Merge seeding<select className={inputClass} onChange={(event) => onChange({ mergeSeeding: event.target.value as "random" | "source_rank_interleave" })} value={resolvedNode.mergeSeeding}><option value="random">Random</option><option value="source_rank_interleave">Interleave source ranks</option></select></label>
      {isRoot ? <label className="block">Starting entrants<select className={inputClass} onChange={(event) => onChange({ initialEntrantSlots: event.target.value === "all" ? "all" : Math.max(1, Number(event.target.value) || 1) })} value={node.initialEntrantSlots ?? "all"}><option value="all">All entrants</option><option value="8">8 entrants</option><option value="16">16 entrants</option><option value="32">32 entrants</option><option value="64">64 entrants</option><option value="128">128 entrants</option><option value="256">256 entrants</option><option value="512">512 entrants</option></select></label> : null}
      <button className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={onDelete} type="button">Delete node</button>
    </div>
  );
}

function EdgeInspector({ edge, sourceName, destinationName, onChange, onDelete }: { edge: TournamentEdgeDefinition; sourceName: string; destinationName: string; onChange: (patch: Partial<TournamentEdgeDefinition>) => void; onDelete: () => void }) {
  return (
    <div className="space-y-4 text-sm">
      <div><p className="font-semibold text-zinc-950">Advancement edge</p><p className="mt-1 text-xs text-zinc-500">{sourceName} → {destinationName}</p></div>
      <label className="block">Priority<input className={inputClass} min={1} onChange={(event) => onChange({ priority: Math.max(1, Number(event.target.value) || 1) })} type="number" value={edge.priority} /></label>
      <label className="block">Advance top<input className={inputClass} min={1} onChange={(event) => onChange({ condition: { ...edge.condition, count: Math.max(1, Number(event.target.value) || 1) } })} type="number" value={edge.condition.count} /></label>
      <label className="block">Rank by<select className={inputClass} onChange={(event) => onChange({ condition: { ...edge.condition, rankingMetric: event.target.value as "points" | "tournament_points" } })} value={edge.condition.rankingMetric ?? "points"}><option value="points">This node’s points</option><option value="tournament_points">Cumulative tournament points</option></select></label>
      <p className="rounded-md bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">Edges from one node are evaluated by priority. Players not consumed by an outgoing edge are eliminated.</p>
      <button className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" onClick={onDelete} type="button">Delete edge</button>
    </div>
  );
}
