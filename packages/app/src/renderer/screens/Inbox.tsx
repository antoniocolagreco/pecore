import { useState } from "react";
import { Link, useParams } from "react-router";
import type { QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem, queueKindLabel } from "../components/ConfirmItem";
import { Button, Empty, ErrorText, Field, Page, Panel, duration, ui } from "../components/ui";
import s from "./Inbox.module.css";

const pageSize: number = 100;

export function Inbox() {
  const { id } = useParams();
  const connected: boolean = useConnected();
  const [project, setProject] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const queue = useData(() => call("listQueue", { query: { state: "open" } }), [], (m) => m.type === "queue.updated");
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated" || m.type === "definition.changed");
  const jobs = useData(() => call("listJobs", { query: {} }), [], (m) => m.type === "job.updated" || m.type === "project.updated");
  const names: Map<string, string> = new Map(projects.data?.map((entry) => [entry.id, entry.project?.name ?? entry.id]));
  const titles: Map<string, string> = new Map(jobs.data?.map((job) => [job.id, job.title]));
  const items: QueueItemView[] = (queue.data ?? []).filter((item) => item.kind !== "agent-question" && (!project || item.projectId === project))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const currentPage: number = Math.min(page, Math.max(0, Math.ceil(items.length / pageSize) - 1));
  const start: number = currentPage * pageSize;

  return (
    <Page title="Inbox" actions={
      <Field label="Inbox project">
        <select value={project} disabled={!connected} onChange={(e) => { setProject(e.target.value); setPage(0); }}>
          <option value="">All projects</option>
          {[...names].map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        </select>
      </Field>
    }>
      <ErrorText error={queue.error ?? projects.error ?? jobs.error} />
      <div className={id ? s.split : undefined}>
        <Panel>
          <div className={s.table}>
            <table className={ui.table}>
              <thead><tr><th>Kind</th><th>Project</th><th>Job</th><th>Age</th></tr></thead>
              <tbody>
                {queue.loading && !queue.data && <tr><td colSpan={4} className={ui.muted}>Loading…</td></tr>}
                {items.slice(start, start + pageSize).map((item) => (
                  <tr key={item.id} className={item.id === id ? s.selected : undefined}>
                    <td>{connected ? <Link to={`/inbox/${item.id}`} aria-current={item.id === id ? "page" : undefined}>{queueKindLabel[item.kind]}</Link> : queueKindLabel[item.kind]}</td>
                    <td>{names.get(item.projectId) ?? item.projectId}</td>
                    <td>{item.jobId ? titles.get(item.jobId) ?? (item.jobId === "project-setup" ? "Project setup" : item.jobId) : "—"}</td>
                    <td>{duration(Date.now() - item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!queue.loading && !queue.error && items.length === 0 && <Empty>Inbox empty: nothing waits for you</Empty>}
          {items.length > pageSize && (
            <div className={s.pagination}>
              <Button disabled={!connected || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <Button disabled={!connected || start + pageSize >= items.length} onClick={() => setPage(currentPage + 1)}>Show more</Button>
            </div>
          )}
        </Panel>
        {id && <Panel className={s.detail}><ConfirmItem itemId={id} onDone={queue.reload} /></Panel>}
      </div>
    </Page>
  );
}
