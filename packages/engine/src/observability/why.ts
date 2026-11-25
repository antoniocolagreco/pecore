import type { WhyReason, WhyView } from "@pecore/schemas";
import type { JobRow, ProjectContext } from "../graph/executor";

type WaitingRun = {
  id: string;
  node: string;
  waiting_reason: string | null;
  reset_at: number | null;
  queue_item_id: string | null;
  auth_account: string | null;
  auth_os_user: string | null;
};

const reason = (r: Partial<WhyReason> & Pick<WhyReason, "reason" | "text">): WhyReason => ({
  nodeRunId: null,
  until: null,
  queueItemId: null,
  account: null,
  jobId: null,
  ...r,
});

function queuedReason(ctx: ProjectContext, job: JobRow, globalPause: boolean): WhyReason {
  const parent = job.parent_job_id ? (ctx.db.db.prepare("SELECT id, title, state FROM jobs WHERE id = ?").get(job.parent_job_id) as Pick<JobRow, "id" | "title" | "state"> | undefined) : undefined;
  const account = ctx.project.repo?.account ?? null;
  switch (job.waiting_reason) {
    case "parent_job":
      return reason({ reason: "parent_job", text: `Waits for the parent job "${parent?.title ?? job.parent_job_id}" to finish its work`, jobId: job.parent_job_id });
    case "parent_failed":
      return reason({ reason: "parent_failed", text: `The parent job "${parent?.title ?? job.parent_job_id}" ended ${parent?.state ?? "without success"}: resume the parent or stop this job`, jobId: job.parent_job_id });
    case "concurrency":
      return reason({ reason: "concurrency", text: "Waits for a free job slot" });
    case "disk":
      return reason({ reason: "disk", text: `Free disk is below ${ctx.settings.minFreeDiskGb} GB` });
    case "network":
      return reason({ reason: "network", text: `Could not fetch ${job.target} from the forge: no network or the forge is down; retrying`, account });
    case "auth":
      return reason({ reason: "auth", text: `Could not fetch ${job.target}: the login of account ${account ?? "?"} expired or does not match; log in and recheck`, account });
    default:
      return globalPause ? reason({ reason: "global_pause", text: "The global pause is on: queued jobs do not start" }) : reason({ reason: "scheduler", text: "Waits for the scheduler" });
  }
}

function runReason(ctx: ProjectContext, r: WaitingRun): WhyReason {
  const base = { nodeRunId: r.id, until: r.reset_at, queueItemId: r.queue_item_id };
  const account = r.auth_account ?? (ctx.db.db.prepare("SELECT account FROM attempts WHERE node_run_id = ? ORDER BY started_at DESC LIMIT 1").get(r.id) as { account: string | null } | undefined)?.account ?? null;
  const n = r.node;
  switch (r.waiting_reason) {
    case "concurrency":
      return reason({ ...base, reason: "concurrency", text: `Node ${n} waits for a free slot` });
    case "quota":
      return reason({ ...base, account, reason: "quota", text: `Node ${n} waits for the quota of account ${account ?? "?"}${r.reset_at ? "" : " (reset time unknown)"}` });
    case "rate_limit":
      return reason({ ...base, account, reason: "rate_limit", text: `Node ${n} waits for the rate limit of account ${account ?? "?"}` });
    case "budget":
      return reason({ ...base, reason: "budget", text: `Node ${n}: a former project budget was reached` });
    case "human": {
      const item = ctx.db.db.prepare("SELECT kind, subject ->> '$.mode' AS mode FROM human_queue WHERE id = ?").get(r.queue_item_id) as { kind: string; mode: string | null } | undefined;
      const response: string = item?.kind === "agent-question" ? "answer" : item?.mode === "decision" ? "decision" : "review";
      return reason({ ...base, reason: "human", text: `Node ${n} waits for your ${response} in the Inbox` });
    }
    case "services":
      return reason({ ...base, reason: "services", text: `Node ${n} waits for the job's services to be healthy` });
    case "round_limit":
      return reason({ ...base, reason: "round_limit", text: `Node ${n}: the round limit is reached; allow more rounds or fail the job in the Inbox` });
    case "network":
      return reason({ ...base, account, reason: "network", text: `Node ${n} cannot reach the forge: no network or the forge is down; retrying` });
    case "auth":
      return reason({ ...base, account, reason: "auth", text: `Node ${n}: the login of account ${account ?? "?"}${r.auth_os_user ? ` for user ${r.auth_os_user}` : ""} expired or does not match; log in and recheck` });
    case "disk":
      return reason({ ...base, reason: "disk", text: `Node ${n}: free disk is below ${ctx.settings.minFreeDiskGb} GB` });
    default:
      return reason({ ...base, reason: r.waiting_reason ?? "unknown", text: `Node ${n} waits (${r.waiting_reason ?? "no reason recorded"})` });
  }
}

export function whyJob(ctx: ProjectContext, job: JobRow, globalPause: boolean): WhyView {
  const reasons: WhyReason[] = [];
  if (job.state === "queued") reasons.push(queuedReason(ctx, job, globalPause));
  if (job.state === "paused")
    reasons.push(job.waiting_reason === "quit" ? reason({ reason: "quit", text: "Paused when the app quit: press Play to continue" }) : reason({ reason: "user", text: "Paused by you: press Play to continue" }));
  if (job.state === "stopped" && job.failure_reason === "AGENT_UNAVAILABLE") {
    const stopped = ctx.db.events(job.id).findLast((event) => event.type === "job.state_changed");
    reasons.push(reason({ reason: "AGENT_UNAVAILABLE", text: stopped?.payload.detail ?? "Agent unavailable." }));
  }
  if (job.state === "waiting") {
    if (job.waiting_reason === "ci") reasons.push(reason({ reason: "ci", text: "Waits for CI on the published commit" }));
    if (job.waiting_reason === "ci_head") {
      const item = ctx.db.db.prepare("SELECT id FROM human_queue WHERE job_id = ? AND kind = 'ci-head' AND state = 'open'").get(job.id) as { id: string } | undefined;
      reasons.push(reason({ reason: "ci_head", queueItemId: item?.id ?? null, text: "The pull request head changed. Review the expected and actual commits in the Inbox" }));
    }
    const runs = ctx.db.db
      .prepare("SELECT id, node, waiting_reason, reset_at, queue_item_id, auth_account, auth_os_user FROM node_runs WHERE job_id = ? AND state = 'waiting' ORDER BY rowid")
      .all(job.id) as WaitingRun[];
    for (const r of runs) reasons.push(runReason(ctx, r));
  }
  return { jobId: job.id, state: job.state, reasons };
}
