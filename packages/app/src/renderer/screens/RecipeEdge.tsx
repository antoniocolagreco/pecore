import { BaseEdge } from "@xyflow/react";
import type { Edge, EdgeProps, XYPosition } from "@xyflow/react";
import type { RecipeRoute } from "./recipeRouting";

export type RoutedRecipeEdge = Edge<{ outcome: string; route: RecipeRoute }, "routed">;

function centre(points: XYPosition[]): XYPosition {
  let start: XYPosition = points[0]!;
  let end: XYPosition = points[1]!;
  let longest: number = 0;
  for (let index: number = 1; index < points.length; index++) {
    const a: XYPosition = points[index - 1]!;
    const b: XYPosition = points[index]!;
    const length: number = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length <= longest) continue;
    longest = length;
    start = a;
    end = b;
  }
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

export function RecipeEdge({ id, label, markerEnd, style, data, interactionWidth }: EdgeProps<RoutedRecipeEdge>) {
  if (!data) return null;
  const { points } = data.route;
  const path: string = points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x},${y}`).join(" ");
  const { x, y }: XYPosition = centre(points);
  return <BaseEdge id={id} path={path} label={label} labelX={x} labelY={y} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />;
}
