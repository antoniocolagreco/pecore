import type { XYPosition } from "@xyflow/react";
import { PriorityQueue } from "./recipeRouteQueue";

type Direction = 0 | 1 | 2 | 3;
type Axis = 0 | 1;
export type RouteSide = "left" | "right" | "top" | "bottom";
export type RouteCard = XYPosition & { id: string; width: number; height: number };
export type RouteLink = { from: string; to: string };
export type RoutePort = XYPosition & { side: RouteSide };
export type RecipeRoute = { points: XYPosition[]; source: RoutePort; target: RoutePort };
type Port = { vertex: number; side: Direction; wall: number };
type Search = { cost: number; state: number; target: Port };

const sides: readonly RouteSide[] = ["left", "right", "top", "bottom"];
const clearance: number = 8;

function cuts(cards: RouteCard[], axis: Axis): number[] {
  const bounds: number[] = [...new Set(cards.flatMap(({ x, y, width, height }) =>
    axis === 0 ? [x, x + width] : [y, y + height]))].sort((a, b) => a - b);
  return [bounds[0]! - 64, ...bounds, bounds.at(-1)! + 64];
}

function channels(bounds: number[], lane: number, count: number): number[] {
  const fraction: number = (lane + 1) / (count + 1);
  return bounds.slice(0, -1).map((start, i) => {
    const span: number = bounds[i + 1]! - start;
    const margin: number = Math.min(clearance, span / 4);
    return start + margin + (span - 2 * margin) * fraction;
  });
}

function facing(from: RouteCard, to: RouteCard): Direction {
  const dx: number = to.x + to.width / 2 - from.x - from.width / 2;
  const dy: number = to.y + to.height / 2 - from.y - from.height / 2;
  return Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? 0 : 1 : dy < 0 ? 2 : 3;
}

function gateways(card: RouteCard, xCuts: number[], yCuts: number[], free: Uint8Array): Port[] {
  const stride: number = xCuts.length - 1;
  const left: number = xCuts.indexOf(card.x);
  const right: number = xCuts.indexOf(card.x + card.width);
  const top: number = yCuts.indexOf(card.y);
  const bottom: number = yCuts.indexOf(card.y + card.height);
  const ports: Port[] = [];
  const add = (x: number, y: number, side: Direction, wall: number): void => {
    const vertex: number = y * stride + x;
    if (free[vertex]) ports.push({ vertex, side, wall });
  };
  for (let y: number = top; y < bottom; y++) {
    add(left - 1, y, 0, card.x);
    add(right, y, 1, card.x + card.width);
  }
  for (let x: number = left; x < right; x++) {
    add(x, top - 1, 2, card.y);
    add(x, bottom, 3, card.y + card.height);
  }
  return ports;
}

function collapse(points: XYPosition[]): XYPosition[] {
  return points.filter((point, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const before: XYPosition = points[i - 1]!;
    const after: XYPosition = points[i + 1]!;
    return !(point.x === before.x && point.x === after.x || point.y === before.y && point.y === after.y);
  });
}

export function routeRecipe(links: RouteLink[], cards: RouteCard[]): RecipeRoute[] {
  if (links.length === 0) return [];
  const xCuts: number[] = cuts(cards, 0);
  const yCuts: number[] = cuts(cards, 1);
  const width: number = xCuts.length - 1;
  const height: number = yCuts.length - 1;
  const free: Uint8Array = new Uint8Array(width * height).fill(1);
  for (const card of cards) {
    const left: number = xCuts.indexOf(card.x);
    const right: number = xCuts.indexOf(card.x + card.width);
    const bottom: number = yCuts.indexOf(card.y + card.height);
    for (let y: number = yCuts.indexOf(card.y); y < bottom; y++) free.fill(0, y * width + left, y * width + right);
  }
  const endpoints: Map<string, { card: RouteCard; ports: Port[] }> = new Map(cards.map((card) => [
    card.id, { card, ports: gateways(card, xCuts, yCuts, free) },
  ]));
  const xSpan: number = xCuts.at(-1)! - xCuts[0]!;
  const ySpan: number = yCuts.at(-1)! - yCuts[0]!;
  const bend: number = (xSpan + ySpan) * free.length;
  const sidePenalty: number = bend * (free.length * 2 + 2);

  return links.map(({ from, to }, index) => {
    const source = endpoints.get(from)!;
    const target = endpoints.get(to)!;
    const exit: Direction = facing(source.card, target.card);
    const entry: Direction = facing(target.card, source.card);
    const xs: number[] = channels(xCuts, index, links.length);
    const ys: number[] = channels(yCuts, index, links.length);
    const point = (vertex: number): XYPosition => ({ x: xs[vertex % width]!, y: ys[Math.floor(vertex / width)]! });
    const endpoint = (port: Port): RoutePort => {
      const p: XYPosition = point(port.vertex);
      return port.side < 2 ? { x: port.wall, y: p.y, side: sides[port.side]! } : { x: p.x, y: port.wall, side: sides[port.side]! };
    };
    const lead = (port: Port): number => port.side < 2
      ? Math.abs(xs[port.vertex % width]! - port.wall)
      : Math.abs(ys[Math.floor(port.vertex / width)]! - port.wall);
    const targets: Map<number, Port[]> = new Map();
    for (const port of target.ports) {
      const list: Port[] = targets.get(port.vertex) ?? [];
      list.push(port);
      targets.set(port.vertex, list);
    }

    function search(start: Port[], excludedSide?: Direction): { cost: number; route: RecipeRoute } | undefined {
      const distances: Float64Array = new Float64Array(free.length * 2).fill(Infinity);
      const previous: Int32Array = new Int32Array(distances.length).fill(-1);
      const origins: Map<number, Port> = new Map();
      const queue: PriorityQueue = new PriorityQueue();
      const closest = (value: number, low: number, high: number): number => Math.max(low - value, value - high, 0);
      const estimate = (state: number): number => {
        const { x, y }: XYPosition = point(state >> 1);
        return closest(x, target.card.x, target.card.x + target.card.width)
          + closest(y, target.card.y, target.card.y + target.card.height);
      };
      for (const port of start) {
        const state: number = port.vertex * 2 + Number(port.side >= 2);
        const cost: number = lead(port) + (from !== to && port.side !== exit ? sidePenalty : 0);
        if (cost >= distances[state]!) continue;
        origins.set(state, port);
        distances[state] = cost;
        queue.push(state, cost + estimate(state));
      }
      let best: Search | undefined;
      for (let next = queue.pop(); next; next = queue.pop()) {
        const { state, priority } = next;
        const cost: number = distances[state]!;
        if (priority > cost + estimate(state)) continue;
        if (best && priority >= best.cost) break;
        const vertex: number = state >> 1;
        const axis: number = state & 1;
        for (const port of targets.get(vertex) ?? []) {
          if (port.side === excludedSide) continue;
          const total: number = cost + lead(port) + (axis !== Number(port.side >= 2) ? bend : 0)
            + (from !== to && port.side !== entry ? sidePenalty : 0);
          if (!best || total < best.cost) best = { cost: total, state, target: port };
        }
        const x: number = vertex % width;
        const y: number = Math.floor(vertex / width);
        const visit = (col: number, row: number, direction: Axis, length: number): void => {
          const neighbor: number = row * width + col;
          if (!free[neighbor]) return;
          const dest: number = neighbor * 2 + direction;
          const total: number = cost + length + (direction !== axis ? bend : 0);
          if (total >= distances[dest]!) return;
          distances[dest] = total;
          previous[dest] = state;
          queue.push(dest, total + estimate(dest));
        };
        if (x > 0) visit(x - 1, y, 0, xs[x]! - xs[x - 1]!);
        if (x + 1 < width) visit(x + 1, y, 0, xs[x + 1]! - xs[x]!);
        if (y > 0) visit(x, y - 1, 1, ys[y]! - ys[y - 1]!);
        if (y + 1 < height) visit(x, y + 1, 1, ys[y + 1]! - ys[y]!);
      }
      if (!best) return undefined;
      const end: RoutePort = endpoint(best.target);
      const points: XYPosition[] = [end];
      let state: number = best.state;
      for (; previous[state] !== -1; state = previous[state]!) points.push(point(state >> 1));
      const first: RoutePort = endpoint(origins.get(state)!);
      points.push(point(state >> 1), first);
      return { cost: best.cost, route: { points: collapse(points.reverse()), source: first, target: end } };
    }

    if (from !== to) return search(source.ports)!.route;
    const directions: Direction[] = [0, 1, 2, 3];
    return directions.flatMap((side) => search(source.ports.filter((port) => port.side === side), side) ?? [])
      .sort((a, b) => a.cost - b.cost)[0]!.route;
  });
}
