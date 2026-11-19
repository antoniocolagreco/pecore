import { useEffect, useState } from "react";
import type { JobView } from "@pecore/schemas";
import { useNavigate, useSearchParams } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { isFinal, JobControls } from "../components/JobControls";
import { jobState, needsYou, reasonLabel, StateLabel } from "../components/states";
import { Button, dateTime, duration, Empty, ErrorText, Page, ui } from "../components/ui";
import { Card } from "../ds/feedback";
import { SearchField } from "../ds/field";
import { ChevronDownIcon } from "../ds/icons";
import { Select } from "../ds/select";
import { Segmented } from "../ds/values";
import { useProjectFilter } from "../shell/filter";
import s from "./Jobs.module.css";

const labels: string[] = ["Working", "Needs you", "Waiting", "Queued", "Paused", "Success", "Not delivered", "Failed", "Stopped"];
const pageSize: number = 30;
type ArchiveFilter = "false" | "true" | "all";
type JobRow = { job: JobView; depth: number; hasChildren: boolean };

export function useJobs(archived: ArchiveFilter) {
  const { project } = useProjectFilter();
  return useData(
    () => call("listJobs", { query: { project: project ?? undefined, archived: archived === "all" ? undefined : archived } }),
    [archived, project],
    (m) => m.type === "project.updated" || (m.type === "job.updated" && (!project || m.projectId === project)),
  );
}

function treeRows(jobs: JobView[], collapsed: ReadonlySet<string>): JobRow[] {
  const sorted: JobView[] = [...jobs].sort((a, b) => b.updatedAt - a.updatedAt);
  const ids = new Set<string>(sorted.map((job) => job.id));
  const children = new Map<string | null, JobView[]>();
  for (const job of sorted) {
    const parent: string | null = job.parentJobId && ids.has(job.parentJobId) ? job.parentJobId : null;
    const siblings: JobView[] = children.get(parent) ?? [];
    siblings.push(job);
    children.set(parent, siblings);
  }
  const rows: JobRow[] = [];
  const pending: { job: JobView; depth: number }[] = (children.get(null) ?? []).toReversed().map((job) => ({ job, depth: 0 }));
  while (pending.length > 0) {
    const entry = pending.pop()!;
    const nested: JobView[] = children.get(entry.job.id) ?? [];
    rows.push({ ...entry, hasChildren: nested.length > 0 });
    if (!collapsed.has(entry.job.id)) {
      for (const job of nested.toReversed()) pending.push({ job, depth: entry.depth + 1 });
    }
  }
  return rows;
}

function Row({ row, factory, collapsed, toggle, now }: { row: JobRow; factory: boolean; collapsed: boolean; toggle(): void; now: number }) {
  const { job, depth, hasChildren } = row;
  const connected: boolean = useConnected();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const detail = useData(
    () => call("getJob", { params: { id: job.id } }),
    [job.id],
    (m) => (m.type === "node_run.updated" || m.type === "job.updated") && m.jobId === job.id,
  );
  const runs = detail.data?.nodeRuns;
  const current = runs?.findLast((run) => run.state === "running" || run.state === "waiting" || run.state === "pending") ?? runs?.at(-1);
  const last = runs?.findLast((run) => run.outcome !== null);
  const info = jobState(job);
  const open = useAction(async () => {
    let to: string = `/jobs/${encodeURIComponent(job.id)}`;
    if (factory && needsYou(job)) {
      if (job.waitingReason === "auth") {
        const section: string = current?.auth?.kind === "harness" && current.auth.osUser === "pecore-agent" ? "protectedMode" : "accounts";
        to = `/settings?section=${section}`;
      }
      else if (job.waitingReason === "parent_failed" && job.parentJobId) to = `/jobs/${encodeURIComponent(job.parentJobId)}`;
      else {
        const { reasons } = await call("whyJob", { params: { id: job.id } });
        const item: string | null | undefined = reasons.find((reason) => reason.queueItemId)?.queueItemId;
        if (item) to = `/inbox/${encodeURIComponent(item)}`;
      }
    }
    await navigate(to);
  });
  const openRow = () => { if (connected && !open.busy) void open.run(); };
  return (
    <tr className={connected ? s.clickable : undefined} onClick={openRow}>
      <td style={{ paddingInlineStart: 8 + depth * 16 }}>
        {!factory && hasChildren && (
          <button type="button" className={s.disclosure} aria-label={collapsed ? "Expand stacked jobs" : "Collapse stacked jobs"} aria-expanded={!collapsed} disabled={!connected} onClick={(event) => { event.stopPropagation(); toggle(); }}>
            {collapsed ? <ChevronDownIcon size={13} style={{ rotate: "-90deg" }} /> : <ChevronDownIcon size={13} />}
          </button>
        )}
        <button type="button" className={s.titleLink} disabled={!connected || open.busy} onClick={(event) => { event.stopPropagation(); openRow(); }}>{job.title}</button>
        <ErrorText error={open.error ?? detail.error} />
      </td>
      <td>{job.projectId}</td>
      <td><StateLabel info={{ ...info, detail: job.state === "paused" ? info.detail : null }} /></td>
      <td>{isFinal(job) ? job.failureReason ?? (job.state === "stopped" ? null : last?.outcome) ?? "—" : current?.node ?? (detail.loading ? "…" : "—")}</td>
      <td>{job.state !== "paused" ? reasonLabel(job.waitingReason, current?.state === "waiting" ? current.resetAt : null) ?? "—" : "—"}</td>
      {!factory && <><td>{duration((isFinal(job) ? job.updatedAt : now) - job.createdAt)}</td><td>{dateTime(job.updatedAt)}</td></>}
      <td><JobControls job={job} compact /></td>
    </tr>
  );
}

export function JobTable({ jobs, factory = false, loading }: { jobs: JobView[]; factory?: boolean; loading: boolean }) {
  const connected: boolean = useConnected();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [page, setPage] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now);
  useEffect(() => {
    if (factory) return;
    const timer: ReturnType<typeof setInterval> = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [factory]);
  const rows: JobRow[] = treeRows(jobs, collapsed);
  const currentPage: number = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const headings: string[] = ["Title", "Project", "State", factory ? "Node" : "Node or outcome", "Waiting reason", ...(factory ? [] : ["Duration", "Updated"]), "Actions"];
  return (
    <Card padded={false} className={s.card}>
      <div className={s.tableWrap}>
        <table className={ui.table}>
          <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>
            {rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row) => (
              <Row key={row.job.id} row={row} factory={factory} now={now} collapsed={collapsed.has(row.job.id)} toggle={() => {
                const next = new Set<string>(collapsed);
                if (next.has(row.job.id)) next.delete(row.job.id);
                else next.add(row.job.id);
                setCollapsed(next);
              }} />
            ))}
            {rows.length === 0 && loading && [0, 1, 2].map((index) => (
              <tr key={index} aria-hidden="true">{headings.map((heading) => <td key={heading}><span className={s.placeholder} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (loading ? <span role="status" className={s.visuallyHidden}>Loading jobs…</span> : <Empty>{factory ? "No active jobs." : "No jobs match these filters."}</Empty>)}
      {rows.length > pageSize && (
        <div className={s.pagination}>
          <Button disabled={!connected || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button disabled={!connected || (currentPage + 1) * pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>Show more</Button>
        </div>
      )}
    </Card>
  );
}

export function Jobs() {
  const connected: boolean = useConnected();
  const { project } = useProjectFilter();
  const [query, setQuery] = useSearchParams();
  const label: string = query.get("label") ?? "";
  const [archived, setArchived] = useState<ArchiveFilter>("false");
  const [search, setSearch] = useState<string>("");
  const jobs = useJobs(archived);
  const visible: JobView[] = (jobs.data ?? []).filter((job) => (!project || job.projectId === project) &&
    (archived === "all" || job.archived === (archived === "true")) &&
    (!label || jobState(job).label === label) && job.title.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Page title="Jobs">
      <div className={s.filters}>
        <SearchField className={s.search} placeholder="Search job titles" value={search} disabled={!connected} onValueChange={setSearch} />
        <Select
          className={s.stateFilter}
          ariaLabel="State"
          disabled={!connected}
          value={label || "all"}
          onValueChange={(value) => {
            const next = new URLSearchParams(query);
            if (value && value !== "all") next.set("label", value);
            else next.delete("label");
            void setQuery(next, { replace: true });
          }}
          options={[{ value: "all", label: "All states" }, ...labels.map((item) => ({ value: item, label: item }))]}
        />
        <Segmented
          label="Archived"
          value={archived}
          onValueChange={(value) => setArchived(value as ArchiveFilter)}
          options={[{ value: "false", label: "Active" }, { value: "true", label: "Archived" }, { value: "all", label: "All" }]}
        />
      </div>
      <ErrorText error={jobs.error} />
      <JobTable key={JSON.stringify([project, label, archived, search])} jobs={visible} loading={jobs.loading} />
    </Page>
  );
}
