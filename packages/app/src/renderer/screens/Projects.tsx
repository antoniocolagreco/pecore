import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { needsYou } from "../components/states";
import { ErrorText, Page, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Badge, Card, EmptyState, Skeleton } from "../ds/feedback";
import { FolderIcon, LinkIcon, PlusIcon } from "../ds/icons";
import { ProjectImportDialog } from "./ProjectShareDialogs";
import s from "./Projects.module.css";

type JobCounts = { attention: number; failed: number; running: number; auth: boolean };

export function Projects() {
  const navigate = useNavigate();
  const connected: boolean = useConnected();
  const [importing, setImporting] = useState<boolean>(false);
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated" || m.type === "definition.changed");
  const jobs = useData(() => call("listJobs", { query: { archived: "false" } }), [], (m) => m.type === "job.updated" || m.type === "project.updated");
  const counts: Map<string, JobCounts> = new Map();
  for (const job of jobs.data ?? []) {
    const stats: JobCounts = counts.get(job.projectId) ?? { attention: 0, failed: 0, running: 0, auth: false };
    if (needsYou(job)) stats.attention++;
    if (job.state === "failed") stats.failed++;
    if (job.state === "running") stats.running++;
    if (job.state === "waiting" && job.waitingReason === "auth") stats.auth = true;
    counts.set(job.projectId, stats);
  }
  const actions = <div className={ui.row}>
    <Button variant="primary" icon={<PlusIcon />} disabled={!connected} onClick={() => void navigate("/projects/new")}>New project</Button>
    <Button disabled={!connected} onClick={() => setImporting(true)}>Import</Button>
  </div>;
  return (
    <Page title="Projects" actions={projects.data?.length === 0 ? undefined : actions}>
      {importing && <ProjectImportDialog onClose={() => setImporting(false)} onImported={(id) => {
        setImporting(false);
        void navigate(`/projects/${encodeURIComponent(id)}`);
      }} />}
      <ErrorText error={projects.error ?? jobs.error} />
      {projects.data?.length === 0 && (
        <Card padded>
          <EmptyState icon={<FolderIcon size="md" />} title="No projects yet" action={actions}>
            A project is a repository PeCore works on. It can live only on this computer or on GitHub and GitLab.
          </EmptyState>
        </Card>
      )}
      <div className={s.grid}>
        {projects.loading && !projects.data && [0, 1, 2].map((i) => <Card key={i} padded><Skeleton width="40%" /><Skeleton width="70%" height={10} style={{ marginTop: 10 }} /></Card>)}
        {projects.data?.map(({ id, project, creating, errors }) => {
          const stats: JobCounts | undefined = counts.get(id);
          const body = (
            <>
              <span className={s.head}>
                <span className={s.icon}><FolderIcon /></span>
                <span className={s.name}>{project?.name ?? id}</span>
              </span>
              <span className={s.repo}>
                {project?.repo && <LinkIcon size="xs" />}
                <span className={s.repoName}>{project?.repo ? project.repo.url.replace(/^https?:\/\//, "").replace(/\.git$/, "") : "Local only"}</span>
                {project && <span className={s.branch}>{project.baseBranch}</span>}
              </span>
              <span className={s.badges}>
                {creating && <Badge tone="warning">Unfinished creation</Badge>}
                {errors.length > 0 && <Badge tone="danger">Definition errors</Badge>}
                {stats?.auth && <Badge tone="warning">Login needed</Badge>}
                {!!stats?.attention && <Badge tone="warning" dot>{stats.attention} need you</Badge>}
                {!!stats?.running && <Badge tone="accent" dot pulse>{stats.running} running</Badge>}
                {!!stats?.failed && <Badge tone="danger" dot>{stats.failed} failed</Badge>}
                {!creating && !errors.length && !stats?.attention && !stats?.running && !stats?.failed && !stats?.auth && <Badge>Idle</Badge>}
              </span>
            </>
          );
          const to: string = creating ? `/projects/new?resume=${id}` : `/projects/${id}`;
          return connected ? <Link key={id} to={to} className={s.card}>{body}</Link> : <div key={id} className={s.card}>{body}</div>;
        })}
      </div>
    </Page>
  );
}
