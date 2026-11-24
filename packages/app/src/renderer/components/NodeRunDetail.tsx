import { useEffect, useState } from "react";
import type { Artifact, AttemptView, JobDetail, NodeRunView } from "@pecore/schemas";
import { useConnected } from "../api/live";
import { artifactKey, ArtifactView, latestFindings } from "./ArtifactView";
import { DefinitionIcon, useDefinitionIcons } from "./DefinitionIcon";
import { LogView } from "./LogView";
import { duration, ui } from "./ui";
import { Button } from "../ds/button";
import { Details } from "../ds/data";
import { Card, EmptyState } from "../ds/feedback";
import { reasonLabel } from "./states";

const pageSize: number = 25;

function Pages({ page, count, onChange }: { page: number; count: number; onChange(page: number): void }) {
  const connected: boolean = useConnected();
  if (count <= pageSize) return null;
  return (
    <div className={ui.row}>
      <Button disabled={!connected || page === 0} onClick={() => onChange(page - 1)}>Previous</Button>
      <Button disabled={!connected || (page + 1) * pageSize >= count} onClick={() => onChange(page + 1)}>Show more</Button>
    </div>
  );
}

export function NodeRunDetail({ detail, run, nodeName, icon, onSelect }: {
  detail: JobDetail; run: NodeRunView; nodeName: string; icon?: string; onSelect(id: string): void;
}) {
  const connected: boolean = useConnected();
  const icons = useDefinitionIcons();
  const [selected, setSelected] = useState<string | null>(null);
  const [attemptPage, setAttemptPage] = useState<number>(0);
  const [runPage, setRunPage] = useState<number>(0);
  const [artifactPage, setArtifactPage] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now);
  useEffect(() => {
    if (run.endedAt !== null || run.startedAt === null) return;
    const timer: ReturnType<typeof setInterval> = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.startedAt, run.endedAt]);
  const attempts: AttemptView[] = detail.attempts.filter((attempt) => attempt.nodeRunId === run.id);
  const latest: AttemptView | undefined = attempts.at(-1);
  const newest: AttemptView[] = attempts.toReversed();
  const index: number = detail.nodeRuns.findIndex((entry) => entry.id === run.id);
  const earlier: NodeRunView[] = detail.nodeRuns.slice(0, index).filter((entry) => entry.node === run.node).toReversed();
  const artifactRun: string | undefined = run.id.split("/")[1]?.replace("#", "-");
  const artifacts: Artifact[] = detail.artifacts.filter((artifact) => artifact.run === artifactRun);
  const artifact: Artifact | undefined = artifacts.find((entry) => artifactKey(entry) === selected);
  const risk: Artifact | undefined = artifact?.type === "diff" ? latestFindings(detail.artifacts, artifact.contentState) : undefined;
  return (
    <Card padded>
      <section className={ui.stack} aria-label="Node run detail">
        <h2 className={`${ui.title} ${ui.row}`}><DefinitionIcon icons={icons.data} type="node" name={nodeName} selected={icon} /> {run.node} · Round {run.round}</h2>
        <Details>
          <dt>Duration</dt><dd>{run.startedAt === null ? "—" : duration((run.endedAt ?? now) - run.startedAt)}</dd>
          <dt>State</dt><dd>{run.state}</dd>
          {run.outcome && <><dt>Outcome</dt><dd>{run.outcome}</dd></>}
          {run.failureReason && <><dt>Failure</dt><dd>{run.failureReason}</dd></>}
          {run.waitingReason && <><dt>Waiting</dt><dd>{reasonLabel(run.waitingReason, run.resetAt)}</dd></>}
        </Details>
        {!!earlier.length && (
          <section>
            <h3>Earlier runs</h3>
            <div className={ui.row}>
              {earlier.slice(runPage * pageSize, (runPage + 1) * pageSize).map((entry) => (
                <Button key={entry.id} disabled={!connected} onClick={() => onSelect(entry.id)}>Round {entry.round} · {entry.outcome ?? entry.state}</Button>
              ))}
            </div>
            <Pages page={runPage} count={earlier.length} onChange={setRunPage} />
          </section>
        )}
        <section>
          <h3>Attempts</h3>
          {newest.length === 0 ? <EmptyState title="No attempts for this run." /> : newest.slice(attemptPage * pageSize, (attemptPage + 1) * pageSize).map((attempt, index) => (
            <section key={attempt.id}>
              <strong>Attempt {attempts.length - attemptPage * pageSize - index}</strong>
              <Details>
                <dt>Profile</dt><dd>{attempt.profile ?? "—"}</dd>
                <dt>Model</dt><dd>{attempt.model ?? "—"}</dd>
                <dt>Tokens</dt><dd>{attempt.tokens.input.toLocaleString()} in · {attempt.tokens.output.toLocaleString()} out · {attempt.tokens.cacheRead.toLocaleString()} cache read · {attempt.tokens.cacheWrite.toLocaleString()} cache write</dd>
                <dt>Cost</dt><dd>{attempt.cost === null ? "—" : `$${attempt.cost.toLocaleString(undefined, { maximumFractionDigits: 6 })}`}</dd>
                <dt>End reason</dt><dd>{attempt.endReason ?? "—"}</dd>
              </Details>
            </section>
          ))}
          <Pages page={attemptPage} count={attempts.length} onChange={setAttemptPage} />
        </section>
        {!!artifacts.length && (
          <section>
            <h3>Artifacts</h3>
            <div className={ui.row}>
              {artifacts.slice(artifactPage * pageSize, (artifactPage + 1) * pageSize).map((entry) => {
                const key: string = artifactKey(entry);
                return <Button key={key} disabled={!connected} aria-pressed={key === selected} onClick={() => setSelected(key === selected ? null : key)}>{entry.type}</Button>;
              })}
            </div>
            <Pages page={artifactPage} count={artifacts.length} onChange={setArtifactPage} />
            {artifact && <ArtifactView key={artifactKey(artifact)} artifact={artifact} findings={risk} />}
          </section>
        )}
        {latest && <LogView key={latest.id} attemptId={latest.id} running={run.state === "running" && latest.endedAt === null} />}
      </section>
    </Card>
  );
}
