import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Artifact, HumanInterface, humanInterfaces } from "@pecore/schemas";
import type { QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ArtifactView } from "./ArtifactView";
import { CodeSnapshot } from "./CodeSnapshot";
import { Button } from "../ds/button";
import { Details } from "../ds/data";
import { Alert, EmptyState } from "../ds/feedback";
import { TextArea } from "../ds/field";
import { ErrorText, ui } from "./ui";
import s from "./ConfirmItem.module.css";

const positive: ReadonlySet<string> = new Set(["approve", "confirm", "accept", "yes", "continue", "retry", "allow", "start", "post"]);
const negative: ReadonlySet<string> = new Set(["reject", "deny", "stop", "no", "abort", "cancel", "fail"]);

export const queueKindLabel: Record<QueueItemView["kind"], string> = {
  "human-node": "Human step",
  "ci-head": "Pull request head changed",
  "engine-node": "Engine node",
  "source-node": "Source node",
  "recipe-change": "Recipe change",
  import: "Import",
  services: "Services",
  ticket: "Untrusted ticket",
  "round-limit": "Round limit",
  budget: "Budget limit",
  "agent-question": "Agent question",
  outbound: "Comment to post",
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function Snapshot({ value }: { value: unknown }) {
  if (value !== null && typeof value === "object") return <CodeSnapshot content={JSON.stringify(value, null, 2)} language="json" label="Details" />;
  return <pre className={s.snapshot}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>;
}

const artifactLabel: Record<Artifact["type"], string> = {
  text: "Text", diff: "Changes", document: "Document", spec: "Spec", findings: "Findings", reference: "Reference", attachment: "Attachment",
};
const reportOrder: Artifact["type"][] = ["document", "spec", "findings", "text", "reference"];

function Shown({ artifacts }: { artifacts: Artifact[] }) {
  const sorted: Artifact[] = [...artifacts].sort((a, b) => (reportOrder.indexOf(a.type) + 99) % 99 - (reportOrder.indexOf(b.type) + 99) % 99);
  return (
    <div className={ui.stack}>
      {sorted.map((a) => <div key={a.path}><strong>{artifactLabel[a.type]}</strong><ArtifactView artifact={a} /></div>)}
    </div>
  );
}

function CodeReview({ artifacts }: { artifacts: Artifact[] }) {
  const diff: Artifact | undefined = artifacts.find((a) => a.type === "diff");
  if (!diff) return <EmptyState title="No code changes to review." />;
  const findings: Artifact[] = artifacts.filter((a) => a.type === "findings");
  return (
    <div className={ui.stack}>
      <div><strong>Changes</strong><ArtifactView artifact={diff} findings={findings[0]} /></div>
      {findings.length > 0 && <Shown artifacts={findings} />}
    </div>
  );
}

function ReportReview({ artifacts }: { artifacts: Artifact[] }) {
  return artifacts.length ? <Shown artifacts={artifacts} /> : <EmptyState title="No report to review." />;
}

function Decision({ artifacts }: { artifacts: Artifact[] }) {
  return artifacts.length ? <Shown artifacts={artifacts} /> : null;
}

const humanViews: Record<HumanInterface, (props: { artifacts: Artifact[] }) => ReactNode> = {
  "code-review": CodeReview,
  "report-review": ReportReview,
  decision: Decision,
};

function humanInterface(subject: Record<string, unknown>): HumanInterface | undefined {
  return HumanInterface.safeParse(subject.interface).data;
}

function Subject({ item, connected }: { item: QueueItemView; connected: boolean }) {
  const subject: Record<string, unknown> = record(item.subject);
  switch (item.kind) {
    case "human-node": {
      const artifacts = Artifact.array().safeParse(subject.show);
      const iface: HumanInterface | undefined = humanInterface(subject);
      const View = iface ? humanViews[iface] : undefined;
      return (
        <>
          {typeof subject.node === "string" && <div>Node: {subject.node}</div>}
          {typeof subject.description === "string" && <div>{subject.description}</div>}
          {iface !== "decision" && typeof subject.contentState === "string" && <div>Content state: <code>{subject.contentState}</code></div>}
          {connected && item.jobId ? <Link to={`/jobs/${item.jobId}`}>Open the job</Link> : null}
          {View && artifacts.success ? <View artifacts={artifacts.data} /> : <Snapshot value={item.subject} />}
        </>
      );
    }
    case "outbound":
      return (
        <>
          <div>The Project Manager wants to post this on ticket {String(subject.ticketId)} of {item.projectId}. Nothing is posted until you choose post.</div>
          <Snapshot value={subject.text} />
        </>
      );
    case "ci-head":
      return <>
        <p>The pull request points to a different commit. Restore the expected commit and choose Recheck, or stop the job.</p>
        <Snapshot value={item.subject} />
      </>;
    case "round-limit":
      return (
        <Details>
          <dt>Edge</dt><dd><Snapshot value={subject.edge ?? "Job node run limit"} /></dd>
          <dt>Cap</dt><dd>{typeof subject.cap === "number" ? subject.cap : "Unknown"}</dd>
          <dt>Job</dt><dd>{connected && item.jobId ? <Link to={`/jobs/${item.jobId}`}>{item.jobId}</Link> : item.jobId}</dd>
        </Details>
      );
    default:
      return <Snapshot value={item.subject} />;
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
  const subject: Record<string, unknown> = record(item.subject);
  const notes: string[] = item.kind === "human-node" && Array.isArray(subject.notes) ? subject.notes.filter((outcome): outcome is string => typeof outcome === "string") : [];
  const acceptsNote: boolean = notes.length > 0;
  const iface: HumanInterface | undefined = item.kind === "human-node" ? humanInterface(subject) : undefined;
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
        <Alert
          tone={item.state === "cancelled" ? "neutral" : "success"}
          actions={replacement && connected && <Link to={`/notifications/${replacement.id}`}>Open newest item</Link>}
        >
          {item.state === "cancelled" ? "Item cancelled." : `Item resolved${item.choice ?? submitted ? ` (${item.choice ?? submitted})` : ""}.`}
          {item.note && <div>{item.note}</div>}
        </Alert>
      )}
      <h2 className={s.kind}>{iface ? humanInterfaces[iface].label : queueKindLabel[item.kind]}</h2>
      <Subject item={item} connected={connected} />
      <div className={s.hash}>SHA-256 <code>{item.subjectHash}</code></div>
      {!locked && (
        <div className={s.answer}>
          {acceptsNote && <TextArea label="Note" description={`Sent with ${notes.join(", ")}`} value={note} onValueChange={setNote} disabled={!connected || answer.busy} placeholder="Optional: what should change, or why" />}
          <div className={ui.row}>
            {item.choices.map((choice) => (
              <Button
                key={choice}
                className={s.choice}
                variant={positive.has(choice) ? "primary" : negative.has(choice) ? "danger" : "secondary"}
                disabled={!connected || answer.busy}
                onClick={() => void answer.run(choice)}
              >
                {choice}
              </Button>
            ))}
          </div>
        </div>
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
        !queue.error && <EmptyState title={queue.loading ? "Loading item…" : "Item not found"} />}
    </>
  );
}
