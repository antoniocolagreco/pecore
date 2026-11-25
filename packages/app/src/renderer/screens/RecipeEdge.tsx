import { BaseEdge } from "@xyflow/react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { memo, useId } from "react";
import { arrowheadLength, arrowheadWidth } from "./recipeRouteGeometry";
import type { RecipeRoute } from "./recipeRouting";

export type RoutedRecipeEdge = Edge<{ outcome: string; route: RecipeRoute }, "routed">;

export const RecipeEdge = memo(function RecipeEdge({ id, label, style, data, interactionWidth }: EdgeProps<RoutedRecipeEdge>) {
  const marker: string = useId();
  if (!data) return null;
  const { points, label: box } = data.route;
  const path: string = points.map(({ x, y }, index) => `${index ? "L" : "M"} ${x},${y}`).join(" ");
  return <>
    <defs><marker id={marker} markerUnits="userSpaceOnUse" markerWidth={arrowheadLength} markerHeight={arrowheadWidth}
      refX={arrowheadLength} refY={arrowheadWidth / 2} orient="auto">
      <path d={`M 0,0 L ${arrowheadLength},${arrowheadWidth / 2} L 0,${arrowheadWidth} Z`} fill={style?.stroke} />
    </marker></defs>
    <BaseEdge id={id} path={path} markerEnd={`url(#${marker})`} style={style} interactionWidth={interactionWidth} />
    {box && <g className="react-flow__edge-textwrapper">
      {box.leader && <line x1={box.leader[0].x} y1={box.leader[0].y} x2={box.leader[1].x} y2={box.leader[1].y}
        stroke={style?.stroke} strokeWidth={1.5} strokeDasharray="3 3" />}
      <rect className="react-flow__edge-textbg" x={box.x} y={box.y} width={box.width} height={box.height} rx={4} />
      <text className="react-flow__edge-text" textAnchor="middle" dominantBaseline="central"
        x={box.x + box.width / 2} y={box.y + box.height / 2}>{label}</text>
    </g>}
  </>;
}, (before, after) => before.data?.route === after.data?.route && before.label === after.label
  && before.style?.stroke === after.style?.stroke && before.interactionWidth === after.interactionWidth);
