import { BaseEdge, getSmoothStepPath, Position, useStore } from "@xyflow/react";
import type { Edge, EdgeProps, InternalNode, ReactFlowState, XYPosition } from "@xyflow/react";
import type { EdgePort } from "@pecore/schemas";
import type { RecipeLink } from "./recipeLayout";

type Attachment = { source: number; target: number };
type TerminalLane = { side: "top" | "bottom"; offset: number };
type HorizontalLane = { left: number; right: number; y: number };
type EdgePath = [path: string, labelX: number, labelY: number];

export type RoutedRecipeEdge = Edge<{
  attachment: Attachment;
  sourcePort?: EdgePort;
  targetPort?: EdgePort;
  laneOffset: number;
  terminalLane?: TerminalLane;
}, "routed">;

const endpointGap: number = 3;
const bendRadius: number = 18;
export const recipeLaneGap: number = 24;
const pathsByState = new WeakMap<ReactFlowState, Map<string, EdgePath>>();

const positions: Record<EdgePort, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export function recipeAttachments(links: RecipeLink[]): Attachment[] {
  const used = new Map<string, Set<number>>();
  const assigned: Attachment[] = links.map(({ from, to }) => {
    const source = used.get(from) ?? new Set<number>();
    const target = from === to ? source : used.get(to) ?? new Set<number>();
    let slot: number = 0;
    while (source.has(slot) || target.has(slot)) slot++;
    source.add(slot);
    let targetSlot: number = slot;
    if (from === to) {
      while (target.has(targetSlot)) targetSlot++;
    }
    target.add(targetSlot);
    used.set(from, source);
    used.set(to, target);
    return { source: slot, target: targetSlot };
  });
  const spread: number = Math.ceil((1 + Math.max(0, ...assigned.map(({ source, target }) => Math.max(source, target)))) / 2);
  const fraction = (slot: number): number => {
    const distance: number = Math.ceil((slot + 1) / 2) * 0.38 / spread;
    return slot % 2 === 0 ? 0.5 - distance : 0.5 + distance;
  };
  return assigned.map(({ source, target }) => ({ source: fraction(source), target: fraction(target) }));
}

function facingSides(source: XYPosition, target: XYPosition): [Position, Position] {
  const dx: number = target.x - source.x;
  const dy: number = target.y - source.y;
  const sameRow: boolean = Math.abs(dy) < 24;
  if (sameRow) return dx < -24 ? [Position.Top, Position.Top] : [Position.Right, Position.Left];
  const vertical: boolean = Math.abs(dx) < 24;
  const toward: Position = dx < 0 ? Position.Left : Position.Right;
  return dy < 0
    ? [vertical ? Position.Top : toward, Position.Bottom]
    : [vertical ? Position.Bottom : toward, Position.Top];
}

function attachmentPoint(node: InternalNode, side: Position, offset: number): XYPosition {
  const { x, y } = node.internals.positionAbsolute;
  const width: number = node.measured.width ?? node.width ?? 0;
  const height: number = node.measured.height ?? node.height ?? 0;
  switch (side) {
    case Position.Left: return { x: x - endpointGap, y: y + height * offset };
    case Position.Right: return { x: x + width + endpointGap, y: y + height * offset };
    case Position.Top: return { x: x + width * offset, y: y - endpointGap };
    case Position.Bottom: return { x: x + width * offset, y: y + height + endpointGap };
  }
}

function reserveLane(lanes: HorizontalLane[], fromX: number, toX: number, preferred: number, side: TerminalLane["side"]): number {
  const left: number = Math.min(fromX, toX);
  const right: number = Math.max(fromX, toX);
  const overlapping: HorizontalLane[] = lanes.filter((lane) => left < lane.right && lane.left < right);
  const direction: number = side === "top" ? -1 : 1;
  let y: number = preferred;
  for (const lane of overlapping.sort((first, second) => direction * (first.y - second.y))) {
    if (Math.abs(lane.y - y) < recipeLaneGap) y = lane.y + direction * recipeLaneGap;
  }
  lanes.push({ left, right, y });
  return y;
}

function returnPath(source: XYPosition, target: XYPosition, offset: number, lanes: HorizontalLane[]): EdgePath {
  const preferred: number = Math.min(0, source.y, target.y) - offset;
  const lane: number = reserveLane(lanes, source.x, target.x, preferred, "top");
  const radius: number = Math.min(bendRadius, Math.abs(target.x - source.x) / 2);
  const bend: number = Math.sign(target.x - source.x) * radius;
  const path: string = `M ${source.x},${source.y} V ${lane + radius} Q ${source.x},${lane} ${source.x + bend},${lane} H ${target.x - bend} Q ${target.x},${lane} ${target.x},${lane + radius} V ${target.y}`;
  return [path, (source.x + target.x) / 2, lane];
}

function laneLead(node: InternalNode, point: XYPosition, side: Position, lane: number): XYPosition[] {
  const clearance: number = 20;
  if (side === Position.Left || side === Position.Right) {
    const x: number = point.x + (side === Position.Left ? -clearance : clearance);
    return [point, { x, y: point.y }, { x, y: lane }];
  }
  const above: boolean = side === Position.Top;
  if (above === (lane < point.y)) return [point, { x: point.x, y: lane }];
  const y: number = point.y + (above ? -clearance : clearance);
  const x: number = node.internals.positionAbsolute.x + (node.measured.width ?? node.width ?? 0) + clearance;
  return [point, { x: point.x, y }, { x, y }, { x, y: lane }];
}

function roundedPath(points: XYPosition[]): string {
  const distinct: XYPosition[] = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
  const first: XYPosition = distinct[0]!;
  const last: XYPosition = distinct.at(-1)!;
  let path: string = `M ${first.x},${first.y}`;
  for (let index: number = 1; index < distinct.length - 1; index++) {
    const corner: XYPosition = distinct[index]!;
    const before: XYPosition = distinct[index - 1]!;
    const after: XYPosition = distinct[index + 1]!;
    const radius: number = Math.min(bendRadius, Math.hypot(corner.x - before.x, corner.y - before.y) / 2,
      Math.hypot(after.x - corner.x, after.y - corner.y) / 2);
    const enterX: number = corner.x + Math.sign(before.x - corner.x) * radius;
    const enterY: number = corner.y + Math.sign(before.y - corner.y) * radius;
    const exitX: number = corner.x + Math.sign(after.x - corner.x) * radius;
    const exitY: number = corner.y + Math.sign(after.y - corner.y) * radius;
    path += ` L ${enterX},${enterY} Q ${corner.x},${corner.y} ${exitX},${exitY}`;
  }
  return `${path} L ${last.x},${last.y}`;
}

function terminalPath(from: InternalNode, to: InternalNode, start: XYPosition, end: XYPosition,
  source: Position, target: Position, band: TerminalLane, lanes: HorizontalLane[], bottom: number): EdgePath {
  const preferred: number = band.side === "top"
    ? Math.min(from.internals.positionAbsolute.y, to.internals.positionAbsolute.y) - band.offset
    : Math.max(bottom,
      from.internals.positionAbsolute.y + (from.measured.height ?? from.height ?? 0),
      to.internals.positionAbsolute.y + (to.measured.height ?? to.height ?? 0),
    ) + band.offset;
  const lead: XYPosition[] = laneLead(from, start, source, preferred);
  const approach: XYPosition[] = laneLead(to, end, target, preferred);
  const leadLane: XYPosition = lead.at(-1)!;
  const approachLane: XYPosition = approach.at(-1)!;
  const lane: number = reserveLane(lanes, leadLane.x, approachLane.x, preferred, band.side);
  leadLane.y = lane;
  approachLane.y = lane;
  return [roundedPath([...lead, ...approach.toReversed()]), (leadLane.x + approachLane.x) / 2, lane];
}

function mixedPath(start: XYPosition, end: XYPosition, source: Position, target: Position, lanes: HorizontalLane[]): EdgePath | undefined {
  const reversed: boolean = source === Position.Top || source === Position.Bottom;
  const horizontal: Position = reversed ? target : source;
  const vertical: Position = reversed ? source : target;
  if (horizontal !== Position.Left && horizontal !== Position.Right) return undefined;
  if (vertical !== Position.Top && vertical !== Position.Bottom) return undefined;
  const from: XYPosition = reversed ? end : start;
  const to: XYPosition = reversed ? start : end;
  const dx: number = to.x - from.x;
  if (horizontal === Position.Left ? dx >= 0 : dx <= 0) return undefined;

  const top: boolean = vertical === Position.Top;
  const preferred: number = top ? Math.min(from.y, to.y - 20) : Math.max(from.y, to.y + 20);
  const leadX: number = from.x + Math.sign(dx) * Math.min(20, Math.abs(dx) / 2);
  const lane: number = reserveLane(lanes, from.x, to.x, preferred, top ? "top" : "bottom");
  const points: XYPosition[] = [from, { x: leadX, y: from.y }, { x: leadX, y: lane }, { x: to.x, y: lane }, to];
  return [roundedPath(reversed ? points.reverse() : points), ((lane === from.y ? from.x : leadX) + to.x) / 2, lane];
}

export function recipePath(from: InternalNode, to: InternalNode, data: NonNullable<RoutedRecipeEdge["data"]>, lanes: HorizontalLane[],
  nodes: Iterable<InternalNode>): EdgePath {
  const [defaultSource, defaultTarget] = facingSides(from.internals.positionAbsolute, to.internals.positionAbsolute);
  const sourcePosition: Position = data.sourcePort ? positions[data.sourcePort] : defaultSource;
  const targetPosition: Position = data.targetPort ? positions[data.targetPort] : defaultTarget;
  const start: XYPosition = attachmentPoint(from, sourcePosition, data.attachment.source);
  const end: XYPosition = attachmentPoint(to, targetPosition, data.attachment.target);
  if (data.terminalLane) {
    let bottom: number = 0;
    if (data.terminalLane.side === "bottom") {
      const left: number = Math.min(start.x, end.x);
      const right: number = Math.max(start.x, end.x);
      for (const node of nodes) {
        const { x, y } = node.internals.positionAbsolute;
        if (x <= right && x + (node.measured.width ?? node.width ?? 0) >= left) {
          bottom = Math.max(bottom, y + (node.measured.height ?? node.height ?? 0));
        }
      }
    }
    return terminalPath(from, to, start, end, sourcePosition, targetPosition, data.terminalLane, lanes, bottom);
  }
  if (sourcePosition === Position.Top && targetPosition === Position.Top) return returnPath(start, end, data.laneOffset, lanes);
  const mixed: EdgePath | undefined = mixedPath(start, end, sourcePosition, targetPosition, lanes);
  if (mixed) return mixed;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: start.x, sourceY: start.y, sourcePosition,
    targetX: end.x, targetY: end.y, targetPosition, borderRadius: bendRadius,
  });
  return [path, labelX, labelY];
}

function recipePaths(state: ReactFlowState): Map<string, EdgePath> {
  const cached: Map<string, EdgePath> | undefined = pathsByState.get(state);
  if (cached) return cached;

  const paths = new Map<string, EdgePath>();
  const lanes: HorizontalLane[] = [];
  for (const edge of state.edges) {
    if (edge.type !== "routed") continue;
    const { id, source, target, data } = edge as RoutedRecipeEdge;
    const from: InternalNode | undefined = state.nodeLookup.get(source);
    const to: InternalNode | undefined = state.nodeLookup.get(target);
    if (from && to && data) paths.set(id, recipePath(from, to, data, lanes, state.nodeLookup.values()));
  }
  pathsByState.set(state, paths);
  return paths;
}

export function RecipeEdge({ id, label, markerEnd, style }: EdgeProps<RoutedRecipeEdge>) {
  const route: EdgePath | undefined = useStore((state) => recipePaths(state).get(id),
    (first, second) => first?.[0] === second?.[0] && first?.[1] === second?.[1] && first?.[2] === second?.[2]);
  if (!route) return null;
  const [path, labelX, labelY] = route;
  return <BaseEdge id={id} path={path} label={label} labelX={labelX} labelY={labelY} markerEnd={markerEnd} style={style} />;
}
