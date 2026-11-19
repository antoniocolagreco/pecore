import type { JobView, NodeRunView } from "@pecore/schemas";
import { time, ui } from "./ui";

export type Tone = "running" | "success" | "failed" | "warning" | "inactive" | "none";

export type StateInfo = { label: string; tone: Tone; icon: string; detail: string | null; pulse: boolean };

const needsYouRun = new Set(["human", "confirmation", "round_limit", "budget", "auth"]);

const reasonText: Record<string, string> = {
  concurrency: "No free slot",
  quota: "Quota",
  rate_limit: "Rate limit",
  services: "Services starting",
  network: "Forge unreachable",
  disk: "Low disk",
  parent_job: "Parent job running",
  parent_failed: "Parent job failed",
  human: "Review",
  confirmation: "Confirmation",
  round_limit: "Round limit",
  budget: "Budget limit",
  auth: "Login needed",
};

export function reasonLabel(reason: string | null, until?: number | null): string | null {
  if (!reason) return null;
  const base = reasonText[reason] ?? reason;
  return until ? `${base} until ${time(until)}` : base;
}

export function jobState(job: Pick<JobView, "state" | "waitingReason" | "failureReason">): StateInfo {
  const r = job.waitingReason;
  switch (job.state) {
    case "running":
      return { label: "Working", tone: "running", icon: "●", detail: null, pulse: true };
    case "waiting":
      return needsYouRun.has(r ?? "")
        ? { label: "Needs you", tone: "warning", icon: "!", detail: reasonLabel(r), pulse: false }
        : { label: "Waiting", tone: "warning", icon: "◷", detail: reasonLabel(r), pulse: false };
    case "queued":
      return r === "parent_failed"
        ? { label: "Needs you", tone: "warning", icon: "!", detail: reasonLabel(r), pulse: false }
        : { label: "Queued", tone: "warning", icon: "…", detail: reasonLabel(r), pulse: false };
    case "paused":
      return { label: "Paused", tone: "inactive", icon: "❚❚", detail: r === "quit" ? "app quit" : "by you", pulse: false };
    case "succeeded":
      return { label: "Success", tone: "success", icon: "✓", detail: null, pulse: false };
    case "not_delivered":
      return { label: "Not delivered", tone: "inactive", icon: "○", detail: job.failureReason, pulse: false };
    case "failed":
      return { label: "Failed", tone: "failed", icon: "✕", detail: job.failureReason, pulse: false };
    case "stopped":
      return { label: "Stopped", tone: "inactive", icon: "■", detail: null, pulse: false };
  }
}

export function needsYou(job: Pick<JobView, "state" | "waitingReason" | "failureReason">): boolean {
  return jobState(job).label === "Needs you";
}

export function nodeRunState(run: Pick<NodeRunView, "state" | "outcome" | "waitingReason" | "failureReason">, outcomeTone: (outcome: string) => Tone): StateInfo {
  switch (run.state) {
    case "pending":
      return { label: "Pending", tone: "inactive", icon: "○", detail: null, pulse: false };
    case "running":
      return { label: "Working", tone: "running", icon: "●", detail: null, pulse: true };
    case "waiting":
      return { label: needsYouRun.has(run.waitingReason ?? "") ? "Needs you" : "Waiting", tone: "warning", icon: "◷", detail: reasonLabel(run.waitingReason), pulse: false };
    case "failed":
      return { label: "Failed", tone: "failed", icon: "✕", detail: run.failureReason, pulse: false };
    case "interrupted":
      return { label: "Interrupted", tone: "inactive", icon: "■", detail: null, pulse: false };
    case "skipped":
      return { label: "Skipped", tone: "inactive", icon: "↷", detail: null, pulse: false };
    case "completed":
      return { label: run.outcome ?? "done", tone: outcomeTone(run.outcome ?? ""), icon: "◆", detail: null, pulse: false };
  }
}

export function toneColor(tone: Tone): string {
  return tone === "none" ? "var(--text-muted)" : `var(--status-${tone})`;
}

export function StateLabel({ info }: { info: StateInfo }) {
  return (
    <span className={[ui.label, info.pulse ? ui.pulse : ""].join(" ")} style={{ color: toneColor(info.tone) }} title={info.detail ?? info.label}>
      <span aria-hidden>{info.icon}</span>
      {info.label}
      {info.detail ? <span style={{ fontWeight: 400 }}>· {info.detail}</span> : null}
    </span>
  );
}
