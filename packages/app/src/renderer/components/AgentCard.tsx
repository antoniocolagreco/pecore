import { BuiltInHarness } from "@pecore/schemas";
import type { ModelAccount, NodeAgent } from "@pecore/schemas";
import { Link } from "react-router";
import { Badge, Card } from "../ds/feedback";
import { ArrowRightIcon, SparkIcon } from "../ds/icons";
import { install } from "../shell/SetupBanner";
import s from "./AgentCard.module.css";

export function AgentCard({ agent, account, to }: { agent: NodeAgent; account?: ModelAccount; to?: string }) {
  const builtIn: BuiltInHarness | undefined = BuiltInHarness.safeParse(account?.connector).data;
  const harness: string = builtIn ? install[builtIn].name : account?.connector ?? "No harness";
  const contents = <Card className={s.card}>
    <header className={s.header}>
      <h2>{agent.name}</h2>
      {to && <ArrowRightIcon />}
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
    ? <Link className={s.entry} data-harness={builtIn} to={to} aria-label={agent.name}>{contents}</Link>
    : <div className={s.entry} data-harness={builtIn}>{contents}</div>;
}
