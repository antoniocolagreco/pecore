import type { Node } from "@pecore/schemas";
import { Badge } from "../ds/feedback";
import s from "./Editors.module.css";

export type RecipeNodeKind = "agent" | "command" | "human";

export const nodeKindLabels: Record<Node["kind"], string> = { agent: "Agent", command: "Run command", human: "Human", source: "Source" };

export function recipeNodeKind(kind: unknown): RecipeNodeKind | undefined {
  if (kind === "agent" || kind === "command" || kind === "human") return kind;
  if (kind === "human-decision" || kind === "human-review") return "human";
  return undefined;
}

export function RecipeNodeKindBadge({ kind }: { kind: RecipeNodeKind }) {
  return <span className={`${s.kindBadge} ${s[kind]}`}><Badge dot>{nodeKindLabels[kind]}</Badge></span>;
}
