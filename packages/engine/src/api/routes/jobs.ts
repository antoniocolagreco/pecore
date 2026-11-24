import type { AttemptView, JobView, NodeRunView } from "@pecore/schemas";
import { JobCreateError } from "../../jobs/create";
import type { JobRow } from "../../graph/executor";
import type { Engine } from "../../main";
import { NotFoundError } from "../../main";
import { setupJobId } from "../../projects/create";
import { HttpError } from "../server";
import type { Handlers } from "../server";

type JobDbRow = JobRow & { created_at: number; updated_at: number };

export function jobView(projectId: string, r: JobDbRow): JobView {
  return {
    id: r.id,
    projectId,
    title: r.title,
    recipe: (JSON.parse(r.recipe) as { name: string }).name,
    state: r.state,
    waitingReason: r.waiting_reason,
    failureReason: r.failure_reason,
    parentJobId: r.parent_job_id,
    baseBranch: r.base_branch,
    base: r.base,
    target: r.target,
    branch: r.branch,
    archived: r.archived === 1,
    mergedAt: r.merged_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

type NodeRunDbRow = {
  id: string;
  node: string;
  round: number;
  state: NodeRunView["state"];
  outcome: string | null;
  waiting_reason: string | null;
  reset_at: number | null;
  queue_item_id: string | null;
  auth_account: string | null;
  auth_os_user: string | null;
  auth_kind: "harness" | "tool" | null;
  failure_reason: string | null;
  started_at: number | null;
  ended_at: number | null;
};

function nodeRunView(r: NodeRunDbRow): NodeRunView {
  return {
    id: r.id,
    node: r.node,
    round: r.round,
    state: r.state,
    outcome: r.outcome,
    waitingReason: r.waiting_reason,
    resetAt: r.reset_at,
    queueItemId: r.queue_item_id,
    auth: r.auth_account !== null && r.auth_os_user !== null && r.auth_kind !== null ? { account: r.auth_account, osUser: r.auth_os_user, kind: r.auth_kind } : null,
    failureReason: r.failure_reason,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

type AttemptDbRow = {
  id: string;
  node_run_id: string;
  profile: string | null;
  model: string | null;
  account: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  cost: number | null;
  end_reason: string | null;
  started_at: number;
  ended_at: number | null;
};

function attemptView(r: AttemptDbRow): AttemptView {
  return {
    id: r.id,
    nodeRunId: r.node_run_id,
    profile: r.profile,
    model: r.model,
    account: r.account,
    tokens: { input: r.tokens_in, output: r.tokens_out, cacheRead: r.cache_read, cacheWrite: r.cache_write },
    cost: r.cost,
    endReason: r.end_reason,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

async function control(fn: () => Promise<unknown>): Promise<{ ok: true }> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof HttpError) throw e;
    throw new HttpError("conflict", (e as Error).message);
  }
  return { ok: true };
}

export function jobHandlers(engine: Engine) {
  const job = (id: string) => engine.findJob(id);
  return {
    listJobs: async ({ query }) => {
      const out: JobView[] = [];
      for (const [projectId, { ctx }] of engine.projects) {
        if (query.project !== undefined && query.project !== projectId) continue;
        const rows = ctx.db.db.prepare("SELECT * FROM jobs WHERE id != ? ORDER BY id").all(setupJobId) as JobDbRow[];
        for (const r of rows) if (query.archived === undefined || (r.archived === 1) === (query.archived === "true")) out.push(jobView(projectId, r));
      }
      return out;
    },
    getJob: async ({ params }) => {
      const { ctx, executor, job: row } = job(params.id);
      const db = ctx.db.db;
      return {
        job: jobView(ctx.id, row as JobDbRow),
        nodeRuns: (db.prepare("SELECT * FROM node_runs WHERE job_id = ? ORDER BY rowid").all(row.id) as NodeRunDbRow[]).map(nodeRunView),
        attempts: (db.prepare("SELECT a.* FROM attempts a JOIN node_runs n ON a.node_run_id = n.id WHERE n.job_id = ? ORDER BY a.started_at").all(row.id) as AttemptDbRow[]).map(attemptView),
        artifacts: executor.artifacts(row.id),
      };
    },
    whyJob: async ({ params }) => engine.why(params.id),
    getArtifact: async ({ params }) => {
      const { ctx, executor } = job(params.job);
      const artifact = executor.artifacts(params.job).find((a) => a.jobId === params.job && a.run === params.run && a.name === params.name);
      const label: string = `${params.job}/${params.run}/${params.name}`;
      if (!artifact) throw new NotFoundError(`artifact ${label} not found`);
      const bytes: Buffer | undefined = ctx.db.artifactContent(artifact);
      if (bytes === undefined) throw new HttpError("gone", `artifact ${label} was removed`);
      return artifact.type === "attachment"
        ? { artifact, content: bytes.toString("base64"), encoding: "base64" }
        : { artifact, content: bytes.toString("utf8") };
    },
    createJob: async ({ body }) => {
      if (!engine.projects.has(body.project)) throw new NotFoundError(`project ${body.project} not found`);
      try {
        const id = await engine.createJob(body.project, {
          title: body.title,
          ticket: body.ticket,
          parentJobId: body.parentJobId,
          ...(body.recipe !== undefined ? { recipe: body.recipe } : {}),
          ...(body.baseBranch !== undefined ? { baseBranch: body.baseBranch } : {}),
        });
        return { id };
      } catch (e) {
        if (e instanceof JobCreateError) throw new HttpError("bad_request", e.message);
        throw e;
      }
    },
    stopJob: async ({ params }) => control(() => job(params.id).executor.stop(params.id)),
    pauseJob: async ({ params }) => control(() => job(params.id).executor.pause(params.id)),
    playJob: async ({ params }) => control(() => job(params.id).executor.play(params.id)),
    resumeJob: async ({ params }) => control(() => job(params.id).executor.resume(params.id)),
    archiveJob: async ({ params }) => control(() => job(params.id).executor.archive(params.id)),
    deleteJob: async ({ params }) => control(() => job(params.id).executor.remove(params.id)),
    realignJob: async ({ params, body }) => {
      const { executor, job: row } = job(params.id);
      return control(() => executor.requestBaseChange(params.id, "realign", body.target ?? row.target));
    },
    checkMerge: async ({ params }) => ({ merged: await job(params.id).executor.checkMerge(params.id) }),
    pauseAll: async () => {
      await engine.pauseAll();
      return { ok: true };
    },
    playAll: async () => {
      await engine.playAll();
      return { ok: true };
    },
    playInterrupted: async () => {
      await engine.playInterrupted();
      return { ok: true };
    },
  } satisfies Partial<Handlers>;
}
