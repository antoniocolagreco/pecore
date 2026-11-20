import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { NotificationView, ProjectView, QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem, queueKindLabel } from "../components/ConfirmItem";
import { ErrorText, Page, duration } from "../components/ui";
import { IconButton } from "../ds/button";
import { Card, EmptyState, Skeleton } from "../ds/feedback";
import { BellIcon, TrashIcon } from "../ds/icons";
import s from "./Notifications.module.css";

function notificationLink({ target }: NotificationView, projects: ProjectView[] | undefined): string | null {
  if (target?.item) return `/notifications/${encodeURIComponent(target.item)}`;
  if (target?.job === "project-setup" && target.project) {
    const id: string = encodeURIComponent(target.project);
    const project: ProjectView | undefined = projects?.find((entry) => entry.id === target.project);
    return project?.creating === null ? `/projects/${id}` : `/projects/new?resume=${id}`;
  }
  if (target?.job) return `/jobs/${encodeURIComponent(target.job)}`;
  return null;
}

function Row({ to, current, children, action, error }: { to: string | null; current?: boolean; children: ReactNode; action?: ReactNode; error?: string | null }) {
  const connected: boolean = useConnected();
  return (
    <li>
      <div className={s.row}>
        {connected && to ? <Link className={s.item} to={to} aria-current={current ? "page" : undefined}>{children}</Link> : <span className={s.item}>{children}</span>}
        {action}
      </div>
      <ErrorText error={error} />
    </li>
  );
}

function NotificationRow({ notification, to, current, connected, reload }: { notification: NotificationView; to: string | null; current: boolean; connected: boolean; reload(): void }) {
  const remove = useAction(async () => {
    await call("deleteNotification", { params: { id: notification.id } });
    reload();
  });
  return (
    <Row to={to} current={current} error={remove.error} action={
      <IconButton size="sm" label={`Delete notification: ${notification.title}`} icon={<TrashIcon />} disabled={!connected}
        loading={remove.busy} onClick={() => void remove.run()} />
    }>
      <span className={s.itemHead}>
        <span className={s.title}>{notification.title}</span>
        <span className={s.age}>{duration(Date.now() - notification.createdAt)}</span>
      </span>
      <span className={s.itemMeta}>{notification.body}</span>
    </Row>
  );
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
          <EmptyState icon={<BellIcon size="md" />} title="Nothing new">
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
              {log.map((n) => <NotificationRow key={n.id} notification={n} to={notificationLink(n, projects.data)} current={!!id && n.target?.item === id}
                connected={connected} reload={notifications.reload} />)}
            </ul>
          </Card>
          {id && <Card padded className={s.detail}><ConfirmItem itemId={id} onDone={queue.reload} /></Card>}
        </div>
      )}
    </Page>
  );
}
