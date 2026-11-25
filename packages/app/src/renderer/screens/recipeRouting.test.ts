import type { XYPosition } from "@xyflow/react";
import { Recipe, templateTitle } from "@pecore/schemas";
import { expect, it } from "vitest";
import { arrangeRecipe, recipeEnd, recipeStart, withRecipeBoundaries } from "./recipeLayout";
import type { RecipeLayout } from "./recipeLayout";
import { routeRecipe } from "./recipeRouting";
import type { RecipeRoute, RouteCard, RouteLink, RouteSide } from "./recipeRouting";
import { crossesRect, expand, routeSegments, segment } from "./recipeRouteGeometry";
import type { RouteRect, RouteSegment } from "./recipeRouteGeometry";

function card(id: string, x: number, y: number, caption?: string): RouteCard {
  const width: number = Math.min(168, (caption?.length ?? 0) * 9);
  return { id, x, y, width: 120, height: 120,
    caption: caption ? { x: x + (120 - width) / 2, y: y + 124, width, height: 18 } : undefined };
}

function expectClean(links: RouteLink[], routes: RecipeRoute[] | undefined, cards: RouteCard[]): void {
  expect(routes).toHaveLength(links.length);
  const drawn: RouteSegment[] = [];
  const ports: Map<string, XYPosition[]> = new Map();
  const labels: { index: number; rect: RouteRect }[] = [];
  const paths: RouteSegment[][] = routes!.map(({ points }) => routeSegments(points));
  const boxes: RouteRect[] = cards.flatMap((card) => [card, ...(card.caption ? [card.caption] : [])]);
  for (const [index, { points, source, target, label }] of routes!.entries()) {
    const link: RouteLink = links[index]!;
    if (link.label) expect(label).toBeDefined();
    if (label) labels.push({ index, rect: label });
    for (const [id, end] of [[link.from, source], [link.to, target]] as const) {
      const existing: XYPosition[] = ports.get(id) ?? [];
      for (const port of existing) expect(Math.hypot(port.x - end.x, port.y - end.y)).toBeGreaterThanOrEqual(18);
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
      for (const other of drawn) {
        if (s.axis === other.axis && s.low < other.high && other.low < s.high) {
          expect(Math.abs(s.line - other.line) - 3, `${link.from} → ${link.to} has a crowded lane`).toBeGreaterThanOrEqual(10);
        }
      }
    }
    drawn.push(...lines);
  }
  for (const { index, rect: label } of labels) {
    for (const line of paths.flatMap((path, i) => i === index ? [] : path)) expect(crossesRect(line, expand(label, 2))).toBe(false);
    for (const other of [...boxes, ...labels.map(({ rect }) => rect)]) {
      if (label === other) continue;
      expect(label.x < other.x + other.width && label.x + label.width > other.x
        && label.y < other.y + other.height && label.y + label.height > other.y).toBe(false);
    }
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
  const obstacles: RouteCard[] = Array.from({ length: 20 }, (_, index) => card("obstacle-" + index, (index % 5) * 164, Math.floor(index / 5) * 164));
  const cards: RouteCard[] = [card("read", -174, 166), card("end", 824, 171), ...obstacles];
  const links: RouteLink[] = [
    ...Array.from({ length: 20 }, (_, index): RouteLink => ({ from: "read", to: "end", label: "outcome-" + index })),
    { from: "obstacle-19", to: "obstacle-0" },
    { from: "obstacle-4", to: "obstacle-15" },
    { from: "obstacle-8", to: "obstacle-8" },
    { from: "end", to: "read" },
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
  const moved: RecipeRoute = routeRecipe(links, [card("a", 0, 0), card("b", 200, 54)])![0]!;
  expect(straight.points).toEqual([{ x: 120, y: 60, side: "right" }, { x: 200, y: 60, side: "left" }]);
  expect(moved.points).toHaveLength(2);
  expect(moved.source.y).toBeGreaterThan(straight.source.y);
  expect(moved.source.side).toBe("right");
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
  expectClean(links, routes, cards);
  for (const { points, label } of routes!) {
    if (!label) continue;
    expect(label.leader !== undefined || routeSegments(points).some((line) => crossesRect(line, expand(label, 6)))).toBe(true);
  }
});
