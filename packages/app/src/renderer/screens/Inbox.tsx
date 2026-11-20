import { useState } from "react";
import { Link, useParams } from "react-router";
import type { QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem, queueKindLabel } from "../components/ConfirmItem";
import { Button, ErrorText, Page, duration } from "../components/ui";
import { Card, EmptyState, Skeleton } from "../ds/feedback";
import { InboxIcon } from "../ds/icons";
import { useProjectFilter } from "../shell/filter";
import s from "./Inbox.module.css";

const pageSize: number = 100;

export function Inbox() {
  const { id } = useParams();
  const connected: boolean = useConnected();
  const { project } = useProjectFilter();
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
  const jobTitle = (item: QueueItemView): string | null => item.jobId ? titles.get(item.jobId) ?? (item.jobId === "project-setup" ? "Project setup" : item.jobId) : null;

  return (
    <Page title="Inbox">
      <ErrorText error={queue.error ?? projects.error ?? jobs.error} />
      {!queue.loading && !queue.error && items.length === 0 && !id ? (
        <Card padded>
          <EmptyState icon={<InboxIcon size={20} />} title="Inbox empty: nothing waits for you">
            When a job needs a review, a confirmation or a decision, it shows up here.
          </EmptyState>
        </Card>
      ) : (
        <div className={s.split}>
          <Card padded={false}>
            <ul className={s.list} aria-label="Waiting items">
              {queue.loading && !queue.data && [0, 1, 2].map((i) => <li key={i} className={s.placeholder}><Skeleton width="50%" /><Skeleton width="80%" height={10} /></li>)}
              {items.slice(start, start + pageSize).map((item) => {
                const body = (
                  <>
                    <span className={s.itemHead}>
                      <span className={s.kind}>{queueKindLabel[item.kind]}</span>
                      <span className={s.age}>{duration(Date.now() - item.createdAt)}</span>
                    </span>
                    <span className={s.itemMeta}>{names.get(item.projectId) ?? item.projectId}{jobTitle(item) && ` · ${jobTitle(item)}`}</span>
                  </>
                );
                return (
                  <li key={item.id}>
                    {connected
                      ? <Link className={s.item} to={`/inbox/${item.id}`} aria-current={item.id === id ? "page" : undefined}>{body}</Link>
                      : <span className={s.item}>{body}</span>}
                  </li>
                );
              })}
            </ul>
            {items.length > pageSize && (
              <div className={s.pagination}>
                <Button disabled={!connected || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                <Button disabled={!connected || start + pageSize >= items.length} onClick={() => setPage(currentPage + 1)}>Show more</Button>
              </div>
            )}
          </Card>
          {id
            ? <Card padded className={s.detail}><ConfirmItem itemId={id} onDone={queue.reload} /></Card>
            : <Card padded className={s.detail}><EmptyState title="Choose an item">Pick an item on the left to see what it asks and answer it.</EmptyState></Card>}
        </div>
      )}
    </Page>
  );
}
