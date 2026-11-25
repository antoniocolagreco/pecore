import type { XYPosition } from "@xyflow/react";
import { arrowheadLength, arrowheadWidth, crossesRect, expand, overlaps, routeSegments, segment } from "./recipeRouteGeometry";
import type { RouteRect, RouteSegment } from "./recipeRouteGeometry";
import type { RecipeRoute, RouteCard, RouteLink } from "./recipeRouting";

type Interval = { low: number; high: number };
export type RouteLabel = RouteRect & { leader?: [XYPosition, XYPosition] };

function slot(low: number, high: number, blocked: Interval[]): number | undefined {
  if (low > high) return undefined;
  const center: number = (low + high) / 2;
  const candidates: number[] = [center, low, high];
  for (const interval of blocked) candidates.push(interval.low, interval.high);
  return candidates.filter((value) => value >= low && value <= high
    && !blocked.some((interval) => interval.low < value && value < interval.high))
    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))[0];
}

function segmentBounds(line: RouteSegment): RouteRect {
  return line.axis === "horizontal" ? { x: line.low, y: line.line, width: line.high - line.low, height: 0 }
    : { x: line.line, y: line.low, width: 0, height: line.high - line.low };
}

function placeRouteLabel(label: string, path: RouteSegment[], otherPaths: RouteSegment[], obstacles: RouteRect[]): RouteLabel {
  const width: number = Math.ceil(Array.from(label).length * 8.6) + 12;
  const height: number = 22;
  const choices: RouteSegment[] = path.toSorted((a, b) => (b.high - b.low) - (a.high - a.low));
  const stationary: RouteRect[] = [...obstacles, ...otherPaths.map(segmentBounds)];
  const find = (line: RouteSegment, side: -1 | 0 | 1, gap: number, leader: boolean): RouteLabel | undefined => {
    const horizontal: boolean = line.axis === "horizontal";
    const along: number = horizontal ? width : height;
    const across: number = horizontal ? height : width;
    const cross: number = line.line + side * (across / 2 + gap);
    const margin: number = 2;
    const rectangles: RouteRect[] = [...stationary, ...path.filter((other) => other !== line || side !== 0).map(segmentBounds)];
    const blocked: Interval[] = rectangles.flatMap((rect) => {
      const row: number = horizontal ? rect.y : rect.x;
      const span: number = horizontal ? rect.height : rect.width;
      if (cross - across / 2 - margin >= row + span || cross + across / 2 + margin <= row) return [];
      const start: number = horizontal ? rect.x : rect.y;
      const length: number = horizontal ? rect.width : rect.height;
      return [{ low: start - along / 2 - margin, high: start + length + along / 2 + margin }];
    });
    if (leader) {
      const acrossStart: number = Math.min(line.line, line.line + side * gap);
      const acrossEnd: number = Math.max(line.line, line.line + side * gap);
      for (const rect of [...stationary, ...path.filter((other) => other !== line).map(segmentBounds)]) {
        const row: number = horizontal ? rect.y : rect.x;
        const span: number = horizontal ? rect.height : rect.width;
        if (row + span <= acrossStart || row >= acrossEnd) continue;
        const start: number = horizontal ? rect.x : rect.y;
        const length: number = horizontal ? rect.width : rect.height;
        blocked.push({ low: start - margin, high: start + length + margin });
      }
    }
    const inset: number = side === 0 ? along / 2 + 2 : 0;
    const center: number | undefined = slot(line.low + inset, line.high - inset, blocked);
    if (center === undefined) return undefined;
    const x: number = horizontal ? center : cross;
    const y: number = horizontal ? cross : center;
    const rect: RouteRect = { x: x - width / 2, y: y - height / 2, width, height };
    const padded: RouteRect = expand(rect, margin);
    if (obstacles.some((r) => overlaps(padded, r)) || otherPaths.some((s) => crossesRect(s, padded))) return undefined;
    if (!leader) return rect;
    const near: number = line.line + side * gap;
    return { ...rect, leader: horizontal ? [{ x, y: line.line }, { x, y: near }] : [{ x: line.line, y }, { x: near, y }] };
  };
  for (const line of choices) {
    const rect: RouteLabel | undefined = find(line, 0, 0, false);
    if (rect) return rect;
  }
  for (let gap: number = 5; gap <= 53; gap += 12) {
    for (const line of choices) {
      const rect: RouteLabel | undefined = find(line, -1, gap, true) ?? find(line, 1, gap, true);
      if (rect) return rect;
    }
  }
  for (let gap: number = 5; ; gap += 12) {
    for (const line of choices) {
      const rect: RouteLabel | undefined = find(line, -1, gap, false) ?? find(line, 1, gap, false);
      if (rect) return rect;
    }
  }
}

export function labelRecipeRoutes(links: RouteLink[], routes: RecipeRoute[], cards: RouteCard[]): void {
  const paths: RouteSegment[][] = routes.map(({ points }) => routeSegments(points));
  const occupied: RouteRect[] = cards.flatMap((card) => [card, ...(card.caption ? [card.caption] : [])]);
  for (const { target: { x, y, side } } of routes) {
    const half: number = arrowheadWidth / 2;
    const head: RouteRect = side === "left" ? { x: x - arrowheadLength, y: y - half, width: arrowheadLength, height: arrowheadWidth }
      : side === "right" ? { x, y: y - half, width: arrowheadLength, height: arrowheadWidth }
      : side === "top" ? { x: x - half, y: y - arrowheadLength, width: arrowheadWidth, height: arrowheadLength }
      : { x: x - half, y, width: arrowheadWidth, height: arrowheadLength };
    occupied.push(head);
  }
  const order: number[] = links.map((_, index) => index).sort((a, b) => (links[b]!.label?.length ?? 0) - (links[a]!.label?.length ?? 0));
  for (const index of order) {
    const { label } = links[index]!;
    if (!label) continue;
    const box: RouteLabel = placeRouteLabel(label, paths[index]!, paths.flatMap((path, i) => i === index ? [] : path), occupied);
    routes[index]!.label = box;
    occupied.push(expand(box, 4));
    if (box.leader) occupied.push(expand(segmentBounds(segment(...box.leader)), 1));
  }
}
