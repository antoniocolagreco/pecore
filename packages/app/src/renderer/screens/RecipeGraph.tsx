import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Background, BackgroundVariant, ConnectionMode, Handle, MarkerType, Panel, Position, ReactFlow } from "@xyflow/react";
import type { Connection, Node, NodeProps, OnConnectEnd, OnNodeDrag, ReactFlowInstance, Viewport, XYPosition } from "@xyflow/react";
import { Button, IconButton } from "../ds/button";
import { MinusIcon, MonitorIcon, PlusIcon } from "../ds/icons";
import { RecipeEdge, recipeAttachments, recipeLaneGap } from "./RecipeEdge";
import type { RoutedRecipeEdge } from "./RecipeEdge";
import { recipeEnd, recipeGrid, recipeStart, samePosition, slotTaken, snapRecipePosition } from "./recipeLayout";
import type { RecipeLayout, RecipeLink } from "./recipeLayout";
import "@xyflow/react/dist/style.css";
import s from "./Editors.module.css";

export type RecipeGraphNode = { id: string; label: ReactNode; invalid: boolean };
export type RecipeGraphLink = RecipeLink & { invalid: boolean; failed: boolean; caption?: string; neutral?: boolean };
export type RecipeCanvas = { dropPosition(point: XYPosition): XYPosition | undefined };

const sides: Position[] = Object.values(Position);
type StepNode = Node<{ label: ReactNode }, "step">;

const edgeStyle = { strokeWidth: 2.5, strokeLinejoin: "round" as const };

function RecipeStep({ id, data, isConnectable }: NodeProps<StepNode>) {
  return <>
    {data.label}
    {sides.map((side) => <Handle key={side} id={side} position={side} type="source" isConnectable={isConnectable}
      isConnectableStart={id !== recipeEnd} isConnectableEnd={id !== recipeStart}
      className={s.availablePort} aria-label={`Connect ${side}`} />)}
  </>;
}

const nodeTypes = { step: RecipeStep };
const edgeTypes = { routed: RecipeEdge };

const keyboardMoves: Record<string, XYPosition> = {
  ArrowLeft: { x: -recipeGrid[0], y: 0 },
  ArrowRight: { x: recipeGrid[0], y: 0 },
  ArrowUp: { x: 0, y: -recipeGrid[1] },
  ArrowDown: { x: 0, y: recipeGrid[1] },
};

function startViewport(layout: RecipeLayout, start: string): Viewport {
  const zoom: number = 1;
  const position: XYPosition = layout[start] ?? Object.values(layout)[0] ?? { x: 0, y: 0 };
  return { x: 32 - position.x * zoom, y: 220 - position.y * zoom, zoom };
}

export function routeRecipeEdges(links: RecipeGraphLink[], automatic: RecipeLayout): RoutedRecipeEdge[] {
  const attachments = recipeAttachments(links);
  const returns: boolean[] = links.map(({ from, to }) => automatic[to]!.x < automatic[from]!.x);
  const returnCount: number = returns.filter(Boolean).length;
  const lanes = new Map<number, number>(returns.map((_, index) => index)
    .sort((first, second) => Number(returns[second]) - Number(returns[first]))
    .map((index, lane) => [index, 42 + lane * recipeLaneGap]));
  const directCandidates: RecipeGraphLink[] = links.filter(({ from, to, failed, targetPort }) =>
    to === recipeEnd && from !== recipeStart && !failed && (!targetPort || targetPort === "left"));
  const direct: RecipeGraphLink | undefined = directCandidates.find((link) => !link.neutral) ?? directCandidates[0];
  const terminalCounts: Record<"top" | "bottom", number> = { top: 0, bottom: 0 };
  return links.map((link, index) => {
    const stroke: string = link.invalid || link.failed ? "var(--recipe-edge-failed)"
      : returns[index] || link.neutral ? "var(--recipe-edge-return)" : "var(--recipe-edge-forward)";
    const outer: boolean = link.failed || (link.to === recipeEnd && link.from !== recipeStart && link !== direct);
    const side: "top" | "bottom" = link.failed ? "bottom"
      : link.targetPort === "top" || link.targetPort === "bottom" ? link.targetPort
      : terminalCounts.top <= terminalCounts.bottom ? "top" : "bottom";
    return {
      id: String(index),
      source: link.from,
      target: link.to,
      type: "routed",
      data: {
        attachment: attachments[index]!,
        sourcePort: link.failed ? "bottom" : link.sourcePort ?? (outer ? side : undefined),
        targetPort: link.targetPort ?? (outer ? side : undefined),
        terminalLane: outer ? { side, offset: 44 + (side === "top" ? returnCount * recipeLaneGap : 0) + terminalCounts[side]++ * 30 } : undefined,
        laneOffset: lanes.get(index)!,
      },
      label: link.caption ?? (link.invalid ? link.on + " (invalid)" : link.on),
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      style: { ...edgeStyle, stroke },
      selectable: false,
      focusable: false,
    };
  });
}

export function RecipeGraph({ ref, steps, links, layout, automatic, start, editable, inspectable = false, selected, onSelect, onConnect, onLayout }: {
  ref?: Ref<RecipeCanvas>;
  steps: RecipeGraphNode[];
  links: RecipeGraphLink[];
  layout: RecipeLayout;
  automatic: RecipeLayout;
  start: string;
  editable: boolean;
  inspectable?: boolean;
  selected: string;
  onSelect(id: string): void;
  onConnect(connection: Connection): void;
  onLayout(next: RecipeLayout): void;
}) {
  const [flow, setFlow] = useState<ReactFlowInstance<StepNode>>();
  const canvas = useRef<HTMLDivElement>(null);
  const nodes: StepNode[] = steps.map(({ id, label, invalid }) => ({
    id,
    type: "step",
    data: { label },
    position: layout[id]!,
    selected: selected === id,
    className: [s.stepNode, invalid && s.invalidNode].filter(Boolean).join(" "),
    width: 120,
    height: 120,
    zIndex: 1,
    selectable: id !== recipeStart && id !== recipeEnd,
  }));
  useImperativeHandle(ref, () => ({
    dropPosition(point): XYPosition | undefined {
      return canvas.current?.contains(document.elementFromPoint(point.x, point.y))
        ? flow?.screenToFlowPosition(point) : undefined;
    },
  }), [flow]);
  const edges: RoutedRecipeEdge[] = routeRecipeEdges(links, automatic);

  useLayoutEffect(() => {
    flow?.setNodes((current) => {
      const byId = new Map<string, StepNode>(current.map((node) => [node.id, node]));
      return nodes.map((node) => {
        const existing: StepNode | undefined = byId.get(node.id);
        return { ...existing, ...node, position: existing?.dragging ? existing.position : node.position };
      });
    });
  });

  const place = (id: string, position: XYPosition): void => {
    const previous: XYPosition = layout[id]!;
    const slot: XYPosition = snapRecipePosition(position);
    const target: XYPosition = slotTaken(layout, slot, id) ? previous : slot;
    flow?.updateNode(id, { position: target });
    if (!samePosition(previous, target)) onLayout({ ...layout, [id]: target });
  };

  const stop: OnNodeDrag<StepNode> = (_, node) => place(node.id, node.position);

  const connectToCard: OnConnectEnd = (event, connection) => {
    if (!editable || connection.isValid || !connection.fromHandle || !connection.fromNode) return;
    const pointer: MouseEvent | Touch | undefined = "changedTouches" in event ? event.changedTouches[0] : event;
    if (!pointer) return;
    const card: HTMLElement | null = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>(".react-flow__node") ?? null;
    const target: string | undefined = card?.dataset.id;
    const source: string = connection.fromNode.id;
    if (!target || target === source || !canvas.current?.contains(card) || !Object.hasOwn(layout, target)) return;

    onConnect({ source, sourceHandle: connection.fromHandle.id ?? null, target, targetHandle: null });
  };

  const moveByKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const move: XYPosition | undefined = Object.hasOwn(keyboardMoves, event.key) ? keyboardMoves[event.key] : undefined;
    if (!move || !editable || !(event.target instanceof HTMLElement) || !event.target.matches(".react-flow__node")) return;
    const id: string | undefined = event.target.dataset.id;
    if (!id || !Object.hasOwn(layout, id)) return;
    event.preventDefault();
    event.stopPropagation();
    const point: XYPosition = layout[id]!;
    place(id, { x: point.x + move.x, y: point.y + move.y });
  };

  const align = (): void => {
    onLayout(automatic);
    void flow?.setViewport(startViewport(automatic, start));
  };

  return (
    <div ref={canvas} className={s.graph} inert={!editable && !inspectable} onKeyDownCapture={moveByKeyboard}>
      <ReactFlow
        defaultNodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        onInit={setFlow}
        defaultViewport={startViewport(layout, start)}
        minZoom={0.15}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        selectNodesOnDrag={false}
        nodesDraggable={editable}
        autoPanOnNodeDrag={false}
        nodesConnectable={editable}
        edgesReconnectable={false}
        elevateEdgesOnSelect={false}
        onNodeDragStop={stop}
        onConnect={onConnect}
        onConnectEnd={connectToCard}
        isValidConnection={({ source, target }) => source !== recipeEnd && target !== recipeStart
          && (source !== recipeStart || target !== recipeEnd || steps.length === 2)}
        onNodeClick={(_, node) => onSelect(node.id === recipeStart || node.id === recipeEnd ? "" : node.id)}
        onPaneClick={() => onSelect("")}
      >
        <Background variant={BackgroundVariant.Lines} gap={20} className={s.graphPaper} color="var(--border)" />
        <Panel position="bottom-left" className={s.graphControls}>
          <IconButton label="Zoom in" size="sm" icon={<PlusIcon />} disabled={!flow} onClick={() => void flow?.zoomIn()} />
          <IconButton label="Zoom out" size="sm" icon={<MinusIcon />} disabled={!flow} onClick={() => void flow?.zoomOut()} />
          <IconButton label="Fit view" size="sm" icon={<MonitorIcon />} disabled={!flow || !steps.length}
            onClick={() => void flow?.fitView({ maxZoom: 1 })} />
        </Panel>
        {!inspectable && <Panel position="top-right">
          <Button size="sm" disabled={!editable || !steps.length} onClick={align}>Arrange</Button>
        </Panel>}
      </ReactFlow>
    </div>
  );
}
