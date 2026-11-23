import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { BaseEdge, MarkerType, Position, ReactFlow } from "@xyflow/react";
import type { Edge, EdgeProps, Node, ReactFlowInstance } from "@xyflow/react";
import { Node as NodeDefinition, Recipe } from "@pecore/schemas";
import type { JobView, NodeRunView } from "@pecore/schemas";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { DefinitionIcon, useDefinitionIcons } from "./DefinitionIcon";
import { nodeRunState, StateLabel, toneColor } from "./states";
import type { Tone } from "./states";
import { Empty } from "./ui";
import "@xyflow/react/dist/style.css";
import s from "./JobGraph.module.css";

export async function readRecipe(job: JobView): Promise<Recipe> {
  const file = await call("getDefinition", { params: { path: `projects/${job.projectId}/recipes/${job.recipe}.json` } });
  return Recipe.parse(JSON.parse(file.content));
}

export function useRecipe(job: JobView) {
  const prefix: string = `projects/${job.projectId}/`;
  return useData(async () => {
    const recipe: Recipe = await readRecipe(job);
    const names = new Set<string>(Object.values(recipe.nodes).map((node) => node.use));
    const definitions = new Map<string, NodeDefinition>();
    await Promise.all([...names].map(async (name) => {
      try {
        const file = await call("getDefinition", { params: { path: `${prefix}nodes/${name}.json` } });
        definitions.set(name, NodeDefinition.parse(JSON.parse(file.content)));
      } catch {
        return;
      }
    }));
    return { recipe, definitions };
  }, [job.projectId, job.recipe], (m) => m.type === "definition.changed" && (m.path === `${prefix}recipes/${job.recipe}.json` || m.path.startsWith(`${prefix}nodes/`)));
}

export function latestRuns(runs: NodeRunView[]): Map<string, NodeRunView> {
  return new Map<string, NodeRunView>(runs.map((run) => [run.node, run]));
}

function backEdge({ id, sourceX, sourceY, targetX, targetY, label, markerEnd, style }: EdgeProps) {
  const right: number = Math.max(sourceX, targetX) + 180;
  const path: string = `M ${sourceX},${sourceY} C ${right},${sourceY + 32} ${right},${targetY - 32} ${targetX},${targetY}`;
  return <BaseEdge id={id} path={path} label={label} labelX={right - 45} labelY={(sourceY + targetY) / 2} markerEnd={markerEnd} style={style} />;
}

const edgeTypes = { back: backEdge };

function arrange(recipe: Recipe) {
  const visited = new Set<string>();
  const active = new Set<string>();
  const back = new Set<number>();
  const order: string[] = [];
  const outgoing = new Map<string, number[]>();
  for (const [index, edge] of recipe.edges.entries()) {
    const indexes: number[] = outgoing.get(edge.from) ?? [];
    indexes.push(index);
    outgoing.set(edge.from, indexes);
    if (edge.maxRounds !== undefined) back.add(index);
  }
  function visit(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    active.add(node);
    for (const index of outgoing.get(node) ?? []) {
      const target: string = recipe.edges[index]!.to;
      if (active.has(target)) back.add(index);
      else if (!back.has(index)) visit(target);
    }
    active.delete(node);
    order.push(node);
  }
  if (recipe.start) visit(recipe.start);
  for (const id of Object.keys(recipe.nodes)) visit(id);
  const levels = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  const rows = new Map<number, number>();
  for (const id of order.toReversed()) {
    const level: number = levels.get(id) ?? 0;
    const column: number = rows.get(level) ?? 0;
    positions.set(id, { x: column * 240, y: level * 116 });
    rows.set(level, column + 1);
    for (const index of outgoing.get(id) ?? []) {
      if (back.has(index)) continue;
      const target: string = recipe.edges[index]!.to;
      levels.set(target, Math.max(level + 1, levels.get(target) ?? 0));
    }
  }
  return { back, positions };
}

export function JobGraph({ recipe, definitions, runs, selected, onSelect }: {
  recipe: Recipe;
  definitions: ReadonlyMap<string, NodeDefinition>;
  runs: NodeRunView[];
  selected: string | null;
  onSelect(id: string): void;
}) {
  const connected: boolean = useConnected();
  const icons = useDefinitionIcons();
  const { back, positions } = useMemo(() => arrange(recipe), [recipe]);
  const latest: Map<string, NodeRunView> = latestRuns(runs);
  const backTargets = new Set<string>([...back].map((index) => recipe.edges[index]!.to));
  const nodes: Node[] = Object.entries(recipe.nodes).map(([id, definition]) => {
    const run: NodeRunView | undefined = latest.get(id);
    const node: NodeDefinition | undefined = definitions.get(definition.use);
    const tone = (outcome: string): Tone => {
      if (outcome === "stale" || (node && node.kind !== "source" && node.failOutcomes.includes(outcome))) return "failed";
      if (recipe.successOutcomes.includes(`${id}:${outcome}`)) return "success";
      return recipe.edges.some((edge) => edge.from === id && edge.on === outcome) ? "none" : "inactive";
    };
    const info = nodeRunState(run ?? { state: "pending", outcome: null, waitingReason: null, failureReason: null }, tone);
    return {
      id,
      position: recipe.layout?.[id] ?? positions.get(id)!,
      data: { label: <><strong><DefinitionIcon icons={icons.data} type="node" name={definition.use} selected={node?.icon} size="sm" /> {id}</strong>
        <StateLabel info={info} />{run && backTargets.has(id) && <span>Round {run.round}</span>}</> },
      className: s.node,
      style: { "--tone": toneColor(info.tone) } as CSSProperties,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      selected: run !== undefined && run.id === selected,
      selectable: connected && run !== undefined,
      focusable: connected && run !== undefined,
      ariaLabel: `${id}, ${info.label}`,
    };
  });
  const edges: Edge[] = recipe.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.from,
    target: edge.to,
    type: back.has(index) ? "back" : "smoothstep",
    label: edge.on,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--text-muted)" },
    style: { stroke: "var(--text-muted)" },
    selectable: false,
    focusable: false,
  }));
  const box = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(() => void flow.current?.fitView({ maxZoom: 1, duration: 220 }));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  if (!nodes.length) return <Empty>This recipe has no nodes.</Empty>;
  return (
    <div ref={box} className={s.graph}>
      <ReactFlow
        onInit={(instance) => { flow.current = instance; }}
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={connected}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        panActivationKeyCode={connected ? "Space" : null}
        zoomOnScroll={connected}
        zoomOnPinch={connected}
        zoomOnDoubleClick={connected}
        panOnDrag={connected}
        onNodeClick={(_, node) => {
          const run: NodeRunView | undefined = latest.get(node.id);
          if (connected && run) onSelect(run.id);
        }}
        onNodesChange={(changes) => {
          const choice = changes.find((change) => change.type === "select" && change.selected);
          const run: NodeRunView | undefined = choice?.type === "select" ? latest.get(choice.id) : undefined;
          if (connected && run && run.id !== selected) onSelect(run.id);
        }}
      />
    </div>
  );
}

