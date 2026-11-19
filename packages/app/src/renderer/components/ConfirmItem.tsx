import { useState } from "react";
import { Link } from "react-router";
import { Artifact } from "@pecore/schemas";
import type { QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, Empty, ErrorText, Field, ui } from "./ui";
import s from "./ConfirmItem.module.css";

export const queueKindLabel: Record<QueueItemView["kind"], string> = {
  "human-node": "Human review",
  "engine-node": "Engine node",
  "source-node": "Source node",
  "recipe-change": "Recipe change",
  import: "Import",
  services: "Services",
  ticket: "Untrusted ticket",
  "round-limit": "Round limit",
  budget: "Budget limit",
  connector: "Connector",
  "agent-question": "Agent question",
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function Snapshot({ value }: { value: unknown }) {
  return <pre className={s.snapshot}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

function Subject({ item, connected }: { item: QueueItemView; connected: boolean }) {
  const subject: Record<string, unknown> = record(item.subject);
  switch (item.kind) {
    case "human-node": {
      const artifacts = Artifact.array().safeParse(subject.show ?? subject.artifacts);
      return (
        <>
          {typeof subject.node === "string" && <div>Node: {subject.node}</div>}
          {typeof subject.description === "string" && <div>{subject.description}</div>}
          {typeof subject.contentState === "string" && <div>Content state: <code>{subject.contentState}</code></div>}
          {artifacts.success && artifacts.data.length > 0 && (
            <ul>
              {artifacts.data.map((artifact) => (
                <li key={artifact.path}>
                  {connected && item.jobId ? <Link to={`/jobs/${item.jobId}`}>{artifact.path}</Link> : artifact.path}
                  {" · "}{artifact.type}
                </li>
              ))}
            </ul>
          )}
          {!artifacts.success && <Snapshot value={JSON.stringify(item.subject, null, 2)} />}
        </>
      );
    }
    case "engine-node":
    case "source-node":
      return (
        <>
          {typeof subject.path === "string" && <code>{subject.path}</code>}
          <div>
            <strong>Definition</strong>
            <Snapshot value={JSON.stringify(subject.definition, null, 2)} />
          </div>
          {Object.entries(record(subject.scripts)).map(([path, content]) => (
            <div key={path}>
              <strong>{path}</strong>
              <Snapshot value={content} />
            </div>
          ))}
        </>
      );
    case "services":
      return (
        <>
          {typeof subject.path === "string" && <code>{subject.path}</code>}
          <Snapshot value={subject.compose} />
        </>
      );
    case "round-limit":
      return (
        <dl className={ui.kv}>
          <dt>Edge</dt><dd><Snapshot value={subject.edge ?? "Job node run limit"} /></dd>
          <dt>Cap</dt><dd>{typeof subject.cap === "number" ? subject.cap : "Unknown"}</dd>
          <dt>Job</dt><dd>{connected && item.jobId ? <Link to={`/jobs/${item.jobId}`}>{item.jobId}</Link> : item.jobId}</dd>
        </dl>
      );
    default:
      return <Snapshot value={JSON.stringify(item.subject, null, 2)} />;
  }
}

function ItemDetail({ item, replacement, reload, onDone }: {
  item: QueueItemView;
  replacement: QueueItemView | undefined;
  reload(): void;
  onDone?(): void;
}) {
  const connected: boolean = useConnected();
  const [note, setNote] = useState<string>("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const acceptsNote: boolean = item.kind === "human-node" && record(item.subject).answer !== false;
  const answer = useAction(async (choice: string) => {
    try {
      await call("answerQueue", {
        params: { id: item.id },
        body: { choice, note: acceptsNote && note ? note : null, hash: item.subjectHash },
      });
      setSubmitted(choice);
      onDone?.();
    } finally {
      reload();
    }
  });
  const locked: boolean = item.state !== "open" || submitted !== null;
  return (
    <div className={ui.stack}>
      {locked && (
        <div className={ui.banner} role="status">
          {item.state === "cancelled" ? "Item cancelled." : `Item resolved${item.choice ?? submitted ? ` (${item.choice ?? submitted})` : ""}.`}
          {item.note && <div>{item.note}</div>}
          {replacement && connected && <> <Link to={`/inbox/${replacement.id}`}>Open newest item</Link></>}
        </div>
      )}
      <strong>{queueKindLabel[item.kind]}</strong>
      <Subject item={item} connected={connected} />
      <div className={s.hash}>SHA-256 <code>{item.subjectHash}</code></div>
      {!locked && (
        <>
          {acceptsNote && (
            <Field label="Note">
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!connected || answer.busy} />
            </Field>
          )}
          <div className={ui.row}>
            {item.choices.map((choice) => (
              <Button key={choice} disabled={!connected || answer.busy} onClick={() => void answer.run(choice)}>
                {choice}
              </Button>
            ))}
          </div>
        </>
      )}
      <ErrorText error={answer.error} />
    </div>
  );
}

export function ConfirmItem({ itemId, onDone }: { itemId: string; onDone?(): void }) {
  const queue = useData(() => call("listQueue", { query: {} }), [], (m) => m.type === "queue.updated");
  const item: QueueItemView | undefined = queue.data?.find((entry) => entry.id === itemId);
  const replacement: QueueItemView | undefined = item?.jobId ? queue.data?.findLast(
    (entry) => entry.id !== item.id && entry.projectId === item.projectId && entry.jobId === item.jobId && entry.state === "open",
  ) : undefined;
  return (
    <>
      <ErrorText error={queue.error} />
      {item ? <ItemDetail key={item.id} item={item} replacement={replacement} reload={queue.reload} onDone={onDone} /> :
        !queue.error && <Empty>{queue.loading ? "Loading item…" : "Item not found"}</Empty>}
    </>
  );
}
