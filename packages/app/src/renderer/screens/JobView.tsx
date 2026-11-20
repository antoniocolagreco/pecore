import { ApiError, FindingsArtifact } from "@pecore/schemas";
import type { Artifact, AttemptView, JobDetail, JobView as Job, NodeRunView, WhyReason } from "@pecore/schemas";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ArtifactView, Delivery, diffFiles, Findings, readArtifact } from "../components/ArtifactView";
import { isFinal, JobControls } from "../components/JobControls";
import { JobGraph, latestRuns, useRecipe } from "../components/JobGraph";
import { NodeRunDetail } from "../components/NodeRunDetail";
import { jobState, StateLabel } from "../components/states";
import { Button, duration, Empty, ErrorText, Page, Panel, time, ui } from "../components/ui";
import { Tabs } from "../ds/data";
import { Alert, Badge, Card, Spinner } from "../ds/feedback";
import { ArrowRightIcon, FolderIcon } from "../ds/icons";
import s from "./JobView.module.css";

type Tab = "graph" | "history" | "ticket";
type HistoryEntry = { run: NodeRunView; attempt: AttemptView | null; index: number };
const historyPageSize: number = 40;

function reasonTarget(reason: WhyReason, detail: JobDetail): string | null {
  if (reason.queueItemId) return `/notifications/${encodeURIComponent(reason.queueItemId)}`;
  if (reason.account || reason.reason === "auth") {
    const waitingRun: NodeRunView | undefined = detail.nodeRuns.find((run) => run.id === reason.nodeRunId);
    const section: string = waitingRun?.auth?.kind === "harness" && waitingRun.auth.osUser === "pecore-agent" ? "protectedMode" : "accounts";
    const query = new URLSearchParams({ section });
    if (reason.account) query.set("account", reason.account);
    return `/settings?${query}`;
  }
  return reason.jobId ? `/jobs/${encodeURIComponent(reason.jobId)}` : null;
}

function WhyLine({ reason, detail }: { reason: WhyReason; detail: JobDetail }) {
  const connected: boolean = useConnected();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const target: string | null = reasonTarget(reason, detail);
  const text: string = reason.until === null ? reason.text : `${reason.text} until ${time(reason.until)}`;
  return <div>{target ? <button type="button" className={s.link} disabled={!connected} onClick={() => void navigate(target)}>{text}</button> : text}</div>;
}

function Result({ detail, definitions }: { detail: JobDetail; definitions: ReturnType<typeof useRecipe>["data"] }) {
  const connected: boolean = useConnected();
  const [patchOpen, setPatchOpen] = useState<boolean>(false);
  const [fileLimit, setFileLimit] = useState<number>(40);
  const { job, artifacts, nodeRuns } = detail;
  const diff: Artifact | undefined = artifacts.findLast((artifact) => artifact.type === "diff");
  const risk: Artifact | undefined = artifacts.findLast((artifact) => artifact.type === "risk");
  const findings: Artifact | undefined = artifacts.findLast((artifact) => artifact.type === "findings");
  const delivery: Artifact | undefined = artifacts.findLast((artifact) => artifact.type === "delivery");
  const files = useData(async () => diff ? diffFiles((await readArtifact(diff)).content) : null, [diff?.path, diff?.sha256]);
  const report = useData(async () => findings ? FindingsArtifact.parse(JSON.parse((await readArtifact(findings)).content)) : null, [findings?.path, findings?.sha256]);
  const delivered = useData(async () => delivery ? (await readArtifact(delivery)).content : null, [delivery?.path, delivery?.sha256]);
  const last: NodeRunView | undefined = nodeRuns.at(-1);
  const outcome: string | null = job.failureReason ?? (job.state === "stopped" ? null : last?.outcome ?? last?.failureReason ?? null);
  const checks: NodeRunView[] = [...latestRuns(nodeRuns).values()].filter((run) => {
    const use: string | undefined = definitions?.recipe.nodes[run.node]?.use;
    const node = use ? definitions?.definitions.get(use) : undefined;
    return node?.kind === "command" && node.outcomes.includes("passed");
  });
  return (
    <Panel>
      <section className={ui.stack} aria-label="Result">
        <h2 className={s.sectionTitle}>Result</h2>
        <div className={ui.row}><StateLabel info={{ ...jobState(job), detail: null }} />{outcome && <code>{outcome}</code>}</div>
        {diff && (
          <section>
            <h3>Files changed</h3>
            <ErrorText error={files.error} />
            {files.data?.length === 0 && <p>No changed files in the diff.</p>}
            {!!files.data?.length && (
              <>
                <ul>{files.data.slice(0, fileLimit).map((name) => <li key={name}><code>{name}</code></li>)}</ul>
                {files.data.length > fileLimit && <Button disabled={!connected} onClick={() => setFileLimit(fileLimit + 40)}>Show more</Button>}
              </>
            )}
            <Button disabled={!connected} onClick={() => setPatchOpen(!patchOpen)} aria-expanded={patchOpen}>Diff</Button>
            {patchOpen && <ArtifactView artifact={diff} risk={risk} />}
          </section>
        )}
        {!!checks.length && (
          <section><h3>Checks</h3><ul>{checks.map((run) => <li key={run.node}>{run.node} · {run.outcome ?? run.failureReason ?? run.state}</li>)}</ul></section>
        )}
        {findings && <section><h3>Open findings</h3><ErrorText error={report.error} />{report.data && <Findings findings={report.data} />}</section>}
        {delivery && <section><h3>Delivery</h3><ErrorText error={delivered.error} />{delivered.data && <Delivery content={delivered.data} />}</section>}
      </section>
    </Panel>
  );
}

function History({ detail, selected, onSelect }: { detail: JobDetail; selected: string | null; onSelect(id: string): void }) {
  const connected: boolean = useConnected();
  const [page, setPage] = useState<number>(0);
  const attemptsByRun = new Map<string, AttemptView[]>();
  for (const attempt of detail.attempts) {
    const entries: AttemptView[] = attemptsByRun.get(attempt.nodeRunId) ?? [];
    entries.push(attempt);
    attemptsByRun.set(attempt.nodeRunId, entries);
  }
  const entries: HistoryEntry[] = detail.nodeRuns.flatMap<HistoryEntry>((run) => {
    const attempts: AttemptView[] | undefined = attemptsByRun.get(run.id);
    return attempts?.length ? attempts.map((attempt, index) => ({ run, attempt, index })) : [{ run, attempt: null, index: 0 }];
  });
  if (!entries.length) return <Empty>No runs yet.</Empty>;
  const now: number = Date.now();
  return (
    <div>
      <table className={ui.table}>
        <thead><tr><th>Node</th><th>Attempt</th><th>Outcome</th><th>Duration</th><th>Failure reason</th></tr></thead>
        <tbody>{entries.slice(page * historyPageSize, (page + 1) * historyPageSize).map(({ run, attempt, index }) => {
          const start: number | null = attempt?.startedAt ?? run.startedAt;
          const end: number | null = attempt ? attempt.endedAt : run.endedAt;
          return (
            <tr key={attempt?.id ?? run.id}>
              <td><button type="button" className={s.link} disabled={!connected} aria-pressed={run.id === selected} onClick={() => onSelect(run.id)}>{run.node} · Round {run.round}</button></td>
              <td>{attempt ? index + 1 : "—"}</td>
              <td>{run.outcome ?? run.state}{attempt?.endReason && ` · ${attempt.endReason}`}</td>
              <td>{start === null ? "—" : duration((end ?? now) - start)}</td>
              <td>{run.failureReason ?? "—"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {entries.length > historyPageSize && (
        <div className={ui.row}>
          <Button disabled={!connected || page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button disabled={!connected || (page + 1) * historyPageSize >= entries.length} onClick={() => setPage(page + 1)}>Show more</Button>
        </div>
      )}
    </div>
  );
}

function Loaded({ detail, error, reasons, whyError, reload }: { detail: JobDetail; error: Error | null; reasons: WhyReason[]; whyError: Error | null; reload(): void }) {
  const connected: boolean = useConnected();
  const { job, nodeRuns, artifacts } = detail;
  const [tab, setTab] = useState<Tab>("graph");
  const [selection, setSelection] = useState<string | null>(null);
  const firstBase = useRef<string | null>(job.base);
  const firstTarget = useRef<string>(job.target);
  const checked = useRef<boolean>(false);
  const [mergeStatus, setMergeStatus] = useState<string | null>(null);
  useEffect(() => {
    if (firstBase.current === null && job.base !== null) firstBase.current = job.base;
  }, [job.base]);
  const baseChanged: boolean = (firstBase.current !== null && job.base !== null && job.base !== firstBase.current) || job.target !== firstTarget.current ||
    (job.parentJobId === null && job.target !== job.baseBranch);
  const recipe = useRecipe(job);
  const ticket: Artifact | undefined = artifacts.find((artifact) => artifact.type === "ticket");
  const canCheck: boolean = job.mergedAt === null && artifacts.some((artifact) => artifact.type === "delivery");
  const merge = useAction(async (manual: boolean) => {
    setMergeStatus(null);
    const result = await call("checkMerge", { params: { id: job.id } });
    if (manual && !result.merged) setMergeStatus("Merge not detected.");
    reload();
  });
  useEffect(() => {
    if (!connected || !canCheck || checked.current) return;
    checked.current = true;
    void merge.run(false);
  }, [connected, canCheck]);
  const selected: NodeRunView | undefined = selection ? nodeRuns.find((run) => run.id === selection) : undefined;
  const info = jobState(job);
  const graph = (
    <div className={s.graph}>
      {recipe.data
        ? <JobGraph recipe={recipe.data.recipe} definitions={recipe.data.definitions} runs={nodeRuns} selected={selection} onSelect={setSelection} />
        : !recipe.error && <Spinner />}
      <ErrorText error={recipe.error} />
    </div>
  );
  return (
    <Page
      title={job.title}
      actions={<>
        {canCheck && <Button disabled={!connected || merge.busy} onClick={() => void merge.run(true)}>Check merge</Button>}
        <JobControls job={job} />
      </>}
    >
      <div className={s.meta}>
        <StateLabel info={info} />
        <span className={s.metaItem}><FolderIcon />{job.projectId}</span>
        <span className={s.metaItem}><code>{job.branch}</code><ArrowRightIcon size="xs" /><code>{job.target}</code></span>
        {job.mergedAt !== null && <Badge tone="success">Merged</Badge>}
        {mergeStatus && <span role="status" className={ui.muted}>{mergeStatus}</span>}
      </div>
      <ErrorText error={error} />
      <ErrorText error={merge.error} />
      <ErrorText error={whyError} />
      {reasons.length > 0 && (
        <Alert tone="warning" title="Why it is waiting">
          {reasons.map((reason) => <WhyLine key={`${reason.reason}:${reason.nodeRunId ?? ""}`} reason={reason} detail={detail} />)}
        </Alert>
      )}
      {baseChanged && <Alert tone="accent">Base changed to <code>{job.base ?? job.target}</code> on <code>{job.target}</code>.</Alert>}
      {isFinal(job) && <Result detail={detail} definitions={recipe.data} />}
      <div className={selected ? s.split : undefined}>
        <Card padded>
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            tabs={[
              { value: "graph", label: "Graph", content: graph },
              { value: "history", label: "History", content: <History detail={detail} selected={selection} onSelect={setSelection} /> },
              ...(ticket ? [{ value: "ticket", label: "Ticket", content: <ArtifactView artifact={ticket} /> }] : []),
            ]}
          />
        </Card>
        {selected && <NodeRunDetail key={selected.id} detail={detail} run={selected} onSelect={setSelection} />}
      </div>
    </Page>
  );
}

function JobLoader({ id }: { id: Job["id"] }) {
  const detail = useData(() => call("getJob", { params: { id } }), [id], (m) => (m.type === "job.updated" || m.type === "node_run.updated") && m.jobId === id);
  const why = useData(() => call("whyJob", { params: { id } }), [id], (m) => (m.type === "job.updated" || m.type === "node_run.updated") && m.jobId === id);
  if (detail.error instanceof ApiError && detail.error.status === 404) return <Page title="Job"><Empty>Job not found.</Empty></Page>;
  return detail.data
    ? <Loaded detail={detail.data} error={detail.error} whyError={why.error} reasons={why.data?.reasons ?? []} reload={detail.reload} />
    : <Page title="Job"><ErrorText error={detail.error} />{detail.loading && <Empty>Loading job…</Empty>}</Page>;
}

export function JobView() {
  const { id } = useParams();
  return id ? <JobLoader key={id} id={id} /> : <Page title="Job"><Empty>Job not found.</Empty></Page>;
}
