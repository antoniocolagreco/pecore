import { builtInAgentColor, builtInAgentNames, harnesses } from "@pecore/schemas";
import type { ModelAccount, NodeAgent } from "@pecore/schemas";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { Badge, Card } from "../ds/feedback";
import { SparkIcon } from "../ds/icons";
import s from "./AgentCard.module.css";

export function AgentCard({ agent, account, to }: {
  agent: NodeAgent;
  account?: ModelAccount;
  to?: string;
}) {
  const harness: string = harnesses.find(({ id }) => id === account?.connector)?.name ?? account?.connector ?? "No harness";
  const color: string = builtInAgentNames.has(agent.id) && agent.color === builtInAgentColor ? "var(--agent-kind-color)" : agent.color;
  const style: CSSProperties = { "--agent-color": color } as CSSProperties;
  const contents = <Card className={s.card}>
    <header className={s.header}>
      <h2 title={agent.name}>{agent.name}</h2>
    </header>
    <div className={s.art}>
      <div className={s.emblem} aria-hidden="true"><SparkIcon size="md" /></div>
      <span className={s.harness}><Badge dot><span>{harness}</span></Badge></span>
    </div>
    <dl className={s.settings}>
      <dt>Provider</dt><dd>{account?.provider ?? "Not set"}</dd>
      <dt>Model</dt><dd>{agent.model?.model ?? "Not set"}</dd>
      <dt>Effort</dt><dd>{agent.model ? agent.model.effort ?? "Default" : "Not set"}</dd>
    </dl>
    <dl className={s.context}>
      <div><dt>Auto compaction</dt><dd>{agent.compaction.auto / 1024}K tokens</dd></div>
      <div><dt>Maximum context</dt><dd>{agent.compaction.max / 1024}K tokens</dd></div>
    </dl>
  </Card>;

  return to
    ? <Link className={s.entry} style={style} to={to} aria-label={agent.name}>{contents}</Link>
    : <div className={s.entry} style={style}>{contents}</div>;
}
