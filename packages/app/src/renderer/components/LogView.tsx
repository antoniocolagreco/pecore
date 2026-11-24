import { ApiError } from "@pecore/schemas";
import type { LogEvent } from "@pecore/schemas";
import { useEffect, useState } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { onLive, subscribeLog, useConnected } from "../api/live";
import { ErrorText, ui } from "./ui";
import { Button } from "../ds/button";
import { EmptyState } from "../ds/feedback";
import s from "./LogView.module.css";

const pageSize: number = 150;

function EventLine({ event }: { event: LogEvent }) {
  switch (event.type) {
    case "tool_call":
      return <div>{event.title || event.toolCallId}{event.kind && ` · ${event.kind}`}{event.status && ` · ${event.status}`}</div>;
    case "permission":
      return <div>Permission · {event.toolCallId || "Tool call"}{event.optionId && ` · ${event.optionId}`}</div>;
    case "stderr":
      return <div className={s.stderr}>stderr · {event.text}</div>;
    case "output":
      return <div>Output · {event.text}</div>;
    case "text":
      return <span>{event.text}</span>;
  }
}

function withoutOverlap(history: LogEvent[], live: LogEvent[]): LogEvent[] {
  const counts = new Map<string, number>();
  const first: number | undefined = live[0]?.at;
  if (first === undefined) return history;
  for (const event of history) {
    if (event.at < first) continue;
    const key: string = JSON.stringify(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return history.concat(live.filter((event) => {
    const key: string = JSON.stringify(event);
    const count: number = counts.get(key) ?? 0;
    if (!count) return true;
    counts.set(key, count - 1);
    return false;
  }));
}

function Events({ attemptId, running }: { attemptId: string; running: boolean }) {
  const connected: boolean = useConnected();
  const [history, setHistory] = useState<LogEvent[]>([]);
  const [live, setLive] = useState<LogEvent[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(0);
  useEffect(() => {
    let current: boolean = true;
    let pending: LogEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listen = connected && running;
    const off = listen ? onLive((message) => {
      if (message.type !== "log.line" || message.attemptId !== attemptId) return;
      pending.push(message.event);
      timer ??= setTimeout(() => {
        const batch: LogEvent[] = pending;
        pending = [];
        timer = undefined;
        setLive((previous) => previous.concat(batch));
      }, 100);
    }) : undefined;
    const unsubscribe = listen ? subscribeLog(attemptId) : undefined;
    setLoading(true);
    void call("getLog", { params: { id: attemptId }, query: { view: "events" } }).then(
      (result) => {
        if (!current || result.view !== "events") return;
        setHistory(result.events);
        setError(null);
        setLoading(false);
      },
      (reason: Error) => {
        if (!current) return;
        setError(reason);
        setLoading(false);
      },
    );
    return () => {
      current = false;
      off?.();
      unsubscribe?.();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [attemptId, connected, running]);
  const removed: boolean = error instanceof ApiError && error.status === 410;
  const events: LogEvent[] = withoutOverlap(history, live);
  const pages: number = Math.max(0, Math.ceil(events.length / pageSize) - 1);
  const offset: number = Math.min(page, pages);
  const end: number = Math.max(0, events.length - offset * pageSize);
  if (removed) return <EmptyState title="Log removed" />;
  return (
    <>
      {(!running || events.length === 0) && <ErrorText error={error} />}
      {!events.length && <EmptyState title={loading ? "Loading log…" : "No log events."} />}
      {!!events.length && (
        <div className={s.log} aria-label="Log events">
          {events.slice(Math.max(0, end - pageSize), end).map((event, index) => <EventLine key={`${end - Math.min(end, pageSize) + index}-${event.at}`} event={event} />)}
        </div>
      )}
      <LogPages page={offset} pages={pages} setPage={setPage} />
    </>
  );
}

function LogPages({ page, pages, setPage }: { page: number; pages: number; setPage(page: number): void }) {
  const connected: boolean = useConnected();
  if (!pages) return null;
  return (
    <div className={ui.row}>
      <Button disabled={!connected || page >= pages} onClick={() => setPage(page + 1)}>Show more (older)</Button>
      <Button disabled={!connected || page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
    </div>
  );
}

function RawLog({ attemptId, running }: { attemptId: string; running: boolean }) {
  const log = useData(() => call("getLog", { params: { id: attemptId }, query: { view: "raw" } }), [attemptId, running]);
  const [page, setPage] = useState<number>(0);
  const lines: unknown[] = log.data?.view === "raw" ? log.data.lines : [];
  const pages: number = Math.max(0, Math.ceil(lines.length / pageSize) - 1);
  const offset: number = Math.min(page, pages);
  const end: number = Math.max(0, lines.length - offset * pageSize);
  if (log.error instanceof ApiError && log.error.status === 410) return <EmptyState title="Log removed" />;
  return (
    <>
      <ErrorText error={log.error} />
      {lines.length ? <pre className={s.log}>{lines.slice(Math.max(0, end - pageSize), end).map((line) => JSON.stringify(line)).join("\n")}</pre> : <EmptyState title={log.loading ? "Loading log…" : "No log lines."} />}
      <LogPages page={offset} pages={pages} setPage={setPage} />
    </>
  );
}

export function LogView({ attemptId, running }: { attemptId: string; running: boolean }) {
  const connected: boolean = useConnected();
  const [raw, setRaw] = useState<boolean>(false);
  return (
    <section className={ui.stack} aria-label="Attempt log">
      <div className={ui.row}><strong>Log</strong><Button disabled={!connected} aria-pressed={raw} onClick={() => setRaw(!raw)}>Raw</Button></div>
      {raw ? <RawLog key={attemptId} attemptId={attemptId} running={running} /> : <Events key={attemptId} attemptId={attemptId} running={running} />}
    </section>
  );
}
