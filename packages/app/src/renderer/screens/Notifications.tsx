import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { NotificationView, QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem, queueKindLabel } from "../components/ConfirmItem";
import { ErrorText, Page, duration } from "../components/ui";
import { Card, EmptyState, Skeleton } from "../ds/feedback";
import { BellIcon } from "../ds/icons";
import s from "./Notifications.module.css";

function notificationLink({ target }: NotificationView): string | null {
  if (target?.item) return `/notifications/${encodeURIComponent(target.item)}`;
  if (target?.job) return `/jobs/${encodeURIComponent(target.job)}`;
  return null;
}

function Row({ to, current, children }: { to: string | null; current?: boolean; children: ReactNode }) {
  const connected: boolean = useConnected();
  return <li>{connected && to ? <Link className={s.item} to={to} aria-current={current ? "page" : undefined}>{children}</Link> : <span className={s.item}>{children}</span>}</li>;
}

export function Notifications() {
  const { id } = useParams();
  const connected: boolean = useConnected();
  const queue = useData(() => call("listQueue", { query: { state: "open" } }), [], (m) => m.type === "queue.updated");
  const notifications = useData(() => call("listNotifications"), [], (m) => m.type === "notify");
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated" || m.type === "definition.changed");
  const jobs = useData(() => call("listJobs", { query: {} }), [], (m) => m.type === "job.updated" || m.type === "project.updated");
  const names: Map<string, string> = new Map(projects.data?.map((entry) => [entry.id, entry.project?.name ?? entry.id]));
  const titles: Map<string, string> = new Map(jobs.data?.map((job) => [job.id, job.title]));
  const items: QueueItemView[] = (queue.data ?? []).filter((item) => item.kind !== "agent-question")
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const log: NotificationView[] = notifications.data ?? [];
  const unseen: boolean = log.some(({ seen }) => !seen);
  const jobTitle = (item: QueueItemView): string | null => item.jobId ? titles.get(item.jobId) ?? (item.jobId === "project-setup" ? "Project setup" : item.jobId) : null;
  const loading: boolean = (queue.loading && !queue.data) || (notifications.loading && !notifications.data);

  useEffect(() => {
    if (connected && unseen) void call("markNotificationsSeen");
  }, [connected, unseen]);

  return (
    <Page title="Notifications">
      <ErrorText error={queue.error ?? notifications.error ?? projects.error ?? jobs.error} />
      {!loading && items.length === 0 && log.length === 0 && !id ? (
        <Card padded>
          <EmptyState icon={<BellIcon size={20} />} title="Nothing new">
            Decisions you need to make and updates from PeCore show up here.
          </EmptyState>
        </Card>
      ) : (
        <div className={id ? s.split : undefined}>
          <Card padded={false}>
            <ul className={s.list} aria-label="Notifications">
              {loading && [0, 1, 2].map((i) => <li key={i} className={s.placeholder}><Skeleton width="50%" /><Skeleton width="80%" height={10} /></li>)}
              {items.map((item) => (
                <Row key={item.id} to={`/notifications/${item.id}`} current={item.id === id}>
                  <span className={s.itemHead}>
                    <span className={s.kind}><span className={s.dot} aria-label="Needs you" />{queueKindLabel[item.kind]}</span>
                    <span className={s.age}>{duration(Date.now() - item.createdAt)}</span>
                  </span>
                  <span className={s.itemMeta}>{names.get(item.projectId) ?? item.projectId}{jobTitle(item) && ` · ${jobTitle(item)}`}</span>
                </Row>
              ))}
              {log.map((n) => (
                <Row key={n.id} to={notificationLink(n)} current={!!id && n.target?.item === id}>
                  <span className={s.itemHead}>
                    <span className={s.title}>{n.title}</span>
                    <span className={s.age}>{duration(Date.now() - n.createdAt)}</span>
                  </span>
                  <span className={s.itemMeta}>{n.body}</span>
                </Row>
              ))}
            </ul>
          </Card>
          {id && <Card padded className={s.detail}><ConfirmItem itemId={id} onDone={queue.reload} /></Card>}
        </div>
      )}
    </Page>
  );
}
