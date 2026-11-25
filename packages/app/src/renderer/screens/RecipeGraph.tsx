import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Background, BackgroundVariant, Handle, Panel, Position, ReactFlow, useStore } from "@xyflow/react";
import type { Connection, EdgeChange, Node, NodeChange, NodeProps, OnNodeDrag, ReactFlowInstance, Viewport, XYPosition } from "@xyflow/react";
import { Button, IconButton } from "../ds/button";
import { MinusIcon, MonitorIcon, PlusIcon } from "../ds/icons";
import { RecipeEdge } from "./RecipeEdge";
import type { RoutedRecipeEdge } from "./RecipeEdge";
import { cardGap, routeRecipe, routeStroke } from "./recipeRouting";
import type { RouteCard, RecipeRoute, RoutePort } from "./recipeRouting";
import { recipeEnd, recipeGrid, recipeStart, samePosition, snapRecipePosition } from "./recipeLayout";
import type { RecipeLayout, RecipeLink } from "./recipeLayout";
import "@xyflow/react/dist/style.css";
import s from "./Editors.module.css";

export type RecipeGraphNode = { id: string; label: ReactNode; invalid: boolean; caption?: string };
export type RecipeGraphLink = RecipeLink & { invalid: boolean; failed: boolean; caption?: string; neutral?: boolean };
export type RecipeCanvas = { dropPosition(point: XYPosition): XYPosition | undefined };

const sides: Position[] = Object.values(Position);
type Anchor = NonNullable<Node["handles"]>[number];
type StepNode = Node<{ label: ReactNode; anchors: Anchor[] }, "step">;
const cardSize: number = 120;

const edgeStyle = { strokeWidth: routeStroke, strokeLinejoin: "round" as const };

function RecipeStep({ id, data, isConnectable }: NodeProps<StepNode>) {
  const connecting: boolean = useStore((state) => state.connection.inProgress);
  return <>
    {data.label}
    {id !== recipeEnd && sides.map((side) => <Handle key={side} id={side} position={side} type="source"
      isConnectable={isConnectable} isConnectableEnd={false} className={s.availablePort} aria-label={`Connect ${side}`} />)}
    {id !== recipeStart && <Handle id="card" type="target" position={Position.Left} isConnectable={isConnectable}
      isConnectableStart={false} className={s.connectionTarget} style={{ pointerEvents: connecting ? "all" : "none" }} />}
    {data.anchors.map(({ id: anchor, type, position, x, y }) => <Handle key={anchor} id={anchor} type={type}
      position={position} isConnectable={false} className={s.routeAnchor} style={{ left: x, top: y }} />)}
  </>;
}

function dragHandles(id: string): Anchor[] {
  const middle: number = cardSize / 2;
  const handles: Anchor[] = id === recipeEnd ? [] : sides.map((position) => ({
    id: position, position, type: "source", width: 0, height: 0,
    x: position === Position.Left ? 0 : position === Position.Right ? cardSize : middle,
    y: position === Position.Top ? 0 : position === Position.Bottom ? cardSize : middle,
  }));
  if (id !== recipeStart) handles.push({ id: "card", type: "target", position: Position.Left, x: 0, y: middle, width: 0, height: 0 });
  return handles;
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

function blocksCard(layout: RecipeLayout, id: string, point: XYPosition): boolean {
  return Object.entries(layout).some(([other, at]) => other !== id
    && Math.abs(at.x - point.x) < cardSize + 2 * cardGap && Math.abs(at.y - point.y) < cardSize + 2 * cardGap);
}

function edgeCaption(link: RecipeGraphLink): string {
  return link.caption ?? (link.invalid ? link.on + " (invalid)" : link.on);
}

function graphRoutes(steps: RecipeGraphNode[], links: RecipeGraphLink[], positions: RecipeLayout, moved?: { card: string; routes: RecipeRoute[] }): RecipeRoute[] | undefined {
  const cards: RouteCard[] = steps.map(({ id, caption }) => {
    const { x, y }: XYPosition = positions[id]!;
    const width: number = Math.min(168, (caption?.length ?? 0) * 9);
    return { id, x, y, width: cardSize, height: cardSize,
      ...(caption ? { caption: { x: x + (cardSize - width) / 2, y: y + cardSize + 4, width, height: 18 } } : {}) };
  });
  return routeRecipe(links.map((link) => ({ from: link.from, to: link.to, label: edgeCaption(link) })), cards, moved);
}

export function RecipeGraph({ ref, steps, links, layout, automatic, start, editable, inspectable = false, selected, onSelect, onConnect, onReconnect, onDelete, onLayout }: {
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
  onReconnect(from: string, outcome: string, to: string): void;
  onDelete(edges: RecipeLink[]): void;
  onLayout(next: RecipeLayout): void;
}) {
  const [flow, setFlow] = useState<ReactFlowInstance<StepNode, RoutedRecipeEdge>>();
  const [drag, setDrag] = useState<{ id: string; position: XYPosition; routes: RecipeRoute[] }>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const canvas = useRef<HTMLDivElement>(null);
  const reconnectStart = useRef<XYPosition>(null);
  const pendingDrag = useRef<{ id: string; position: XYPosition }>(null);
  const dragFrame = useRef<number>(0);
  useEffect(() => () => cancelAnimationFrame(dragFrame.current), []);
  const positions: RecipeLayout = useMemo(() => drag ? { ...layout, [drag.id]: drag.position } : layout, [layout, drag]);
  const valid: RecipeGraphLink[] = useMemo(() => links.filter(({ from, to }) => layout[from] && layout[to]), [links, layout]);
  const savedRoutes: RecipeRoute[] | undefined = useMemo(() => graphRoutes(steps, valid, layout), [steps, valid, layout]);
  const routes: RecipeRoute[] | undefined = drag?.routes ?? savedRoutes;
  const routed = useMemo(() => {
    const anchors: Map<string, Anchor[]> = new Map();
    const addAnchor = (node: string, id: string, type: Anchor["type"], port: RoutePort): string => {
      const at: XYPosition = positions[node]!;
      const items: Anchor[] = anchors.get(node) ?? [];
      const anchor: string = id + ":" + type;
      items.push({ id: anchor, type, position: port.side as Position, x: port.x - at.x, y: port.y - at.y, width: 0, height: 0 });
      anchors.set(node, items);
      return anchor;
    };
    const edges: RoutedRecipeEdge[] = valid.flatMap((link, index) => {
      const route: RecipeRoute | undefined = routes?.[index];
      if (!route) return [];
      const id: string = `${link.from}:${link.on}`;
      const stroke: string = link.invalid || link.failed ? "var(--recipe-edge-failed)"
        : automatic[link.to]!.x < automatic[link.from]!.x || link.neutral ? "var(--recipe-edge-return)" : "var(--recipe-edge-forward)";
      return [{
        id, source: link.from, target: link.to,
        sourceHandle: addAnchor(link.from, id, "source", route.source),
        targetHandle: addAnchor(link.to, id, "target", route.target),
        type: "routed", data: { outcome: link.on, route },
        label: edgeCaption(link),
        style: { ...edgeStyle, stroke },
        interactionWidth: 8,
        deletable: link.from !== recipeStart || link.to !== recipeEnd,
      }];
    });
    return { edges, anchors };
  }, [valid, positions, routes, automatic]);
  const nodes: StepNode[] = steps.map(({ id, label, invalid }) => ({
    id,
    type: "step",
    data: { label, anchors: routed.anchors.get(id) ?? [] },
    handles: [...dragHandles(id), ...(routed.anchors.get(id) ?? [])],
    position: positions[id]!,
    selected: selected === id,
    className: [s.stepNode, invalid && s.invalidNode].filter(Boolean).join(" "),
    width: cardSize,
    height: cardSize,
    measured: { width: cardSize, height: cardSize },
    zIndex: 1,
    selectable: id !== recipeStart && id !== recipeEnd,
    deletable: false,
  }));
  useImperativeHandle(ref, () => ({
    dropPosition(point): XYPosition | undefined {
      return canvas.current?.contains(document.elementFromPoint(point.x, point.y))
        ? flow?.screenToFlowPosition(point) : undefined;
    },
  }), [flow]);
  const edges: RoutedRecipeEdge[] = routed.edges.map((edge) => ({
    ...edge, selected: selectedEdge === edge.id, selectable: editable,
    focusable: editable, reconnectable: editable && selectedEdge === edge.id ? "target" : false,
  }));

  const place = (id: string, position: XYPosition): void => {
    const previous: XYPosition = layout[id]!;
    const slot: XYPosition = snapRecipePosition(position);
    if (blocksCard(layout, id, slot) || samePosition(previous, slot)) return;
    const next: RecipeLayout = { ...layout, [id]: slot };
    if (graphRoutes(steps, valid, next)) onLayout(next);
  };

  const move = (changes: NodeChange<StepNode>[]): void => {
    for (const change of changes) {
      if (change.type === "position" && change.dragging && change.position) pendingDrag.current = { id: change.id, position: change.position };
    }
    if (dragFrame.current || !pendingDrag.current) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      const next = pendingDrag.current;
      pendingDrag.current = null;
      if (!next || blocksCard(layout, next.id, next.position)) return;
      const routes: RecipeRoute[] | undefined = graphRoutes(steps, valid, { ...layout, [next.id]: next.position },
        savedRoutes && { card: next.id, routes: savedRoutes });
      if (routes) setDrag({ ...next, routes });
    });
  };
  const stop: OnNodeDrag<StepNode> = (_, node) => {
    cancelAnimationFrame(dragFrame.current);
    dragFrame.current = 0;
    pendingDrag.current = null;
    if (!blocksCard(layout, node.id, node.position)) place(node.id, node.position);
    setDrag(undefined);
  };
  const selectEdge = (changes: EdgeChange<RoutedRecipeEdge>[]): void => {
    const selection = changes.find((change) => change.type === "select" && change.selected);
    if (selection?.type === "select") setSelectedEdge(selection.id);
    else if (changes.some((change) => change.type === "select" && change.id === selectedEdge)) setSelectedEdge(undefined);
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
      <ReactFlow<StepNode, RoutedRecipeEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={setFlow}
        defaultViewport={startViewport(layout, start)}
        minZoom={0.15}
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        selectNodesOnDrag={false}
        nodesDraggable={editable}
        autoPanOnNodeDrag={false}
        nodesConnectable={editable}
        edgesReconnectable={editable}
        reconnectRadius={7}
        connectOnClick={false}
        connectionDragThreshold={0}
        connectionRadius={0}
        elevateEdgesOnSelect={false}
        onNodesChange={move}
        onEdgesChange={selectEdge}
        onNodeDragStop={stop}
        onConnect={onConnect}
        onReconnectStart={(event) => {
          reconnectStart.current = { x: event.clientX, y: event.clientY };
        }}
        onReconnect={(edge, { target }) => { if (edge.data) onReconnect(edge.source, edge.data.outcome, target); }}
        onReconnectEnd={(event, edge, _, connection) => {
          const start: XYPosition | null = reconnectStart.current;
          reconnectStart.current = null;
          if (!start || connection.isValid || !("clientX" in event)) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return;
          const target: EventTarget | null = event.target;
          if (target instanceof Element && target.matches(".react-flow__pane") && canvas.current?.contains(target)) {
            void flow?.deleteElements({ edges: [edge] });
          }
        }}
        onEdgesDelete={(deleted) => {
          setSelectedEdge(undefined);
          onDelete(deleted.flatMap((edge) => edge.data ? [{ from: edge.source, to: edge.target, on: edge.data.outcome }] : []));
        }}
        isValidConnection={({ source, target }) => source !== recipeEnd && target !== recipeStart
          && (source !== recipeStart || target !== recipeEnd || steps.length === 2)}
        onNodeClick={(_, node) => {
          setSelectedEdge(undefined);
          onSelect(node.id === recipeStart || node.id === recipeEnd ? "" : node.id);
        }}
        onPaneClick={() => { setSelectedEdge(undefined); onSelect(""); }}
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
