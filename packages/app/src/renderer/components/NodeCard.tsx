import type { Node } from "@pecore/schemas";
import type { ReactNode } from "react";
import { Badge, Card } from "../ds/feedback";
import s from "./NodeCard.module.css";

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

export function NodeCard({ icon, title, kind }: { icon: ReactNode; title: string; kind: RecipeNodeKind | "source" | undefined }) {
  return <Card className={[s.card, kind && s[kind]].filter(Boolean).join(" ")}>
    <span className={s.glyph}>{icon}</span>
    <strong title={title}><span>{title}</span></strong>
    {kind && <div className={s.kind}>{kind === "source" ? <Badge tone="success" dot>Source</Badge> : <RecipeNodeKindBadge kind={kind} />}</div>}
  </Card>;
}

export function BoundaryCard({ boundary }: { boundary: "start" | "end" }) {
  return <Card className={`${s.boundary} ${s[boundary]}`}>
    <strong>{boundary === "start" ? "Start" : "End"}</strong>
  </Card>;
}
