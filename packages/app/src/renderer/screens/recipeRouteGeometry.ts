import type { XYPosition } from "@xyflow/react";

export type Axis = "horizontal" | "vertical";
export type RouteRect = XYPosition & { width: number; height: number };
export type RouteSegment = { axis: Axis; line: number; low: number; high: number };

export function segment(a: XYPosition, b: XYPosition): RouteSegment {
  return a.y === b.y ? { axis: "horizontal", line: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x) }
    : { axis: "vertical", line: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y) };
}

export function routeSegments(points: XYPosition[]): RouteSegment[] {
  return points.slice(1).map((point, index) => segment(points[index]!, point));
}

export function expand(rect: RouteRect, by: number): RouteRect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 };
}

export function crossesRect({ axis, line, low, high }: RouteSegment, { x, y, width, height }: RouteRect): boolean {
  return axis === "horizontal" ? line > y && line < y + height && low < x + width && high > x
    : line > x && line < x + width && low < y + height && high > y;
}

export function overlaps(a: RouteRect, b: RouteRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
