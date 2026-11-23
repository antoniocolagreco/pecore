import { Badge } from "../ds/feedback";
import s from "./Editors.module.css";

export type RecipeNodeKind = "agent" | "command" | "human";

const labels: Record<RecipeNodeKind, string> = { agent: "Agent", command: "Command", human: "Human" };

export function recipeNodeKind(kind: unknown): RecipeNodeKind | undefined {
  if (kind === "agent" || kind === "command") return kind;
  if (kind === "human-decision" || kind === "human-review") return "human";
  return undefined;
}

export function RecipeNodeKindBadge({ kind }: { kind: RecipeNodeKind }) {
  return <span className={`${s.kindBadge} ${s[kind]}`}><Badge dot>{labels[kind]}</Badge></span>;
}
