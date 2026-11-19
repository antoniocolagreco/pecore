import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { needsYou } from "../components/states";
import { Button, Empty, ErrorText, Page, Panel, ui } from "../components/ui";

type JobCounts = { attention: number; failed: number; auth: boolean };

const pageSize: number = 100;

export function Projects() {
  const navigate = useNavigate();
  const connected: boolean = useConnected();
  const [page, setPage] = useState<number>(0);
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated" || m.type === "definition.changed");
  const jobs = useData(() => call("listJobs", { query: { archived: "false" } }), [], (m) => m.type === "job.updated" || m.type === "project.updated");
  const counts: Map<string, JobCounts> = new Map();
  for (const job of jobs.data ?? []) {
    const stats: JobCounts = counts.get(job.projectId) ?? { attention: 0, failed: 0, auth: false };
    if (needsYou(job)) stats.attention++;
    if (job.state === "failed") stats.failed++;
    if (job.state === "waiting" && job.waitingReason === "auth") stats.auth = true;
    counts.set(job.projectId, stats);
  }
  const total: number = projects.data?.length ?? 0;
  const currentPage: number = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
  const start: number = currentPage * pageSize;
  return (
    <Page title="Projects" actions={<Button kind="primary" disabled={!connected} onClick={() => void navigate("/projects/new")}>New project</Button>}>
      <ErrorText error={projects.error ?? jobs.error} />
      <Panel>
        <div style={{ overflowX: "auto" }}>
          <table className={ui.table}>
            <thead><tr><th>Name</th><th>Repository</th><th>Base branch</th><th>Needs you</th><th>Failed jobs</th></tr></thead>
            <tbody>
              {projects.loading && !projects.data && <tr><td colSpan={5} className={ui.muted}>Loading…</td></tr>}
              {projects.data?.slice(start, start + pageSize).map(({ id, project, creating, errors }) => {
                const name: string = project?.name ?? id;
                const stats: JobCounts | undefined = counts.get(id);
                return (
                  <tr key={id}>
                    <td>
                      {connected ? <Link to={`/projects/${id}`}>{name}</Link> : name}
                      {creating && <div style={{ color: "var(--status-warning)" }}>
                        {connected ? <Link to={`/projects/new?resume=${id}`}>Resume creation</Link> : "Unfinished creation"}
                      </div>}
                      {errors.length > 0 && <div style={{ color: "var(--status-warning)" }}>Definition errors</div>}
                      {stats?.auth && <div style={{ color: "var(--status-warning)" }}>Login needed</div>}
                    </td>
                    <td>{project ? project.repo?.url ?? "local only" : "—"}</td>
                    <td>{project?.baseBranch ?? "—"}</td>
                    <td>{jobs.data ? stats?.attention ?? 0 : "—"}</td>
                    <td>{jobs.data ? stats?.failed ?? 0 : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!projects.loading && !projects.error && total === 0 && <Empty>No projects: New project</Empty>}
        {total > pageSize && <div className={ui.row} style={{ marginTop: 12 }}>
          <Button disabled={!connected || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button disabled={!connected || start + pageSize >= total} onClick={() => setPage(currentPage + 1)}>Show more</Button>
        </div>}
      </Panel>
    </Page>
  );
}
