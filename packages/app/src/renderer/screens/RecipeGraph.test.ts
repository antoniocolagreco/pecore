import type { InternalNode, XYPosition } from "@xyflow/react";
import { expect, it } from "vitest";
import { recipePath } from "./RecipeEdge";
import { routeRecipeEdges } from "./RecipeGraph";
import type { RecipeGraphLink } from "./RecipeGraph";
import { recipeEnd } from "./recipeLayout";
import type { RecipeLayout } from "./recipeLayout";

function card(id: string, position: XYPosition): InternalNode {
  const node = { id, position, data: {}, width: 120, height: 120 };
  return { ...node, measured: { width: 120, height: 120 }, internals: { positionAbsolute: position, z: 0, userNode: node } };
}

it("routes a failure from the bottom even when it was dragged from the right", () => {
  const layout: RecipeLayout = { ticket: { x: 0, y: 0 }, spec: { x: 272, y: 0 }, [recipeEnd]: { x: 544, y: 0 } };
  const links: RecipeGraphLink[] = [
    { from: "ticket", to: "spec", on: "success", sourcePort: "right", failed: false, invalid: false },
    { from: "ticket", to: recipeEnd, on: "failure", sourcePort: "right", failed: true, invalid: false },
  ];
  const [success, failure] = routeRecipeEdges(links, layout);
  expect(success?.data?.sourcePort).toBe("right");
  expect(failure?.data).toMatchObject({ sourcePort: "bottom", targetPort: "bottom", terminalLane: { side: "bottom" } });
  const ticket: InternalNode = card("ticket", { x: 0, y: 0 });
  const rebase: InternalNode = card("rebase", { x: 272, y: 176 });
  const end: InternalNode = card(recipeEnd, { x: 544, y: 0 });
  const [path, , labelY] = recipePath(ticket, end, failure!.data!, [], [ticket, rebase, end]);
  expect(path).toMatch(/^M ([\d.]+),123 L \1,[\d.]+ Q \1,/);
  expect(labelY).toBeGreaterThan(296);
});

it("keeps failure retries on lower lanes and preserves a chosen arrival side", () => {
  const layout: RecipeLayout = { code: { x: 0, y: 0 }, lint: { x: 272, y: 0 } };
  const links: RecipeGraphLink[] = [
    { from: "lint", to: "code", on: "failure", sourcePort: "right", targetPort: "left", failed: true, invalid: false },
    { from: "lint", to: "code", on: "stale", failed: true, invalid: false },
  ];
  const [first, second] = routeRecipeEdges(links, layout);
  expect(first?.data).toMatchObject({ sourcePort: "bottom", targetPort: "left", terminalLane: { side: "bottom", offset: 44 } });
  expect(second?.data).toMatchObject({ sourcePort: "bottom", targetPort: "bottom", terminalLane: { side: "bottom", offset: 74 } });
});
