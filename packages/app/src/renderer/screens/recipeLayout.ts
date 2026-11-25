import type { XYPosition } from "@xyflow/react";
import { recipeStart } from "@pecore/schemas";
import type { Edge } from "@pecore/schemas";

export type RecipeLayout = Record<string, XYPosition>;
export type RecipeLink = Edge;

export const recipeGrid: [number, number] = [272, 176];
export { recipeStart };
export const recipeEnd: string = "@end";

export function withRecipeBoundaries(layout: RecipeLayout, start: string): RecipeLayout {
  const steps: XYPosition[] = Object.values(layout);
  const first: number = Math.min(0, ...steps.map(({ x }) => x));
  const last: number = Math.max(first, ...steps.map(({ x }) => x));
  return {
    ...layout,
    [recipeStart]: { x: first - recipeGrid[0], y: layout[start]?.y ?? 0 },
    [recipeEnd]: { x: steps.length ? last + recipeGrid[0] : first, y: 0 },
  };
}

export function snapRecipePosition(point: XYPosition): XYPosition {
  return {
    x: Math.round(point.x / recipeGrid[0]) * recipeGrid[0],
    y: Math.round(point.y / recipeGrid[1]) * recipeGrid[1],
  };
}

export function samePosition(first: XYPosition, second: XYPosition): boolean {
  return first.x === second.x && first.y === second.y;
}

export function slotTaken(layout: RecipeLayout, point: XYPosition, except?: string): boolean {
  return Object.entries(layout).some(([id, position]) => id !== except && samePosition(point, position));
}

export function freeRecipeSlot(layout: RecipeLayout, preferred: XYPosition): XYPosition {
  const point: XYPosition = { ...preferred };
  while (slotTaken(layout, point)) point.y += recipeGrid[1];
  return point;
}

export function arrangeRecipe(
  ids: string[],
  edges: RecipeLink[],
  start: string,
  onBaseChanged: string,
): RecipeLayout {
  const outgoing = new Map<string, RecipeLink[]>(ids.map((id) => [id, []]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge);
  for (const links of outgoing.values()) {
    links.sort((first, second) => Number(first.maxRounds !== undefined) - Number(second.maxRounds !== undefined));
  }
  const visited = new Set<string>();
  const rankedEdges = new Set<RecipeLink>();
  const layout: RecipeLayout = Object.create(null);

  for (const root of [start, onBaseChanged, ...ids]) {
    if (!outgoing.has(root) || visited.has(root)) continue;
    const active = new Set<string>();
    const order: string[] = [];
    const levels = new Map<string, number>();
    const firstRow: number = Object.keys(layout).length ? Math.max(...Object.values(layout).map(({ y }) => y)) + recipeGrid[1] : 0;
    let entryColumn: number | undefined;

    function visit(id: string): void {
      if (visited.has(id)) return;
      visited.add(id);
      active.add(id);
      for (const edge of outgoing.get(id) ?? []) {
        if (active.has(edge.to) || !outgoing.has(edge.to)) continue;
        if (Object.hasOwn(layout, edge.to)) {
          const targetColumn: number = layout[edge.to]!.x / recipeGrid[0];
          const column: number = root === onBaseChanged ? targetColumn : Math.max(0, targetColumn - 1);
          entryColumn = Math.min(entryColumn ?? column, column);
          continue;
        }
        rankedEdges.add(edge);
        visit(edge.to);
      }
      active.delete(id);
      order.push(id);
    }

    visit(root);
    for (const id of order.reverse()) {
      const level: number = levels.get(id) ?? 0;
      layout[id] = freeRecipeSlot(layout, { x: ((entryColumn ?? 0) + level) * recipeGrid[0], y: firstRow });
      for (const edge of outgoing.get(id) ?? []) {
        if (rankedEdges.has(edge)) levels.set(edge.to, Math.max(level + 1, levels.get(edge.to) ?? 0));
      }
    }
  }
  return layout;
}

export function recipeLayout(automatic: RecipeLayout, saved: RecipeLayout): RecipeLayout {
  const layout: RecipeLayout = Object.create(null);
  for (const id of Object.keys(automatic)) {
    if (!Object.hasOwn(saved, id)) continue;
    const point: XYPosition | undefined = saved[id];
    if (point) {
      const slot: XYPosition = snapRecipePosition(point);
      if (!slotTaken(layout, slot)) layout[id] = slot;
    }
  }
  for (const [id, point] of Object.entries(automatic)) {
    if (!Object.hasOwn(layout, id)) layout[id] = freeRecipeSlot(layout, point);
  }
  return layout;
}
