import { agentKindColor, builtInAgentNames, defaultAgentId } from "@pecore/schemas";
import type { Node, NodeAgent } from "@pecore/schemas";
import type { CSSProperties, ReactNode } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { Badge, Card } from "../ds/feedback";
import s from "./NodeCard.module.css";

export type RecipeNodeKind = "agent" | "command" | "human" | "tracker" | "repository";

export const nodeKindLabels: Record<Node["kind"], string> = { agent: "Agent", command: "Command", human: "Human", tracker: "Tracker", repository: "Repository" };

export function recipeNodeKind(kind: unknown): RecipeNodeKind | undefined {
  if (kind === "agent" || kind === "command" || kind === "human" || kind === "tracker" || kind === "repository") return kind;
  if (kind === "human-decision" || kind === "human-review") return "human";
  return undefined;
}

export type NodeAgentBadge = Pick<NodeAgent, "name" | "color">;

export function useNodeAgents(): NodeAgent[] | undefined {
  const catalog = useData(() => call("getAgents"), [], (event) => event.type === "configuration.changed" && event.kind === "agents");
  return catalog.data?.value.agents;
}

export function useDefaultNodeAgent(): NodeAgentBadge | undefined {
  return useNodeAgents()?.find(({ id }) => id === defaultAgentId);
}

export function RecipeNodeKindBadge({ kind, agent }: { kind: RecipeNodeKind; agent?: NodeAgentBadge }) {
  const label: string = kind === "agent" ? (agent?.name ?? builtInAgentNames.get(defaultAgentId)!) : nodeKindLabels[kind];
  const style: CSSProperties | undefined = kind === "agent" && agent && agent.color !== agentKindColor
    ? { "--recipe-node-kind": agent.color } as CSSProperties : undefined;
  return <span className={`${s.kindBadge} ${s[kind]}`} style={style} title={label}><Badge><span className={s.badgeLabel}>{label}</span></Badge></span>;
}

export function NodeCard({ icon, title, kind, badge, agent }: { icon: ReactNode; title: string; kind?: RecipeNodeKind; badge?: ReactNode; agent?: NodeAgentBadge }) {
  return <Card className={[s.card, kind && s[kind]].filter(Boolean).join(" ")}>
    <span className={s.glyph}>{icon}</span>
    <strong title={title}><span>{title}</span></strong>
    {(badge || kind) && <div className={s.kind}>{badge ?? (kind && <RecipeNodeKindBadge kind={kind} agent={agent} />)}</div>}
  </Card>;
}

export function BoundaryCard({ boundary }: { boundary: "start" | "end" }) {
  return <Card className={`${s.boundary} ${s[boundary]}`}>
    <strong>{boundary === "start" ? "Start" : "End"}</strong>
  </Card>;
}
