import type { XYPosition } from "@xyflow/react";
import { PriorityQueue } from "./recipeRouteQueue";
import { labelRecipeRoutes } from "./recipeRouteLabels";
import { crossesRect, expand, routeSegments, segment } from "./recipeRouteGeometry";
import type { Axis, RouteRect, RouteSegment } from "./recipeRouteGeometry";
import type { RouteLabel } from "./recipeRouteLabels";

export type RouteSide = "left" | "right" | "top" | "bottom";
export type RouteCard = RouteRect & { id: string; caption?: RouteRect };
export type RouteLink = { from: string; to: string; label?: string };
export type RoutePort = XYPosition & { side: RouteSide };
export type RecipeRoute = { points: XYPosition[]; source: RoutePort; target: RoutePort; label?: RouteLabel };
type Gateway = { port: RoutePort; lead: XYPosition; segment: RouteSegment };
type End = { vertex: number; gate: Gateway; cost: number };
type RouteSpacing = { track: number; lead: number };

export const routeStroke: number = 3;
export const nearGap: number = 14;
export const cardGap: number = 12;
export const portGap: number = 20;
const preferredSpacing: RouteSpacing = { track: 30, lead: 34 };
const compactSpacing: RouteSpacing = { track: 24, lead: 26 };
const bendCost: number = 360;
const facingCost: number = 320;
const sides: readonly RouteSide[] = ["left", "right", "top", "bottom"];

function collapse(points: XYPosition[]): XYPosition[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
    .filter((point, index, distinct) => {
      if (index === 0 || index === distinct.length - 1) return true;
      const a: XYPosition = distinct[index - 1]!;
      const b: XYPosition = distinct[index + 1]!;
      return (a.x !== point.x || b.x !== point.x) && (a.y !== point.y || b.y !== point.y);
    });
}

function facing(from: RouteCard, to: RouteCard): RouteSide {
  const dx: number = to.x + to.width / 2 - from.x - from.width / 2;
  const dy: number = to.y + to.height / 2 - from.y - from.height / 2;
  return Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? "left" : "right" : dy < 0 ? "top" : "bottom";
}

function gateways(card: RouteCard, obstacles: RouteRect[], degree: number, leadLength: number): Gateway[] {
  return sides.flatMap((side) => {
    const horizontal: boolean = side === "left" || side === "right";
    const span: number = horizontal ? card.height : card.width;
    const wall: number = side === "left" ? card.x : side === "right" ? card.x + card.width
      : side === "top" ? card.y : card.y + card.height;
    const direction: number = side === "left" || side === "top" ? -1 : 1;
    const gates: Gateway[] = [];
    const pitch: number = degree > 20 ? portGap : degree >= 18 ? compactSpacing.track : portGap / 2;
    const margin: number = degree > 20 ? pitch / 2 : (span / 2 % pitch || pitch);
    for (let offset: number = margin; offset <= span - margin; offset += pitch) {
      const along: number = (horizontal ? card.y : card.x) + offset;
      const port: RoutePort = { ...(horizontal ? { x: wall, y: along } : { x: along, y: wall }), side };
      for (const length of [leadLength, cardGap]) {
        const leadAxis: number = wall + direction * length;
        const lead: XYPosition = horizontal ? { x: leadAxis, y: along } : { x: along, y: leadAxis };
        const stem: RouteSegment = segment(port, lead);
        if (obstacles.some((rect) => crossesRect(stem, rect))) continue;
        gates.push({ port, lead, segment: stem });
        break;
      }
    }
    return gates;
  });
}

function tracks(critical: number[], extra: number, edgeGap: number): number[] {
  const cuts: number[] = [...new Set(critical)].sort((a, b) => a - b);
  const low: number = cuts[0]! - extra;
  const high: number = cuts.at(-1)! + extra;
  const lines: number[] = [low, ...cuts, high];
  return lines.slice(0, -1).flatMap((line, index) => {
    const next: number = lines[index + 1]!;
    const between: number[] = [];
    for (let v: number = line + edgeGap; v < next; v += edgeGap) between.push(v);
    return [line, ...between];
  }).concat(high);
}

function lowerBound(sorted: number[], value: number): number {
  let left: number = 0;
  let right: number = sorted.length;
  while (left < right) {
    const middle: number = (left + right) >> 1;
    if (sorted[middle]! < value) left = middle + 1;
    else right = middle;
  }
  return left;
}

function makeGrid(xs: number[], ys: number[], obstacles: RouteRect[], edgeGap: number) {
  const width: number = xs.length;
  const size: number = width * ys.length;
  const horizontal: Uint8Array = new Uint8Array(size);
  const vertical: Uint8Array = new Uint8Array(size);
  const edgeIndex = (axis: Axis, along: number, row: number): number => axis === "horizontal" ? row * width + along : along * width + row;
  const vertex = ({ x, y }: XYPosition): number => lowerBound(ys, y) * width + lowerBound(xs, x);
  const point = (index: number): XYPosition => ({ x: xs[index % width]!, y: ys[Math.floor(index / width)]! });
  const mark = (axis: Axis, low: number, high: number, acrossLow: number, acrossHigh: number): void => {
    const along: number[] = axis === "horizontal" ? xs : ys;
    const across: number[] = axis === "horizontal" ? ys : xs;
    const mask: Uint8Array = axis === "horizontal" ? horizontal : vertical;
    const lower: number = lowerBound(along, low);
    const first: number = Math.max(0, lower - Number(along[lower] !== low));
    const end: number = lowerBound(along, high);
    for (let row: number = lowerBound(across, acrossLow); across[row]! < acrossHigh; row++) {
      if (across[row] === acrossLow) continue;
      for (let at: number = first; at < end; at++) mask[edgeIndex(axis, at, row)] = 1;
    }
  };
  const block = ({ x, y, width, height }: RouteRect): void => {
    mark("horizontal", x, x + width, y, y + height);
    mark("vertical", y, y + height, x, x + width);
  };
  for (const rect of obstacles) block(rect);
  const reserve = (s: Shaft): void => {
    const gap: number = s.near ? nearGap : edgeGap;
    mark(s.axis, s.low, s.high, s.line - gap, s.line + gap);
  };
  return { xs, ys, width, size, horizontal, vertical, vertex, point, reserve };
}

function search(grid: ReturnType<typeof makeGrid>, starts: End[], ends: End[], target: RouteCard, live: boolean): RecipeRoute | undefined {
  if (!starts.length || !ends.length) return undefined;
  const { xs, ys, width, size, horizontal, vertical, point } = grid;
  const distances: Float64Array = new Float64Array(size * 2).fill(Infinity);
  const previous: Int32Array = new Int32Array(size * 2).fill(-1);
  const origins: Map<number, Gateway> = new Map();
  const queue: PriorityQueue = new PriorityQueue();
  const toAxis = (gate: Gateway): number => Number(gate.segment.axis === "vertical");
  const atTarget: Map<number, End[]> = new Map();
  for (const end of ends) {
    const entries: End[] = atTarget.get(end.vertex) ?? [];
    entries.push(end);
    atTarget.set(end.vertex, entries);
  }
  const estimate = (vertex: number): number => {
    const x: number = xs[vertex % width]!;
    const y: number = ys[Math.floor(vertex / width)]!;
    const distance: number = Math.max(target.x - x, x - target.x - target.width, 0) + Math.max(target.y - y, y - target.y - target.height, 0);
    return distance * (live ? 2 : 1);
  };
  for (const { vertex, gate, cost } of starts) {
    const state: number = vertex * 2 + toAxis(gate);
    if (cost >= distances[state]!) continue;
    distances[state] = cost;
    origins.set(state, gate);
    queue.push(state, cost + estimate(vertex));
  }
  let best: { state: number; cost: number; gate: Gateway } | undefined;
  for (let next = queue.pop(); next; next = queue.pop()) {
    const { state, priority } = next;
    if (best && priority >= best.cost) break;
    const vertex: number = state >> 1;
    const axis: number = state & 1;
    const cost: number = distances[state]!;
    if (priority > cost + estimate(vertex)) continue;
    for (const end of atTarget.get(vertex) ?? []) {
      const total: number = cost + end.cost + (axis === toAxis(end.gate) ? 0 : bendCost);
      if (!best || total < best.cost) best = { state, cost: total, gate: end.gate };
    }
    const x: number = vertex % width;
    const y: number = Math.floor(vertex / width);
    const visit = (to: number, direction: number, length: number): void => {
      const nextState: number = to * 2 + direction;
      const total: number = cost + length + (axis === direction ? 0 : bendCost);
      if (total >= distances[nextState]!) return;
      distances[nextState] = total;
      previous[nextState] = state;
      queue.push(nextState, total + estimate(to));
    };
    if (x > 0 && !horizontal[vertex - 1]) visit(vertex - 1, 0, xs[x]! - xs[x - 1]!);
    if (x + 1 < width && !horizontal[vertex]) visit(vertex + 1, 0, xs[x + 1]! - xs[x]!);
    if (y > 0 && !vertical[vertex - width]) visit(vertex - width, 1, ys[y]! - ys[y - 1]!);
    if (y + 1 < ys.length && !vertical[vertex]) visit(vertex + width, 1, ys[y + 1]! - ys[y]!);
  }
  if (!best) return undefined;
  const points: XYPosition[] = [best.gate.port];
  let state: number = best.state;
  for (; previous[state] !== -1; state = previous[state]!) points.push(point(state >> 1));
  const first: Gateway = origins.get(state)!;
  points.push(first.lead, first.port);
  return { points: collapse(points.reverse()), source: first.port, target: best.gate.port };
}

type Shaft = RouteSegment & { near: boolean };

export function routeShafts(route: RecipeRoute): Shaft[] {
  const leadLength: number = compactSpacing.lead;
  const lengths: RouteSegment[] = routeSegments(route.points);
  return lengths.flatMap((s, index) => {
    let low: number = s.low;
    let high: number = s.high;
    if (index === 0) {
      const port: number = s.axis === "horizontal" ? route.source.x : route.source.y;
      if (port === s.low) low = Math.min(s.high, s.low + leadLength);
      else high = Math.max(s.low, s.high - leadLength);
    }
    if (index === lengths.length - 1) {
      const port: number = s.axis === "horizontal" ? route.target.x : route.target.y;
      if (port === s.low) low = Math.min(high, s.low + leadLength);
      else high = Math.max(low, s.high - leadLength);
    }
    return [
      ...(s.low < low ? [{ ...s, high: low, near: true }] : []),
      ...(low < high ? [{ ...s, low, high, near: false }] : []),
      ...(high < s.high ? [{ ...s, low: high, near: true }] : []),
    ];
  });
}

function conflict(a: Shaft, b: Shaft, edgeGap: number): boolean {
  return a.axis === b.axis && Math.abs(a.line - b.line) < (a.near || b.near ? nearGap : edgeGap) && a.low < b.high && b.low < a.high;
}

function gatewayShafts({ port, segment: stem }: Gateway): Shaft[] {
  const length: number = compactSpacing.lead;
  if (stem.high - stem.low <= length) return [{ ...stem, near: true }];
  const atStart: boolean = (stem.axis === "horizontal" ? port.x : port.y) === stem.low;
  const split: number = atStart ? stem.low + length : stem.high - length;
  return [{ ...stem, high: split, near: atStart }, { ...stem, low: split, near: !atStart }];
}

function routeWithSpace(links: RouteLink[], cards: RouteCard[], spacing: RouteSpacing, outer: number, longestFirst: boolean,
  kept?: ReadonlyMap<number, RecipeRoute>): RecipeRoute[] | undefined {
  const padded: RouteRect[] = cards.map((card) => expand(card, cardGap));
  const obstacles: RouteRect[] = [...padded, ...cards.flatMap(({ caption }) => caption ? [expand(caption, 4)] : [])];
  const byId: Map<string, RouteCard> = new Map(cards.map((card) => [card.id, card]));
  const degrees: Map<string, number> = new Map();
  for (const { from, to } of links) for (const id of [from, to]) degrees.set(id, (degrees.get(id) ?? 0) + 1);
  const active: Set<string> = new Set(links.flatMap(({ from, to }, index) => kept?.has(index) ? [] : [from, to]));
  const gates: Map<string, Gateway[]> = new Map(cards.flatMap((card, index) => active.has(card.id) ? [[card.id,
    gateways(card, obstacles.filter((rect) => rect !== padded[index]), degrees.get(card.id) ?? 0, spacing.lead),
  ]] : []));
  const allGates: Gateway[] = [...gates.values()].flat();
  const xs: number[] = tracks([...obstacles.flatMap(({ x, width }) => [x, x + width]), ...allGates.map(({ lead }) => lead.x)], outer, spacing.track);
  const ys: number[] = tracks([...obstacles.flatMap(({ y, height }) => [y, y + height]), ...allGates.map(({ lead }) => lead.y)], outer, spacing.track);
  const grid = makeGrid(xs, ys, obstacles, spacing.track);
  const used: Map<string, RoutePort[]> = new Map();
  const taken: Shaft[] = [];
  const routes: RecipeRoute[] = [];
  const reserve = (index: number, route: RecipeRoute): void => {
    const { from, to } = links[index]!;
    routes[index] = route;
    for (const [id, port] of [[from, route.source], [to, route.target]] as const) {
      const booked: RoutePort[] = used.get(id) ?? [];
      booked.push(port);
      used.set(id, booked);
    }
    for (const s of routeShafts(route)) {
      grid.reserve(s);
      taken.push(s);
    }
  };
  for (const [index, route] of kept ?? []) reserve(index, { points: route.points, source: route.source, target: route.target });
  const order = links.flatMap(({ from, to }, index) => {
    if (kept?.has(index)) return [];
    const a: RouteCard = byId.get(from)!;
    const b: RouteCard = byId.get(to)!;
    return [{ index, distance: Math.abs(a.x - b.x) + Math.abs(a.y - b.y), boundary: from === "@start" }];
  }).sort((a, b) => Number(b.boundary) - Number(a.boundary) || Number(b.distance === 0) - Number(a.distance === 0)
    || (a.distance - b.distance) * (longestFirst ? -1 : 1) || (longestFirst ? b.index - a.index : a.index - b.index));
  for (const { index } of order) {
    const { from, to } = links[index]!;
    const source: RouteCard = byId.get(from)!;
    const target: RouteCard = byId.get(to)!;
    const candidates = (card: RouteCard, opposite: RouteCard): End[] => {
      const preferred: RouteSide = facing(card, opposite);
      return gates.get(card.id)!.flatMap((gate) => {
        const { port, lead, segment } = gate;
        if (used.get(card.id)?.some((p) => p.side === port.side && Math.hypot(p.x - port.x, p.y - port.y) < portGap)
          || gatewayShafts(gate).some((shaft) => taken.some((s) => conflict(shaft, s, spacing.track)))) return [];
        const center: number = segment.axis === "horizontal" ? card.y + card.height / 2 : card.x + card.width / 2;
        const cost: number = segment.high - segment.low + Math.abs(center - segment.line) * 1.25
          + (preferred === port.side || from === to ? 0 : facingCost);
        return [{ vertex: grid.vertex(lead), gate, cost }];
      });
    };
    const starts: End[] = candidates(source, target);
    const ends: End[] = candidates(target, source);
    let route: RecipeRoute | undefined;
    if (from !== to) route = search(grid, starts, ends, target, !!kept);
    else {
      for (const side of sides) {
        route = search(grid, starts.filter(({ gate }) => gate.port.side === side),
          ends.filter(({ gate }) => gate.port.side !== side), target, !!kept);
        if (route && Math.hypot(route.source.x - route.target.x, route.source.y - route.target.y) >= portGap) break;
        route = undefined;
      }
    }
    if (!route) return undefined;
    reserve(index, route);
  }
  return routes;
}

export function routeRecipe(links: RouteLink[], cards: RouteCard[], moved?: { card: string; routes: RecipeRoute[] }): RecipeRoute[] | undefined {
  if (links.length === 0) return [];
  const outer: number = Math.max(6, Math.ceil(links.length / 4)) * preferredSpacing.track;
  let routes: RecipeRoute[] | undefined;
  if (moved) {
    const card: RouteCard = cards.find(({ id }) => id === moved.card)!;
    const blocked: RouteRect[] = [expand(card, cardGap), ...(card.caption ? [expand(card.caption, 4)] : [])];
    const kept: Map<number, RecipeRoute> = new Map();
    for (const [index, { from, to }] of links.entries()) {
      const route: RecipeRoute | undefined = moved.routes[index];
      if (!route || from === card.id || to === card.id) continue;
      if (!routeSegments(route.points).some((line) => blocked.some((rect) => crossesRect(line, rect)))) kept.set(index, route);
    }
    routes = routeWithSpace(links, cards, preferredSpacing, outer, false, kept)
      ?? routeWithSpace(links, cards, compactSpacing, outer, false, kept);
  }
  routes ??= routeWithSpace(links, cards, preferredSpacing, outer, false, moved && new Map())
    ?? routeWithSpace(links, cards, compactSpacing, outer, false, moved && new Map())
    ?? routeWithSpace(links, cards, compactSpacing, outer * 2, true, moved && new Map());
  if (routes) labelRecipeRoutes(links, routes, cards);
  if (routes && moved) {
    for (const [index, route] of routes.entries()) {
      const prior: RecipeRoute | undefined = moved.routes[index];
      if (prior && prior.points === route.points && JSON.stringify(prior.label) === JSON.stringify(route.label)) routes[index] = prior;
    }
  }
  return routes;
}
