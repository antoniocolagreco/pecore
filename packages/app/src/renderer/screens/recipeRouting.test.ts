import type { XYPosition } from "@xyflow/react";
import { expect, it } from "vitest";
import { routeRecipe } from "./recipeRouting";
import type { RecipeRoute, RouteCard, RouteLink, RouteSide } from "./recipeRouting";

type Segment = { line: number; low: number; high: number; horizontal: boolean };

function card(id: string, x: number, y: number): RouteCard {
  return { id, x, y, width: 120, height: 120 };
}

function expectClean(routes: RecipeRoute[], cards: RouteCard[]): void {
  const drawn: Segment[] = [];
  for (const { points } of routes) {
    for (let index: number = 1; index < points.length; index++) {
      const a: XYPosition = points[index - 1]!;
      const b: XYPosition = points[index]!;
      const horizontal: boolean = a.y === b.y;
      expect(horizontal ? a.x !== b.x : a.x === b.x).toBe(true);
      const segment: Segment = horizontal
        ? { line: a.y, low: Math.min(a.x, b.x), high: Math.max(a.x, b.x), horizontal }
        : { line: a.x, low: Math.min(a.y, b.y), high: Math.max(a.y, b.y), horizontal };
      for (const { x, y, width, height } of cards) {
        const hit: boolean = horizontal
          ? a.y > y && a.y < y + height && segment.low < x + width && segment.high > x
          : a.x > x && a.x < x + width && segment.low < y + height && segment.high > y;
        expect(hit).toBe(false);
      }
      expect(drawn.some((other) => other.horizontal === horizontal && other.line === segment.line
        && other.low < segment.high && segment.low < other.high)).toBe(false);
      drawn.push(segment);
    }
  }
}

it("routes twenty parallel arrows and crossing retries through a crowded graph without shared segments or covered cards", () => {
  const obstacles: RouteCard[] = Array.from({ length: 20 }, (_, index) => card("obstacle-" + index, (index % 5) * 136, Math.floor(index / 5) * 128));
  const cards: RouteCard[] = [card("read", -138, 127), card("end", 690, 131), ...obstacles];
  const links: RouteLink[] = [
    ...Array.from({ length: 20 }, (): RouteLink => ({ from: "read", to: "end" })),
    { from: "obstacle-19", to: "obstacle-0" },
    { from: "obstacle-4", to: "obstacle-15" },
    { from: "obstacle-8", to: "obstacle-8" },
    { from: "end", to: "read" },
  ];
  const routes: RecipeRoute[] = routeRecipe(links, cards);
  expect(routes).toHaveLength(links.length);
  expect(new Set(routes.slice(0, 20).map(({ target }) => [target.x, target.y].join(","))).size).toBe(20);
  expectClean(routes, cards);
});

it.each<[number, number, RouteSide, RouteSide]>([
  [230, 30, "right", "left"],
  [60, 200, "bottom", "top"],
  [-240, -40, "left", "right"],
  [-30, -210, "top", "bottom"],
])("uses the facing sides from (%s, %s) and routes both endpoints anew", (x, y, source, target) => {
  const cards: RouteCard[] = [card("a", 0, 0), card("b", x, y)];
  const routes: RecipeRoute[] = routeRecipe([{ from: "a", to: "b" }], cards);
  expect(routes[0]).toMatchObject({ source: { side: source }, target: { side: target } });
  expectClean(routes, cards);
});

it("uses a straight route where possible and moves the port along the facing side when the card moves", () => {
  const links: RouteLink[] = [{ from: "a", to: "b" }];
  const straight: RecipeRoute = routeRecipe(links, [card("a", 0, 0), card("b", 200, 0)])[0]!;
  const moved: RecipeRoute = routeRecipe(links, [card("a", 0, 0), card("b", 200, 80)])[0]!;
  expect(straight.points).toHaveLength(2);
  expect(moved.points).toHaveLength(2);
  expect(moved.source.y).toBeGreaterThan(straight.source.y);
  expect(moved.source.side).toBe("right");
});
