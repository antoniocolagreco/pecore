import { BaseEdge, getSmoothStepPath, Position, useInternalNode } from "@xyflow/react";
import type { Edge, EdgeProps, InternalNode, XYPosition } from "@xyflow/react";
import type { EdgePort } from "@pecore/schemas";
import type { RecipeLink } from "./recipeLayout";

type Attachment = { source: number; target: number };
type TerminalLane = { side: "top" | "bottom"; offset: number };

export type RoutedRecipeEdge = Edge<{
  attachment: Attachment;
  sourcePort?: EdgePort;
  targetPort?: EdgePort;
  laneOffset: number;
  terminalLane?: TerminalLane;
}, "routed">;

const endpointGap: number = 3;
const bendRadius: number = 18;

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

function returnPath(source: XYPosition, target: XYPosition, offset: number): [string, number, number] {
  const lane: number = Math.min(0, source.y, target.y) - offset;
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
  source: Position, target: Position, band: TerminalLane): [string, number, number] {
  const lane: number = band.side === "top"
    ? Math.min(from.internals.positionAbsolute.y, to.internals.positionAbsolute.y) - band.offset
    : Math.max(
      from.internals.positionAbsolute.y + (from.measured.height ?? from.height ?? 0),
      to.internals.positionAbsolute.y + (to.measured.height ?? to.height ?? 0),
    ) + band.offset;
  const lead: XYPosition[] = laneLead(from, start, source, lane);
  const approach: XYPosition[] = laneLead(to, end, target, lane);
  return [roundedPath([...lead, ...approach.toReversed()]), (lead.at(-1)!.x + approach.at(-1)!.x) / 2, lane];
}

export function RecipeEdge({ id, source, target, data, label, markerEnd, style }: EdgeProps<RoutedRecipeEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data) return null;

  const [defaultSource, defaultTarget] = facingSides(from.internals.positionAbsolute, to.internals.positionAbsolute);
  const sourcePosition: Position = data.sourcePort ? positions[data.sourcePort] : defaultSource;
  const targetPosition: Position = data.targetPort ? positions[data.targetPort] : defaultTarget;
  const start: XYPosition = attachmentPoint(from, sourcePosition, data.attachment.source);
  const end: XYPosition = attachmentPoint(to, targetPosition, data.attachment.target);
  const [path, labelX, labelY] = data.terminalLane
    ? terminalPath(from, to, start, end, sourcePosition, targetPosition, data.terminalLane)
    : sourcePosition === Position.Top && targetPosition === Position.Top
      ? returnPath(start, end, data.laneOffset)
      : getSmoothStepPath({
      sourceX: start.x, sourceY: start.y, sourcePosition,
      targetX: end.x, targetY: end.y, targetPosition, borderRadius: bendRadius,
    });
  return <BaseEdge id={id} path={path} label={label} labelX={labelX} labelY={labelY} markerEnd={markerEnd} style={style} />;
}
