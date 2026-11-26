import { Dialog } from "../ds/overlay";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Artifact, HumanInterface, humanInterfaces } from "@pecore/schemas";
import type { CodeReviewArtifact, QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { artifactKey, ArtifactView } from "./ArtifactView";
import { CodeSnapshot } from "./CodeSnapshot";
import { Button } from "../ds/button";
import { Details } from "../ds/data";
import { Alert, EmptyState } from "../ds/feedback";
import { TextArea } from "../ds/field";
import { ErrorText, ui } from "./ui";
import s from "./ConfirmItem.module.css";

const positive: ReadonlySet<string> = new Set(["approved", "approve", "confirm", "accept", "yes", "continue", "retry", "allow", "start", "post"]);
const negative: ReadonlySet<string> = new Set(["rejected", "reject", "deny", "stop", "no", "abort", "cancel", "fail"]);

export const queueKindLabel: Record<QueueItemView["kind"], string> = {
  "human-node": "Human step",
  "ci-head": "Pull request head changed",
  "engine-node": "Engine node",
  "source-node": "Retired ticket integration",
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
  feedback: "Feedback", log: "Log", diff: "Changes", spec: "Spec", code_review: "Code review", code_analysis: "Code analysis", sha: "Commit SHA", pull_request: "Pull request", attachment: "Attachment",
};
const reportOrder: Artifact["type"][] = ["spec", "code_analysis", "code_review", "feedback", "log", "pull_request", "sha"];

function Shown({ artifacts }: { artifacts: Artifact[] }) {
  const sorted: Artifact[] = [...artifacts].sort((a, b) => (reportOrder.indexOf(a.type) + 99) % 99 - (reportOrder.indexOf(b.type) + 99) % 99);
  return (
    <div className={ui.stack}>
      {sorted.map((a) => <div key={artifactKey(a)}><strong>{artifactLabel[a.type]}</strong><ArtifactView artifact={a} /></div>)}
    </div>
  );
}

type ReviewLine = { file: string; line: number };

function CodeReview({ artifacts, onComment }: { artifacts: Artifact[]; onComment?: ((line: ReviewLine) => void) | undefined }) {
  const diff: Artifact | undefined = artifacts.find((a) => a.type === "diff");
  if (!diff) return <EmptyState title="No code changes to review." />;
  const reports: Artifact[] = artifacts.filter((a) => a.type === "code_analysis" || a.type === "code_review");
  return (
    <div className={ui.stack}>
      <div><strong>Changes</strong><ArtifactView artifact={diff} analysis={reports.find(({ type }) => type === "code_analysis")} onComment={onComment} /></div>
      {reports.length > 0 && <Shown artifacts={reports} />}
    </div>
  );
}

function ReportReview({ artifacts }: { artifacts: Artifact[] }) {
  return artifacts.length ? <Shown artifacts={artifacts} /> : <EmptyState title="No report to review." />;
}

function Decision({ artifacts }: { artifacts: Artifact[] }) {
  return artifacts.length ? <Shown artifacts={artifacts} /> : null;
}

const humanViews: Record<HumanInterface, (props: { artifacts: Artifact[]; onComment?: ((line: ReviewLine) => void) | undefined }) => ReactNode> = {
  "code-review": CodeReview,
  "report-review": ReportReview,
  decision: Decision,
};

function humanInterface(subject: Record<string, unknown>): HumanInterface | undefined {
  return HumanInterface.safeParse(subject.interface).data;
}

function Subject({ item, connected, onComment }: { item: QueueItemView; connected: boolean; onComment: ((line: ReviewLine) => void) | undefined }) {
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
          {iface !== "decision" && typeof subject.filesHash === "string" && <div>Files hash: <code>{subject.filesHash}</code></div>}
          {connected && item.jobId ? <Link to={`/jobs/${item.jobId}`}>Open the job</Link> : null}
          {typeof record(subject.job).request === "string" && <section><strong>{String(record(subject.job).title)}</strong><p>{String(record(subject.job).request)}</p></section>}
          {View && artifacts.success ? <View artifacts={artifacts.data} onComment={onComment} /> : <Snapshot value={item.subject} />}
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
          <dt>Edge</dt><dd><Snapshot value={subject.edge ?? "Unknown"} /></dd>
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
  const [line, setLine] = useState<ReviewLine | null>(null);
  const [comments, setComments] = useState<CodeReviewArtifact["comments"]>([]);
  const [inline, setInline] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const subject: Record<string, unknown> = record(item.subject);
  const notes: string[] = item.kind === "human-node" && Array.isArray(subject.notes) ? subject.notes.filter((outcome): outcome is string => typeof outcome === "string") : [];
  const acceptsNote: boolean = notes.length > 0;
  const iface: HumanInterface | undefined = item.kind === "human-node" ? humanInterface(subject) : undefined;
  const inlineReview: boolean = iface === "code-review" && subject.inlineReview === true;
  const answer = useAction(async (choice: string) => {
    try {
      await call("answerQueue", {
        params: { id: item.id },
        body: { choice, note: notes.includes(choice) && note ? note : null, hash: item.subjectHash,
          ...(inlineReview && choice === "changes_requested" ? { input: { body: note, comments } } : {}),
        },
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
      <Subject item={item} connected={connected} onComment={inlineReview && !locked && connected && !answer.busy ? setLine : undefined} />
      <div className={s.hash}>SHA-256 <code>{item.subjectHash}</code></div>
      {!locked && (
        <div className={s.answer}>
          {line && <Dialog open onOpenChange={(open) => {
            if (!open) { setInline(""); setLine(null); }
          }} title={`Comment on ${line.file}:${line.line}`} footer={<>
            <Button onClick={() => { setInline(""); setLine(null); }}>Cancel</Button>
            <Button variant="primary" disabled={!inline.trim()} onClick={() => {
              setComments([...comments, { ...line, text: inline.trim() }]);
              setInline("");
              setLine(null);
            }}>Add comment</Button>
          </>}>
            <TextArea label="Comment" value={inline} onValueChange={setInline} autoFocus />
          </Dialog>}
          {comments.map(({ file, line, text }, index) => <div className={ui.row} key={index}><code>{file}:{line}</code><span>{text}</span>
            <Button disabled={answer.busy} onClick={() => setComments(comments.filter((_, i) => i !== index))}>Remove</Button></div>)}
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
                {choice === "approved" ? "Approve" : choice === "changes_requested" ? "Request changes" : choice === "rejected" ? "Reject" : choice}
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
