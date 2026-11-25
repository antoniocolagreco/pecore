import type { XYPosition } from "@xyflow/react";
import { Recipe, templateTitle } from "@pecore/schemas";
import { expect, it } from "vitest";
import { arrangeRecipe, recipeEnd, recipeStart, withRecipeBoundaries } from "./recipeLayout";
import type { RecipeLayout } from "./recipeLayout";
import { routeRecipe, routeShafts } from "./recipeRouting";
import type { RecipeRoute, RouteCard, RouteLink, RouteSide } from "./recipeRouting";
import { crossesRect, expand, overlaps, routeSegments, segment } from "./recipeRouteGeometry";
import type { RouteRect, RouteSegment } from "./recipeRouteGeometry";

function card(id: string, x: number, y: number, caption?: string): RouteCard {
  const width: number = Math.min(168, (caption?.length ?? 0) * 9);
  return { id, x, y, width: 120, height: 120,
    caption: caption ? { x: x + (120 - width) / 2, y: y + 124, width, height: 18 } : undefined };
}

function expectClean(links: RouteLink[], routes: RecipeRoute[] | undefined, cards: RouteCard[], trackGap: number = 20): void {
  expect(routes).toHaveLength(links.length);
  const drawn: ReturnType<typeof routeShafts> = [];
  const ports: Map<string, XYPosition[]> = new Map();
  const labels: { index: number; rect: RouteRect }[] = [];
  const paths: RouteSegment[][] = routes!.map(({ points }) => routeSegments(points));
  const boxes: RouteRect[] = cards.flatMap((card) => [card, ...(card.caption ? [card.caption] : [])]);
  for (const [index, route] of routes!.entries()) {
    const { points, source, target, label } = route;
    const link: RouteLink = links[index]!;
    if (link.label) expect(label).toBeDefined();
    if (label) labels.push({ index, rect: label });
    for (const [id, end] of [[link.from, source], [link.to, target]] as const) {
      const existing: XYPosition[] = ports.get(id) ?? [];
      for (const port of existing) {
        if (port.x === end.x || port.y === end.y) expect(Math.hypot(port.x - end.x, port.y - end.y)).toBeGreaterThanOrEqual(20);
      }
      existing.push(end);
      ports.set(id, existing);
    }
    const lines: RouteSegment[] = paths[index]!;
    for (const [i, s] of lines.entries()) {
      const a: XYPosition = points[i]!;
      const b: XYPosition = points[i + 1]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      expect(s.high).toBeGreaterThan(s.low);
      for (const card of cards) {
        const attached: boolean = (i === 0 && card.id === link.from) || (i === lines.length - 1 && card.id === link.to);
        expect(crossesRect(s, expand(card, attached ? 0 : 12)), `${link.from} → ${link.to} crosses ${card.id}`).toBe(false);
        if (card.caption) expect(crossesRect(s, card.caption)).toBe(false);
      }
    }
    const shafts: ReturnType<typeof routeShafts> = routeShafts(route);
    for (const s of shafts) for (const other of drawn) {
      if (s.axis === other.axis && s.low < other.high && other.low < s.high) {
        expect(Math.abs(s.line - other.line) - 3, `${link.from} → ${link.to} has a crowded lane`).toBeGreaterThanOrEqual(s.near || other.near ? 10 : trackGap);
      }
    }
    drawn.push(...shafts);
  }
  for (const { index, rect: label } of labels) {
    for (const line of paths.flatMap((path, i) => i === index ? [] : path)) expect(crossesRect(line, expand(label, 2))).toBe(false);
    for (const box of boxes) expect(overlaps(label, box)).toBe(false);
    for (const other of labels) if (other.index !== index) expect(overlaps(expand(label, 6), other.rect)).toBe(false);
    const leader: [XYPosition, XYPosition] | undefined = routes![index]!.label?.leader;
    if (leader) {
      const line: RouteSegment = segment(...leader);
      for (const box of [...boxes, ...labels.filter((other) => other.index !== index).map(({ rect }) => rect)]) {
        expect(crossesRect(line, box)).toBe(false);
      }
    }
  }
}

it("routes twenty parallel arrows and crossing retries at full clearance in a crowded graph", () => {
  const obstacles: RouteCard[] = Array.from({ length: 20 }, (_, index) => card("obstacle-" + index, (index % 5) * 200, Math.floor(index / 5) * 200));
  const cards: RouteCard[] = [card("read", -220, 200), card("end", 1020, 200), ...obstacles];
  const links: RouteLink[] = [
    ...Array.from({ length: 20 }, (_, index): RouteLink => ({ from: "read", to: "end", label: "outcome-" + index })),
    { from: "obstacle-19", to: "obstacle-0" },
    { from: "obstacle-4", to: "obstacle-15" },
    { from: "obstacle-8", to: "obstacle-8" },
  ];
  expectClean(links, routeRecipe(links, cards), cards);
});

it.each<[number, number, RouteSide, RouteSide]>([
  [230, 30, "right", "left"],
  [60, 200, "bottom", "top"],
  [-240, -40, "left", "right"],
  [-30, -210, "top", "bottom"],
])("uses the facing sides from (%s, %s) and routes both endpoints anew", (x, y, source, target) => {
  const cards: RouteCard[] = [card("a", 0, 0), card("b", x, y)];
  const links: RouteLink[] = [{ from: "a", to: "b" }];
  const routes: RecipeRoute[] | undefined = routeRecipe(links, cards);
  expect(routes?.[0]).toMatchObject({ source: { side: source }, target: { side: target } });
  expectClean(links, routes, cards);
});

it("centers an unobstructed connection and moves its ports along the facing sides when a card moves", () => {
  const links: RouteLink[] = [{ from: "a", to: "b" }];
  const straight: RecipeRoute = routeRecipe(links, [card("a", 0, 0), card("b", 200, 0)])![0]!;
  const moved: RecipeRoute = routeRecipe(links, [card("a", 0, 0), card("b", 200, 60)])![0]!;
  expect(straight.points).toEqual([{ x: 120, y: 60, side: "right" }, { x: 200, y: 60, side: "left" }]);
  expect(moved.points).toHaveLength(2);
  expect(moved.source.y).toBeGreaterThan(straight.source.y);
  expect(moved.source.side).toBe("right");
});

it("uses a clear one-bend route between diagonally placed cards", () => {
  const cards: RouteCard[] = [card("spec", 0, 0, "Spec"), card("tests", 275, 355, "Tests")];
  const links: RouteLink[] = [{ from: "spec", to: "tests", label: "success" }];
  const routes: RecipeRoute[] | undefined = routeRecipe(links, cards);
  expectClean(links, routes, cards);
  expect(routes?.[0]?.points).toHaveLength(3);
});

it("reuses clear shafts during a drag and reroutes an unrelated arrow when the moving card blocks it", () => {
  const links: RouteLink[] = [
    { from: "a", to: "b", label: "success" },
    { from: "c", to: "d", label: "failure" },
    { from: "moving", to: "e", label: "approved" },
  ];
  const original: RouteCard[] = [
    card("a", 0, 0), card("b", 500, 0), card("c", 0, 580), card("d", 500, 580),
    card("moving", 240, 280), card("e", 500, 280),
  ];
  const before: RecipeRoute[] = routeRecipe(links, original)!;
  const moved: RouteCard[] = original.map((item) => item.id === "moving" ? card("moving", 240, 0) : item);
  const after: RecipeRoute[] | undefined = routeRecipe(links, moved, { card: "moving", routes: before });
  expectClean(links, after, moved);
  expect(after?.[0]?.points).not.toBe(before[0]?.points);
  expect(after?.[1]).toBe(before[1]);
  expect(after?.[2]?.source).not.toEqual(before[2]?.source);
});

const recipes: Record<string, unknown> = import.meta.glob("../../../resources/templates/recipes/*.json", { eager: true, import: "default" });
it.each(Object.entries(recipes).map(([file, value]) => [file.split("/").at(-1)!, value] as const))(
  "keeps ports, tracks, card margins and labels clear in the shipped %s recipe", (_, value) => {
  const recipe: Recipe = Recipe.parse(value);
  const positions: RecipeLayout = withRecipeBoundaries(
    arrangeRecipe(Object.keys(recipe.nodes), recipe.edges, recipe.start!, recipe.onBaseChanged ?? ""), recipe.start!,
  );
  const cards: RouteCard[] = Object.entries(positions).map(([id, { x, y }]) => {
    const use: string | undefined = recipe.nodes[id]?.use;
    return card(id, x, y, use && id !== use ? templateTitle(id) : undefined);
  });
  const links: RouteLink[] = [
    ...recipe.edges.map(({ from, to, on }) => ({ from, to, label: on })),
    ...recipe.ends!.map(({ from, on, result }) => {
      const caption: string = { failed: "Failure", succeeded: "Success", not_delivered: "Not delivered" }[result];
      return { from, to: recipeEnd, label: on === "success" || on === "failure" ? caption : `${on} · ${caption}` };
    }),
    { from: recipeStart, to: recipe.start! },
  ];
  const routes: RecipeRoute[] | undefined = routeRecipe(links, cards);
  expectClean(links, routes, cards, 27);
  for (const { points, label } of routes!) {
    const segments: RouteSegment[] = routeSegments(points);
    expect(segments[0]!.high - segments[0]!.low).toBeGreaterThanOrEqual(34);
    expect(segments.at(-1)!.high - segments.at(-1)!.low).toBeGreaterThanOrEqual(34);
    if (!label) continue;
    expect(label.leader !== undefined || segments.some((line) => crossesRect(line, expand(label, 6)))).toBe(true);
  }
});
