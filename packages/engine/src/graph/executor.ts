import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { monotonicFactory } from "ulid";
import type { RawLine, Usage } from "@pecore/agents";
import type { AgentSession, AgentNode, Artifact, ArtifactType, FailureReason, ForgeAccount, JobDefinitions, JobState, Node, NodeAgent, Project, Settings, WaitingReason } from "@pecore/schemas";
import { artifactTypes, defaultAgentId, DocumentArtifact, isHumanNode, Recipe, ReferenceArtifact, SpecArtifact } from "@pecore/schemas";
import { spawnFor } from "../accounts/agents";
import type { AgentServices } from "../accounts/agents";
import { knowledgeClosure } from "../definitions/knowledge";
import type { Definitions } from "../definitions/load";
import { jobDefinitions, jobNodes, snapshotDefinitions } from "../definitions/snapshot";
import { effectRecorder } from "../jobs/effects";
import { checkGithubCi, githubHead } from "../jobs/github-ci";
import type { JobAttachment } from "../jobs/create";
import { runAgentNode } from "../runners/agent";
import type { AgentContinuation, AgentInput, AgentQuestion } from "../runners/agent";
import { fetchBase, jobArtifacts, jobCommit, latestReference, reentryPending } from "../jobs/stacked";
import type { JobArtifact } from "../jobs/stacked";
import { outcomeOutputs, runCommandNode, runMergedCheck } from "../runners/command";
import type { CommandInput, CommandRun } from "../runners/command";
import { forgeEnv, identityOk, toolAccounts, ToolAuthError } from "../runners/forge-env";
import { humanArtifacts, humanItem, humanResult, subjectHash } from "../runners/human";
import { paramsWithDefaults } from "../runners/placeholders";
import { appUser, killJobProcesses, signalGroup, stopGroup } from "../runners/process";
import { enoughDisk } from "../scheduler/disk";
import type { Pools } from "../scheduler/pools";
import type { NewEvent, ProjectDb } from "../store/project-db";
import { resolveTicketOrder } from "../sources/poll";
import { contentState, deleteScratch, recordGit, restoreState, undoInterrupted } from "../workdir/content-state";
import type { GitRecord } from "../workdir/content-state";
import { gitAppResult, gitWork } from "../workdir/git-as";
import { writeFileAs } from "../workdir/fs-as";
import { setupJobId } from "../projects/create";
import { ProjectLocationConflict, withProjectLocation } from "../projects/location";
import { JobServices } from "../services/job-services";
import { branchHead, jobBranch } from "../workdir/repo";
import { addWorktree, recreateWorktree, removeWorktree, workdirOf } from "../workdir/worktrees";
import { assertTransition, isFinal } from "./job-machine";
import { nextStep, reenterOnBaseChange } from "./rules";
import type { Allowances, RunRecord } from "./rules";

const ulid = monotonicFactory();

export type JobRow = {
  id: string;
  title: string;
  recipe: string;
  state: JobState;
  waiting_reason: string | null;
  failure_reason: string | null;
  parent_job_id: string | null;
  base_branch: string;
  base: string;
  old_base: string;
  target: string;
  branch: string;
  archived: number;
  merged_at: number | null;
};

type NodeRunRow = {
  id: string;
  job_id: string;
  node: string;
  round: number;
  via_edge: number | null;
  state: string;
  outcome: string | null;
  waiting_reason: string | null;
  queue_item_id: string | null;
  content_before: string | null;
  content_after: string | null;
  git_before: string | null;
  pgid: number | null;
  os_user: string | null;
};

export type ProjectContext = {
  id: string;
  dir: string;
  templates: string;
  db: ProjectDb;
  project: Project;
  defs: Definitions;
  user: string;
  development?: boolean;
  settings: Settings;
  pools: Pools;
  notify(n: { kind: string; title: string; body: string; jobId: string }): void;
  changed(jobId: string): void;
  released(): void;
  agents: AgentServices | null;
  forgeAccount(id: string): ForgeAccount | undefined;
  setupEnded?: (state: JobState) => void;
  held?: () => boolean;
  agentCard(id: string): NodeAgent | undefined;
  agentContext(id: string): string;
  live?: (attemptId: string, line: RawLine) => void;
  orderAttachments?: (orderId: string, attachmentIds: string[]) => Promise<JobAttachment[]>;
  agentQuestion?: (itemId: string) => void;
  ciScheduled?: () => void;
};

type AttemptExtra = { usage?: Usage; model?: string; cost?: number | null; log: string };
type Attempt =
  | (AttemptExtra & { kind: "completed"; outcome: string; outputs: { type: ArtifactType; content: string }[]; quotaRejected?: { resetAt?: number } | null })
  | (AttemptExtra & { kind: "question"; pending: AgentQuestion; quotaRejected: { resetAt?: number } | null })
  | (AttemptExtra & { kind: "failed"; reason: FailureReason; retry?: false })
  | (AttemptExtra & { kind: "waiting"; reason: "network" | "quota" | "rate_limit" | "auth"; resetAt?: number });

type AgentProfile = NonNullable<NodeAgent["model"]> & { profile: string };
type QuestionSubject = AgentQuestion & {
  attemptId: string;
  nodeRunId: string;
  node: string;
  contentState: string;
  questionTree: string;
  git: GitRecord;
  profile: AgentProfile;
  osUser: string;
  connector: string;
  retries: number;
};
type QueueItem = Omit<Extract<NewEvent, { type: "queue.added" }>["payload"], "itemId">;
type CiCheck = Extract<NewEvent, { type: "job.ci_check" }>["payload"];

const backoffMs = [60_000, 120_000, 240_000, 480_000];

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function outputProblem(type: ArtifactType, content: string): string | null {
  const schema = artifactTypes[type].schema;
  if (type === "text" || type === "diff" || !schema) return null;
  try {
    const checked = schema.safeParse(JSON.parse(content));
    return checked.success ? null : checked.error.issues.map((issue) => `${issue.path.join(".") || "/"} ${issue.message}`).join("; ");
  } catch (e) {
    return (e as Error).message;
  }
}

function runDirName(nodeRunId: string): string {
  return nodeRunId.split("/")[1]!.replace("#", "-");
}

export class JobExecutor {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly pauseRequested = new Set<string>();
  private readonly stopRequested = new Set<string>();
  private readonly running = new Map<string, { pgid: number; user: string } | null>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly networkFailures = new Map<string, number>();
  private closing = false;

  readonly services: JobServices;

  constructor(readonly ctx: ProjectContext) {
    this.services = new JobServices(ctx.dir, () => ctx.project.services, () => ctx.settings.servicesRuntime);
    const requests = ctx.db.db.prepare("SELECT id, job_id FROM human_queue WHERE kind IN ('budget', 'engine-node', 'source-node', 'recipe-change', 'services', 'import') AND state = 'open'").all() as { id: string; job_id: string | null }[];
    const runs = ctx.db.db.prepare("SELECT id, job_id FROM node_runs WHERE state = 'waiting' AND waiting_reason IN ('budget', 'confirmation')").all() as { id: string; job_id: string }[];
    const jobs = ctx.db.db.prepare("SELECT id FROM jobs WHERE state = 'waiting' AND waiting_reason IN ('budget', 'confirmation')").all() as { id: string }[];
    const queued = ctx.db.db.prepare(`SELECT j.id FROM jobs j WHERE j.state = 'queued' AND (
      EXISTS (SELECT 1 FROM events e LEFT JOIN human_queue q ON q.id = json_extract(e.payload, '$.recipeConfirmationId')
        WHERE e.job_id = j.id AND e.type = 'job.created' AND json_type(e.payload, '$.recipeConfirmationId') = 'text'
        AND (q.id IS NULL OR q.state <> 'resolved' OR q.choice IS NOT 'confirm')) OR
      EXISTS (SELECT 1 FROM human_queue WHERE kind = 'import' AND state = 'open')
    )`).all() as { id: string }[];
    const stopped: Set<string> = new Set(queued.map(({ id }) => id));
    const children: JobRow[] = stopped.size > 0 ? this.jobs().filter(({ id, state, parent_job_id }) =>
      state === "queued" && parent_job_id !== null && stopped.has(parent_job_id) && !stopped.has(id)) : [];
    const events: NewEvent[] = [
      ...requests.map(({ id, job_id }): NewEvent => ({ jobId: job_id, type: "queue.resolved", payload: { itemId: id, state: "cancelled", choice: null, note: "This check was removed" } })),
      ...runs.map(({ id, job_id }): NewEvent => ({ jobId: job_id, type: "node_run.state_changed", payload: { nodeRunId: id, state: "waiting", waitingReason: "concurrency" } })),
      ...jobs.map(({ id }): NewEvent => ({ jobId: id, type: "job.state_changed", payload: { state: "paused", reason: "quit" } })),
      ...queued.map(({ id }): NewEvent => ({ jobId: id, type: "job.state_changed", payload: { state: "stopped", reason: null } })),
      ...children.map(({ id }): NewEvent => ({ jobId: id, type: "job.state_changed", payload: { state: "queued", reason: "parent_failed" } })),
    ];
    if (events.length) ctx.db.append(events);
  }

  job(id: string): JobRow {
    const row = this.ctx.db.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    if (!row) throw new Error(`job ${id} not found`);
    return row;
  }

  jobs(): JobRow[] {
    return this.ctx.db.db.prepare("SELECT * FROM jobs ORDER BY id").all() as JobRow[];
  }

  private runs(jobId: string): NodeRunRow[] {
    return this.ctx.db.db.prepare("SELECT * FROM node_runs WHERE job_id = ? ORDER BY rowid").all(jobId) as NodeRunRow[];
  }

  private setState(jobId: string, state: JobState, reason: string | null, cause?: "resume" | "base_change", detail?: string): void {
    const job = this.job(jobId);
    if (job.state === state && job.waiting_reason === reason) return;
    if (job.state !== state) assertTransition(job.state, state, { archived: job.archived === 1, ...(cause ? { cause } : {}) });
    this.ctx.db.append([{ jobId, type: "job.state_changed", payload: { state, reason, ...(detail ? { detail } : {}) } }]);
    this.ctx.changed(jobId);
    const log = (e: unknown) => console.error(`services of job ${jobId}:`, e);
    if (state === "paused") void this.services.stop(jobId).catch(log);
    if (isFinal(state)) void this.services.down(jobId).catch(log);
  }

  private setRun(jobId: string, nodeRunId: string, state: "waiting" | "running" | "interrupted" | "skipped", reason: WaitingReason | null, extra: { queueItemId?: string; pgid?: number; osUser?: string; resetAt?: number } = {}): void {
    this.ctx.db.append([{ jobId, type: "node_run.state_changed", payload: { nodeRunId, state, waitingReason: reason, ...extra } }]);
    this.ctx.changed(jobId);
  }

  private exclusive(jobId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.locks.get(jobId) ?? Promise.resolve();
    const next = prev.then(fn);
    this.locks.set(
      jobId,
      next.catch(() => undefined),
    );
    return next;
  }

  private crash(jobId: string, e: unknown): void {
    console.error(`job ${jobId}:`, e);
    try {
      const job = this.job(jobId);
      if (!isFinal(job.state) && job.state !== "queued") this.setState(jobId, "failed", "HARNESS_ERROR");
    } catch {
      return;
    }
  }

  recipe(job: JobRow): Recipe {
    return JSON.parse(job.recipe) as Recipe;
  }

  private nodeFor(recipe: Recipe, id: string, nodes: Map<string, Node>): Node {
    const r = recipe.nodes[id]!;
    const def = nodes.get(r.use);
    if (!def) throw new Error(`node instance ${r.use} not found`);
    return def;
  }

  private byId(recipe: Recipe, nodes: Map<string, Node>): Map<string, Node> {
    return new Map(Object.keys(recipe.nodes).map((id) => [id, this.nodeFor(recipe, id, nodes)]));
  }

  private history(jobId: string): RunRecord[] {
    return this.runs(jobId)
      .filter((r) => (r.state === "completed" || r.state === "skipped") && r.outcome !== null)
      .map((r) => ({ nodeId: r.node, outcome: r.outcome!, viaEdge: r.via_edge }));
  }

  private allowances(jobId: string): Allowances {
    const edges: number[] = this.ctx.db.db.prepare<[string], number>(`
      SELECT json_extract(subject, '$.edge') FROM human_queue
      WHERE job_id = ? AND kind = 'round-limit' AND state = 'resolved' AND choice = 'allow'
        AND json_extract(subject, '$.cap') = 'maxRounds'`).pluck().all(jobId);
    const a: Allowances = { extraRounds: {} };
    for (const edge of edges) {
      a.extraRounds[edge] = (a.extraRounds[edge] ?? 0) + 1;
    }
    return a;
  }

  artifacts(jobId: string): Artifact[] {
    return jobArtifacts(this.ctx.db.events(jobId)).map(({ artifact }) => artifact);
  }

  private ticket(jobId: string): Artifact | undefined {
    return jobArtifacts(this.ctx.db.events(jobId)).find(({ artifact, node }) => node === null && artifact.type === "document")?.artifact;
  }

  private latestDiff(jobId: string): Artifact | undefined {
    return this.artifacts(jobId).findLast(({ type }) => type === "diff");
  }

  private readArtifacts(jobId: string, reads: string[]): JobArtifact[] {
    const latest = new Map<string, JobArtifact>();
    for (const found of jobArtifacts(this.ctx.db.events(jobId))) {
      if (found.node !== null && reads.includes(found.node) && found.artifact.type !== "attachment") latest.set(`${found.node}:${found.artifact.type}`, found);
    }
    return reads.flatMap((read) => [...latest.values()].filter(({ node }) => node === read));
  }

  private saveArtifact(jobId: string, run: string, type: ArtifactType, content: string, state: string | null, name: string = type): Artifact {
    const ext: string = type === "diff" ? "patch" : type === "text" ? "txt" : "json";
    return this.ctx.db.saveArtifact(jobId, run, `${name}.${ext}`, type, content, state);
  }

  tick(jobId: string): Promise<void> {
    return this.exclusive(jobId, () => this.advance(jobId)).catch((e: unknown) => this.crash(jobId, e));
  }

  private async advance(jobId: string): Promise<void> {
    while (!this.closing) {
      const job = this.job(jobId);
      if (job.state === "queued") {
        if (!(await this.startJob(job))) return;
        continue;
      }
      if (job.state !== "running" || this.stopRequested.has(jobId)) return;
      if (this.pauseRequested.delete(jobId)) {
        this.setState(jobId, "paused", "user");
        return;
      }
      const recipe = this.recipe(job);
      const definitions: JobDefinitions | null = jobDefinitions(this.ctx.db, jobId);
      const nodes: Map<string, Node> = jobNodes(definitions, this.ctx.defs.nodes);
      const runs = this.runs(jobId);
      const open = runs.find((r) => r.state === "pending" || r.state === "waiting" || r.state === "running");
      if (open) {
        const done = await this.runNode(job, recipe, open, nodes, definitions);
        if (!done) return;
        continue;
      }
      const history: RunRecord[] = this.history(jobId);
      const last: RunRecord | undefined = history.at(-1);
      const reentry: boolean = reentryPending(this.ctx.db.events(jobId), recipe.onBaseChanged);
      if (!reentry && recipe.ci && last?.nodeId === recipe.ci.after && last.outcome === recipe.ci.on) {
        const run: NodeRunRow = runs.findLast((entry) => entry.node === last.nodeId && entry.state === "completed")!;
        const check: CiCheck | null = await this.waitForCi(job, recipe.ci, run.id);
        if (!check || check.result === "pending") return;
        last.outcome = check.result;
      }
      const d = reentry
        ? reenterOnBaseChange(recipe, history)!
        : nextStep(recipe, this.byId(recipe, nodes), history, this.allowances(jobId));
      if (d.kind === "end") {
        await this.finish(job, d.state, d.reason);
        return;
      }
      if (d.kind === "invalid_route") {
        await this.finish(job, "failed", d.reason);
        return;
      }
      if (d.kind === "round_limit") {
        const subject = { edge: d.edge, cap: d.cap, jobId };
        this.ctx.db.append([{ jobId, type: "queue.added", payload: { itemId: ulid(), kind: "round-limit", subject, subjectHash: sha256(JSON.stringify(subject)), choices: ["allow", "end"] } }]);
        this.setState(jobId, "waiting", "round_limit");
        this.ctx.notify({ kind: "needs-user", title: job.title, body: "The job reached a round limit", jobId });
        return;
      }
      const total = runs.filter((r) => r.node === d.nodeId).length;
      const nodeRunId = `${jobId}/${d.nodeId}#${total}`;
      this.ctx.db.append([{ jobId, type: "node_run.created", payload: { nodeRunId, node: d.nodeId, round: d.round, viaEdge: d.viaEdge } }]);
    }
  }

  private async startJob(job: JobRow): Promise<boolean> {
    if (job.waiting_reason === "parent_job" || job.waiting_reason === "parent_failed") return false;
    if (job.waiting_reason === "confirmation" && job.parent_job_id) {
      const parent: JobRow = this.job(job.parent_job_id);
      if (parent.merged_at === null && (parent.state !== "succeeded" || !jobCommit(this.ctx.db, this.ctx.db.events(parent.id)))) {
        this.setState(job.id, "queued", isFinal(parent.state) && parent.state !== "succeeded" ? "parent_failed" : "parent_job");
        return false;
      }
    }
    if (job.waiting_reason === "confirmation") this.setState(job.id, "queued", null);
    if (job.id !== setupJobId && this.ctx.held?.()) return false;
    if (!(await enoughDisk(this.ctx.dir, this.ctx.settings.minFreeDiskGb))) {
      if (job.waiting_reason !== "disk") this.ctx.db.append([{ jobId: job.id, type: "job.state_changed", payload: { state: "queued", reason: "disk" } }]);
      return false;
    }
    const base = await this.freshBase(job);
    if (base === null) return false;
    const wd: string = await addWorktree(this.ctx.user, this.ctx.dir, job.id, base);
    this.setState(job.id, "running", null);
    await this.copyAttachments(job.id, wd);
    return true;
  }

  private async freshBase(job: JobRow): Promise<string | null> {
    const repo = this.ctx.project.repo;
    if (job.id === setupJobId || job.target.startsWith(jobBranch(""))) return job.base;
    if (repo === null) {
      if (this.ctx.project.folder === null) return job.base;
      const local: string = await fetchBase(this.ctx, job.target).catch(() => job.base);
      if (local !== job.base) this.ctx.db.append([{ jobId: job.id, type: "job.base_changed", payload: { cause: "fetched", base: local, oldBase: local, target: job.target } }]);
      return local;
    }
    if ((job.waiting_reason === "network" || job.waiting_reason === "auth") && this.timers.has(job.id)) return null;
    let head: string;
    try {
      head = await fetchBase(this.ctx, job.target);
    } catch (e) {
      const account = this.ctx.forgeAccount(repo.account);
      const auth = e instanceof ToolAuthError || (account !== undefined && !(await identityOk(account)));
      const reason = auth ? "auth" : "network";
      const delay = this.backoff(job.id);
      this.ctx.db.append([{ jobId: job.id, type: "job.state_changed", payload: { state: "queued", reason } }]);
      this.ctx.changed(job.id);
      if (auth && job.waiting_reason !== "auth") this.ctx.notify({ kind: "login", title: job.title, body: `the login of ${repo.account} expired or does not match`, jobId: job.id });
      this.timers.set(
        job.id,
        setTimeout(() => {
          this.timers.delete(job.id);
          void this.tick(job.id);
        }, delay),
      );
      return null;
    }
    this.networkFailures.delete(job.id);
    if (head !== job.base) this.ctx.db.append([{ jobId: job.id, type: "job.base_changed", payload: { cause: "fetched", base: head, oldBase: head, target: job.target } }]);
    return head;
  }

  private async finish(job: JobRow, state: "succeeded" | "not_delivered" | "failed", reason: string | null): Promise<void> {
    if (state !== "failed") await removeWorktree(this.ctx.user, this.ctx.dir, workdirOf(this.ctx.dir, job.id));
    if (state !== "failed") await this.copyToFolder(job);
    this.setState(job.id, state, reason);
    this.ctx.notify({ kind: "job-finished", title: job.title, body: `${state}${reason ? `: ${reason}` : ""}`, jobId: job.id });
    this.ended(job.id);
  }

  private async copyToFolder(job: JobRow): Promise<void> {
    const folder: string | null = this.ctx.project.folder;
    const repo: string = join(this.ctx.dir, "repo.git");
    const branch: string = jobBranch(job.id);
    if (folder === null || job.id === setupJobId || !(await branchHead(repo, branch))) return;
    const pushed = await gitAppResult(repo, ["push", "-q", "--force", "--no-verify", folder, `refs/heads/${branch}:refs/heads/${branch}`]);
    if (pushed.code !== 0) this.ctx.notify({ kind: "folder", title: job.title, body: `${branch} was not copied to ${folder}: ${pushed.stderr.trim()}`, jobId: job.id });
  }

  private children(parentId: string): JobRow[] {
    return this.ctx.db.db.prepare("SELECT * FROM jobs WHERE parent_job_id = ? ORDER BY id").all(parentId) as JobRow[];
  }

  async createSetupJob(createRepo: string): Promise<void> {
    if (this.ctx.db.db.prepare("SELECT 1 FROM jobs WHERE id = ?").get(setupJobId)) return;
    const node = this.ctx.defs.nodes.get(createRepo);
    if (!node || node.kind !== "command") throw new Error(`repo creation node ${createRepo} not found`);
    const recipe = Recipe.parse({
      name: setupJobId,
      description: "Create the remote repository",
      start: "create",
      successOutcomes: node.outcomes.filter((o) => !node.failOutcomes.includes(o)).map((o) => `create:${o}`),
      nodes: { create: { use: createRepo } },
    });
    const baseBranch = this.ctx.project.baseBranch;
    const base = await branchHead(join(this.ctx.dir, "repo.git"), baseBranch);
    if (!base) throw new Error(`branch ${baseBranch} not found`);
    const definitions: JobDefinitions = await snapshotDefinitions(recipe, new Map([[createRepo, node]]), this.ctx.defs.nodeDir, this.ctx.defs.sidecars);
    this.ctx.db.append([{ jobId: setupJobId, type: "job.created", payload: { title: "Create the remote repository", recipe, definitions, ticket: null, parentJobId: null, baseBranch, base, target: baseBranch, branch: jobBranch(setupJobId) } }]);
    this.ctx.changed(setupJobId);
    void this.tick(setupJobId);
  }

  private ended(parentId: string): void {
    const parent = this.job(parentId);
    if (parentId === setupJobId) this.ctx.setupEnded?.(parent.state);
    void this.applyBaseChange(parentId).catch((e: unknown) => console.error(`base change of job ${parentId}:`, e));
    for (const child of this.children(parentId)) {
      if (child.state !== "queued") continue;
      if (parent.state === "succeeded") void this.startChild(parentId, child.id);
      else if (child.waiting_reason !== "parent_failed") {
        this.ctx.db.append([{ jobId: child.id, type: "job.state_changed", payload: { state: "queued", reason: "parent_failed" } }]);
        this.ctx.changed(child.id);
        this.ctx.notify({ kind: "needs-user", title: child.title, body: `its parent job ended ${parent.state}`, jobId: child.id });
      }
    }
  }

  private async startChild(parentId: string, childId: string): Promise<void> {
    const sha = jobCommit(this.ctx.db, this.ctx.db.events(parentId));
    if (!sha) return;
    await this.exclusive(childId, async () => {
      const child = this.job(childId);
      if (child.state !== "queued") return;
      this.ctx.db.append([
        { jobId: childId, type: "job.base_changed", payload: { cause: "parent_commit", base: sha, oldBase: sha, target: child.target } },
        { jobId: childId, type: "job.state_changed", payload: { state: "queued", reason: null } },
      ]);
      this.ctx.changed(childId);
    });
    void this.tick(childId);
  }

  private parentCommitted(parentId: string, sha: string): void {
    for (const child of this.children(parentId)) {
      if (child.state !== "queued") void this.requestBaseChange(child.id, "parent_commit", child.target, sha).catch((e: unknown) => this.crash(child.id, e));
    }
  }

  private idle(job: JobRow): boolean {
    return job.state === "queued" || isFinal(job.state);
  }

  async requestBaseChange(jobId: string, cause: "parent_commit" | "parent_merged" | "realign", target: string, base: string | null = null): Promise<void> {
    const job = this.job(jobId);
    if (cause === "realign" && !this.idle(job)) throw new Error(`job ${jobId} is ${job.state}; its base can change only when it is stopped or finished`);
    this.ctx.db.append([{ jobId, type: "job.base_change_requested", payload: { cause, base, target } }]);
    this.ctx.changed(jobId);
    await this.applyBaseChange(jobId);
  }

  private pendingBaseChange(jobId: string) {
    let pending = null;
    for (const e of this.ctx.db.events(jobId)) {
      if (e.type === "job.base_change_requested") pending = e.payload;
      if (e.type === "job.base_changed") pending = null;
    }
    return pending;
  }

  private async applyBaseChange(jobId: string): Promise<void> {
    let reentered = false;
    await this.exclusive(jobId, () => withProjectLocation(this.ctx, async () => {
      const job = this.job(jobId);
      const request = this.pendingBaseChange(jobId);
      if (!request || !this.idle(job)) return;
      const repo = join(this.ctx.dir, "repo.git");
      const base = request.base ?? (request.target.startsWith(jobBranch("")) ? await branchHead(repo, request.target) : await fetchBase(this.ctx, request.target));
      if (!base) throw new Error(`branch ${request.target} not found`);
      const changed = { jobId, type: "job.base_changed" as const, payload: { cause: request.cause, base, oldBase: job.base, target: request.target } };
      if (job.state === "queued" || this.recipe(job).onBaseChanged === undefined) {
        this.ctx.db.append([changed]);
        this.ctx.changed(jobId);
        return;
      }
      const worktrees = await gitWork(this.ctx.user, this.ctx.dir, [`--git-dir=${repo}`, "worktree", "list", "--porcelain"]);
      if (!worktrees.includes(`worktree ${workdirOf(this.ctx.dir, jobId)}\n`)) {
        const wd: string = await recreateWorktree(this.ctx.user, this.ctx.dir, jobId);
        await this.copyAttachments(jobId, wd);
      }
      this.ctx.db.append([changed, ...(job.archived ? [{ jobId, type: "job.unarchived" as const, payload: {} }] : [])]);
      this.setState(jobId, "running", null, "base_change");
      reentered = true;
    }));
    if (reentered) void this.tick(jobId);
  }

  async checkMerges(): Promise<void> {
    for (const job of this.jobs()) {
      if (job.merged_at !== null) continue;
      await this.checkMerge(job.id).catch((e: unknown) => {
        if (!(e instanceof ProjectLocationConflict)) console.error(`merge check of job ${job.id}:`, e);
      });
    }
  }

  async checkCi(): Promise<void> {
    for (const job of this.jobs()) {
      if (job.state !== "waiting" || job.waiting_reason !== "ci") continue;
      await this.pollCi(job.id).catch((error: unknown) => {
        if (error instanceof ProjectLocationConflict) return;
        const current: JobRow = this.job(job.id);
        if (current.state === "waiting" && current.waiting_reason === "ci") this.setState(job.id, "running", null);
        this.crash(job.id, error);
      });
    }
  }

  nextCiCheck(): number | null {
    const row = this.ctx.db.db.prepare(`SELECT min(next_check) AS next_check FROM (
      SELECT (SELECT min(payload ->> '$.nextCheck', payload ->> '$.deadline') FROM events
        WHERE job_id = j.id AND type = 'job.ci_check' ORDER BY id DESC LIMIT 1) AS next_check
      FROM jobs j WHERE state = 'waiting' AND waiting_reason = 'ci'
    )`).get() as { next_check: number | null };
    return row.next_check;
  }

  private ciCheck(jobId: string): CiCheck | null {
    const row = this.ctx.db.db.prepare("SELECT payload FROM events WHERE job_id = ? AND type = 'job.ci_check' ORDER BY id DESC LIMIT 1").get(jobId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as CiCheck : null;
  }

  private async waitForCi(job: JobRow, ci: NonNullable<Recipe["ci"]>, runId: string): Promise<CiCheck | null> {
    const previous: CiCheck | null = this.ciCheck(job.id);
    if (previous?.runId === runId && previous.result !== "pending") return previous;
    if (previous?.runId !== runId) {
      const events = this.ctx.db.events(job.id);
      const commit: string | null = jobCommit(this.ctx.db, events);
      const link: string | undefined = latestReference(this.ctx.db, jobArtifacts(events), (reference, node) => node === ci.after && reference.url !== undefined)?.reference.url;
      const pullRequest: number = Number(link ? /\/pull\/(\d+)\/?$/.exec(link)?.[1] : undefined);
      const account: ForgeAccount | undefined = this.ctx.project.repo ? this.ctx.forgeAccount(this.ctx.project.repo.account) : undefined;
      if (!commit || !Number.isSafeInteger(pullRequest) || pullRequest < 1 || account?.forge !== "github") {
        throw new Error("CI needs a saved commit and a GitHub pull request");
      }
      const now: number = Date.now();
      this.ctx.db.append([{ jobId: job.id, type: "job.ci_check", payload: {
        runId, commit, pullRequest, deadline: previous?.deadline ?? now + ci.timeoutSec * 1000, nextCheck: now,
        corrections: previous?.corrections ?? 0, result: "pending",
      } }]);
    }
    this.setState(job.id, "waiting", "ci");
    this.ctx.ciScheduled?.();
    return null;
  }

  private async pollCi(jobId: string): Promise<void> {
    await this.exclusive(jobId, () => withProjectLocation(this.ctx, async () => {
      const job: JobRow = this.job(jobId);
      const check: CiCheck | null = this.ciCheck(jobId);
      const config: Recipe["ci"] = this.recipe(job).ci;
      if (job.state !== "waiting" || job.waiting_reason !== "ci" || !check || !config) return;
      const now: number = Date.now();
      if (check.result !== "pending") {
        this.setState(jobId, "running", null);
        void this.tick(jobId);
        return;
      }
      if (check.deadline > now && check.nextCheck > now) return;
      const repo: Project["repo"] = this.ctx.project.repo;
      const account: ForgeAccount | undefined = repo ? this.ctx.forgeAccount(repo.account) : undefined;
      const result = now < check.deadline && repo && account?.forge === "github"
        ? await checkGithubCi({ account, url: repo.url, dir: this.ctx.dir, pullRequest: check.pullRequest, commit: check.commit,
          checks: config.checks, timeoutMs: Math.min(30_000, check.deadline - now) }).catch(() => ({ state: "pending" as const }))
        : { state: "pending" as const };
      if (this.closing) return;
      if (result.state === "changed") {
        this.holdCiHead(job, check, result.head);
        return;
      }
      const next: CiCheck = { ...check, nextCheck: Date.now() + config.intervalSec * 1000 };
      if (Date.now() >= check.deadline) next.result = "ci_timeout";
      else if (result.state === "passed") next.result = "ci_passed";
      else if (result.state === "failed") {
        next.result = check.corrections >= config.maxCorrections ? "ci_exhausted" : "ci_failed";
        if (next.result === "ci_failed") next.corrections += 1;
        next.log = this.saveArtifact(jobId, `${runDirName(check.runId)}-ci`, "text", result.report, null);
      }
      this.ctx.db.append([{ jobId, type: "job.ci_check", payload: next }]);
      if (next.result !== "pending") {
        this.setState(jobId, "running", null);
        void this.tick(jobId);
      }
    }));
  }

  private holdCiHead(job: JobRow, check: CiCheck, actual: string): void {
    const subject = { expected: check.commit, actual, pullRequest: check.pullRequest };
    this.ctx.db.append([
      { jobId: job.id, type: "queue.added", payload: { itemId: ulid(), kind: "ci-head", subject, subjectHash: subjectHash(subject), choices: ["recheck", "stop"] } },
      { jobId: job.id, type: "job.state_changed", payload: { state: "waiting", reason: "ci_head" } },
    ]);
    this.ctx.changed(job.id);
    this.ctx.notify({ kind: "needs-user", title: job.title, body: "The pull request head changed", jobId: job.id });
  }

  async checkMerge(jobId: string): Promise<boolean> {
    return withProjectLocation(this.ctx, async () => {
      const job = this.job(jobId);
      if (job.merged_at !== null) return true;
      const delivery: string | null = await this.mergedDelivery(job);
      if (delivery === null) return false;
      await this.deliveryMerged(job, delivery);
      return true;
    });
  }

  private async mergedDelivery(parent: JobRow): Promise<string | null> {
    const recipe: Recipe = this.recipe(parent);
    const definitions: JobDefinitions | null = jobDefinitions(this.ctx.db, parent.id);
    const nodes: Map<string, Node> = jobNodes(definitions, this.ctx.defs.nodes);
    const delivered = latestReference(this.ctx.db, jobArtifacts(this.ctx.db.events(parent.id)), (reference, id) => {
      if (id === null || !recipe.nodes[id] || (reference.url === undefined && reference.ref === undefined)) return false;
      const node: Node = this.nodeFor(recipe, id, nodes);
      return node.kind === "command" && node.mergedCheck !== undefined;
    });
    if (!delivered) return null;
    const nodeId: string = delivered.node!;
    const node = this.nodeFor(recipe, nodeId, nodes);
    if (node.kind !== "command" || !node.mergedCheck) return null;
    const env: Record<string, string> = {};
    for (const a of toolAccounts(node.credentials, this.ctx.project.repo?.account, this.ctx.forgeAccount, this.ctx.project.credentials)) Object.assign(env, await forgeEnv(a));
    const result = await runMergedCheck({
      node,
      nodeDir: this.ctx.defs.nodeDir,
      sidecars: definitions?.nodes[node.name]?.sidecars ?? this.ctx.defs.sidecars,
      params: paramsWithDefaults(node.params, recipe.nodes[nodeId]?.params),
      context: this.placeholderContext(parent),
      inputs: [{ type: "reference", content: this.ctx.db.requireArtifact(delivered.artifact).toString("utf8") }],
      extraEnv: env,
    });
    if (result !== "done") return null;
    return delivered.reference.url ?? delivered.reference.ref ?? null;
  }

  private async deliveryMerged(parent: JobRow, delivery: string): Promise<void> {
    this.ctx.db.append([{ jobId: parent.id, type: "job.delivery_merged", payload: { url: delivery } }]);
    this.ctx.changed(parent.id);
    for (const child of this.children(parent.id)) {
      this.ctx.notify({ kind: "job-finished", title: child.title, body: `its parent's delivery was merged into ${parent.target}`, jobId: child.id });
      await this.requestBaseChange(child.id, "parent_merged", parent.target);
    }
  }

  private requiresMet(jobId: string, recipe: Recipe, nodeId: string, current: string, nodes: Map<string, Node>): boolean {
    const runs = this.runs(jobId).filter((r) => r.state === "completed");
    for (const req of recipe.nodes[nodeId]!.requires) {
      const last = runs.filter((r) => r.node === req).at(-1);
      if (!last) return false;
      const node = this.nodeFor(recipe, req, nodes);
      const ok: boolean = isHumanNode(node) ? node.interface !== "decision" && last.outcome === "approve" : last.outcome === "passed";
      if (!ok || last.content_before !== current || last.content_after !== current) return false;
    }
    return true;
  }

  private waitForHuman(job: JobRow, run: NodeRunRow, item: QueueItem, body: string, events: NewEvent[] = []): string {
    const itemId: string = ulid();
    assertTransition(this.job(job.id).state, "waiting", { archived: job.archived === 1 });
    this.ctx.db.append([
      ...events,
      { jobId: job.id, type: "queue.added", payload: { itemId, ...item } },
      { jobId: job.id, type: "node_run.state_changed", payload: { nodeRunId: run.id, state: "waiting", waitingReason: "human", queueItemId: itemId } },
      { jobId: job.id, type: "job.state_changed", payload: { state: "waiting", reason: "human" } },
    ]);
    this.ctx.changed(job.id);
    this.ctx.notify({ kind: "needs-user", title: job.title, body, jobId: job.id });
    return itemId;
  }

  private agentQuestion(jobId: string, runId: string): { subject: QuestionSubject; answer: string | null } | null {
    const row = this.ctx.db.db.prepare(
      `SELECT q.subject, q.note FROM human_queue q JOIN attempts asked ON asked.id = json_extract(q.subject, '$.attemptId')
       WHERE q.job_id = ? AND asked.node_run_id = ? AND q.kind = 'agent-question'
         AND (q.state = 'open' OR (q.state = 'resolved' AND q.choice = 'answer'))
         AND NOT EXISTS (SELECT 1 FROM attempts later WHERE later.node_run_id = asked.node_run_id
           AND later.rowid > asked.rowid AND later.end_reason NOT IN ('quota', 'rate_limit', 'auth'))
       ORDER BY asked.rowid DESC LIMIT 1`,
    ).get(jobId, runId) as { subject: string; note: string | null } | undefined;
    return row ? { subject: JSON.parse(row.subject) as QuestionSubject, answer: row.note } : null;
  }

  private async runNode(job: JobRow, recipe: Recipe, run: NodeRunRow, nodes: Map<string, Node>, definitions: JobDefinitions | null): Promise<boolean> {
    const node = this.nodeFor(recipe, run.node, nodes);
    const sidecars: Readonly<Record<string, string>> | undefined = definitions?.nodes[node.name]?.sidecars ?? this.ctx.defs.sidecars;
    const recipeNode = recipe.nodes[run.node]!;
    const wd = workdirOf(this.ctx.dir, job.id);
    const runDir = runDirName(run.id);
    if (run.state === "waiting" && (run.waiting_reason === "human" || run.waiting_reason === "network")) return false;

    if (recipeNode.optional) {
      const spec: Artifact | undefined = this.artifacts(job.id).findLast(({ type }) => type === "spec");
      const named: string[] = spec ? SpecArtifact.safeParse(JSON.parse(this.ctx.db.requireArtifact(spec).toString("utf8"))).data?.optionalNodes ?? [] : [];
      if (!named.includes(run.node)) {
        this.ctx.db.append([{ jobId: job.id, type: "node_run.completed", payload: { nodeRunId: run.id, outcome: "skipped", contentBefore: null, contentAfter: null, artifacts: [] } }]);
        return true;
      }
    }

    const question = node.kind === "agent" ? this.agentQuestion(job.id, run.id) : null;
    const continuation: (QuestionSubject & AgentContinuation) | null = question?.answer != null ? { ...question.subject, answer: question.answer } : null;
    const before: string = continuation?.contentState ?? await contentState(this.ctx.user, wd);
    if (recipeNode.requires.length > 0 && !this.requiresMet(job.id, recipe, run.node, before, nodes)) {
      this.complete(job.id, run.id, "stale", before, before, []);
      return true;
    }

    if (isHumanNode(node)) {
      const { question } = paramsWithDefaults(node.params, recipeNode.params);
      const show: Artifact[] = humanArtifacts(node, this.latestDiff(job.id), this.readArtifacts(job.id, recipeNode.reads).map(({ artifact }) => artifact));
      const item = humanItem(run.id, run.node, node, show, before, question);
      this.waitForHuman(job, run, item, `${run.node} waits for your ${node.interface === "decision" ? "decision" : "review"}`);
      return false;
    }
    if (node.kind === "source") throw new Error("source nodes cannot run in a recipe");
    const previousCi: CiCheck | null = recipe.ci && node.kind === "command" && node.name === "git-push" ? this.ciCheck(job.id) : null;
    const repo: Project["repo"] = this.ctx.project.repo;
    const account: ForgeAccount | undefined = previousCi && repo ? this.ctx.forgeAccount(repo.account) : undefined;
    if (previousCi && repo && account?.forge === "github") {
      const updated: string | null = jobCommit(this.ctx.db, this.ctx.db.events(job.id));
      const actual: string | null = await githubHead({ account, url: repo.url, dir: this.ctx.dir, pullRequest: previousCi.pullRequest, timeoutMs: 15_000 }).catch(() => null);
      if (actual && actual !== updated && actual !== previousCi.commit) {
        this.holdCiHead(job, previousCi, actual);
        return false;
      }
    }

    let profile: AgentProfile | null = null;
    let pools: string[] = ["jobs"];
    const agentId: string = recipeNode.agentId ?? defaultAgentId;
    const agentSession: AgentSession | undefined = node.kind === "agent" ? recipeNode.agentSession ?? node.agentSession : undefined;
    if (node.kind === "agent") {
      const agents = this.ctx.agents;
      const card: NodeAgent | undefined = this.ctx.agentCard(agentId);
      const model: NodeAgent["model"] = card?.model ?? null;
      profile = continuation?.profile ?? (card && model
        ? { ...model, profile: `${card.id}:${createHash("sha256").update(JSON.stringify(model)).digest("hex")}` } : null);
      if (!profile || !agents) {
        const detail: string = !agents ? "No harness service is available."
          : !card ? `Agent card ${agentId} is unavailable.` : `Choose a provider and model on the ${card.name} card.`;
        this.fail(job, run.id, "AGENT_UNAVAILABLE", detail);
        return false;
      }
      const cooling = agents.cooling(profile.account);
      if (cooling) {
        this.waitUntil(job.id, run.id, cooling.kind, cooling.until);
        return false;
      }
      pools = ["jobs", "agents", `account:${profile.account}`];
    }

    let servicesEnv: Record<string, string> = {};
    if (job.id !== setupJobId) {
      servicesEnv = await this.services.ensure(job.id, job.base, () => {
        this.setRun(job.id, run.id, "waiting", "services");
        this.setState(job.id, "waiting", "services");
      });
      if (this.job(job.id).state === "waiting") this.setState(job.id, "running", null);
    }

    const tools: ForgeAccount[] = node.kind === "command" ? toolAccounts(node.credentials, this.ctx.project.repo?.account, this.ctx.forgeAccount, this.ctx.project.credentials) : [];
    const toolEnv: Record<string, string> = {};
    try {
      for (const a of tools) Object.assign(toolEnv, await forgeEnv(a));
    } catch (e) {
      if (!(e instanceof ToolAuthError)) throw e;
      this.waitAuth(job, run.id, e.account);
      return false;
    }

    if (!this.ctx.pools.tryTake(pools)) {
      if (run.waiting_reason !== "concurrency") this.setRun(job.id, run.id, "waiting", "concurrency");
      this.setState(job.id, "waiting", "concurrency");
      return false;
    }
    try {
      const attempts: number = (continuation?.retries ?? node.retry) + 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const resumed: (QuestionSubject & AgentContinuation) | null = attempt === 0 ? continuation : null;
        const attemptGit: GitRecord = await recordGit(this.ctx.user, wd, job.id);
        const git: GitRecord = resumed?.git ?? attemptGit;
        this.ctx.db.append([{ jobId: job.id, type: "node_run.git_recorded", payload: { nodeRunId: run.id, ...attemptGit } }]);
        this.setRun(job.id, run.id, "running", null, { osUser: this.ctx.user });
        const attemptId = ulid();
        this.ctx.db.append([
          {
            jobId: job.id,
            type: "attempt.started",
            payload: { attemptId, nodeRunId: run.id, profile: profile?.profile ?? null, connector: profile ? (this.ctx.agents!.account(profile.account)?.connector ?? null) : null, harnessVersion: null, connectorVersion: null, account: profile?.account ?? null, osUser: this.ctx.user, ...(agentSession && { agentId, agentSession }) },
          },
        ]);
        const context = this.placeholderContext(this.job(job.id));
        const read: JobArtifact[] = this.readArtifacts(job.id, recipeNode.reads);
        const commandInputs: CommandInput[] = node.kind !== "command" ? [] : [...node.inputs, ...node.optionalInputs].flatMap((type) => {
          const found: JobArtifact | undefined = read.find(({ artifact }) => artifact.type === type);
          return found ? [{ type, content: this.ctx.db.requireArtifact(found.artifact).toString("utf8") }] : [];
        });
        const ticket: Artifact | undefined = this.ticket(job.id);
        const diff: Artifact | undefined = this.latestDiff(job.id);
        const agentInputs: AgentInput[] = node.kind !== "agent" ? [] : [
          ...(ticket ? [{ artifact: ticket, node: null }] : []),
          ...(diff ? [{ artifact: diff, node: null }] : []),
          ...read,
        ].map(({ artifact, node: from }) => ({ type: artifact.type as ArtifactType, content: this.ctx.db.requireArtifact(artifact).toString("utf8"), from }));
        const onStart = (pgid: number, user: string) => {
          this.running.set(job.id, { pgid, user });
          if (this.stopRequested.has(job.id) || this.closing) void stopGroup(user, pgid);
          this.setRun(job.id, run.id, "running", null, { pgid, osUser: user });
        };
        this.running.set(job.id, null);
        const result: Attempt =
          node.kind === "command"
            ? await runCommandNode({
                node,
                outputs: outcomeOutputs(node),
                nodeDir: this.ctx.defs.nodeDir,
                sidecars,
                params: paramsWithDefaults(node.params, recipeNode.params),
                user: this.ctx.user,
                workdir: wd,
                context,
                inputs: commandInputs,
                cleanTree: node.cleanCheckout ? before : null,
                extraEnv: { ...servicesEnv, ...toolEnv, ...(previousCi ? { PECORE_CI_EXPECTED_HEAD: previousCi.commit } : {}) },
                onStart,
                effect: effectRecorder(this.ctx.db, job.id, run.id, run.node),
              })
            : await this.agentAttempt(job, run, node, recipeNode, profile!, attemptId, { id: agentId, session: agentSession! }, { wd, context, inputs: agentInputs, onStart, env: servicesEnv, continuation: resumed, sidecars, knowledge: definitions?.knowledgeByStep });
        this.running.delete(job.id);
        if (result.log) this.ctx.db.logs.write(attemptId, { dir: "cmd", text: result.log, at: Date.now() });
        if (this.closing) return false;
        const ended = (reason: string): NewEvent => ({
          jobId: job.id,
          type: "attempt.ended",
          payload: { attemptId, endReason: reason, model: result.model ?? profile?.model ?? null, account: profile?.account ?? null, tokens: result.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: result.cost ?? null },
        });
        const end = (reason: string): void => { this.ctx.db.append([ended(reason)]); };

        if (this.stopRequested.has(job.id)) {
          end("interrupted");
          await this.interrupt(job.id, run.id, git, before);
          return false;
        }
        if (result.kind === "question") {
          const subject: QuestionSubject = {
            ...result.pending,
            attemptId,
            nodeRunId: run.id,
            node: run.node,
            contentState: before,
            questionTree: await contentState(this.ctx.user, wd),
            git,
            profile: profile!,
            osUser: this.ctx.user,
            connector: this.ctx.agents!.account(profile!.account)!.connector,
            retries: attempts - attempt - 1,
          };
          if (result.quotaRejected) this.ctx.agents!.coolDown(profile!.account, "quota", result.quotaRejected.resetAt);
          const itemId: string = this.waitForHuman(job, run, { kind: "agent-question", subject, subjectHash: subjectHash(subject), choices: ["answer"] }, `${run.node} has a question`, [ended("human")]);
          this.ctx.agentQuestion?.(itemId);
          return false;
        }
        if (result.kind === "waiting") {
          end(result.reason);
          await undoInterrupted(this.ctx.user, wd, job.id, attemptGit, resumed?.questionTree ?? before);
          if (result.reason === "network") {
            const expired = (await Promise.all(tools.map(async (a) => ((await identityOk(a)) ? null : a.id)))).find((id) => id !== null);
            if (expired) this.waitAuth(job, run.id, expired);
            else {
              const delay = this.backoff(run.id);
              this.setRun(job.id, run.id, "waiting", "network", { resetAt: Date.now() + delay });
              this.setState(job.id, "waiting", "network");
              this.timers.set(job.id, setTimeout(() => void this.retryWait(job.id, run.id, "network"), delay));
            }
          } else if (result.reason === "auth") {
            this.ctx.db.append([{ jobId: job.id, type: "node_run.state_changed", payload: { nodeRunId: run.id, state: "waiting", waitingReason: "auth", auth: { account: profile!.account, osUser: this.ctx.user, kind: "harness" } } }]);
            this.setState(job.id, "waiting", "auth");
            this.ctx.notify({ kind: "login", title: job.title, body: `the login of ${profile!.account} expired or does not match`, jobId: job.id });
          } else {
            const until = this.ctx.agents!.coolDown(profile!.account, result.reason, result.resetAt);
            this.waitUntil(job.id, run.id, result.reason, until);
          }
          return false;
        }
        this.networkFailures.delete(run.id);
        if (result.kind === "failed") {
          end(result.reason);
          await undoInterrupted(this.ctx.user, wd, job.id, git, before);
          if (attempt + 1 < attempts && result.reason !== "INVALID_OUTPUT" && !("retry" in result && result.retry === false)) continue;
          this.saveArtifact(job.id, runDir, "text", result.log, before, "log");
          this.fail(job, run.id, result.reason, result.reason === "AGENT_UNAVAILABLE" ? result.log : undefined);
          return false;
        }
        end(result.outcome);
        if (result.quotaRejected && profile) this.ctx.agents!.coolDown(profile.account, "quota", result.quotaRejected.resetAt);
        await deleteScratch(this.ctx.user, wd, node.scratchPaths, before);
        const after = await contentState(this.ctx.user, wd);
        if (!node.changesFiles && after !== before) {
          await restoreState(this.ctx.user, wd, before);
          this.fail(job, run.id, "READ_ONLY_VIOLATION");
          return false;
        }
        const artifacts: Artifact[] = node.kind === "command" ? [this.saveArtifact(job.id, runDir, "text", result.log, after, "log")] : [];
        let committed: string | null = null;
        for (const o of result.outputs) {
          let content = o.content;
          const invalid: string | null = outputProblem(o.type, content);
          if (invalid) {
            this.saveArtifact(job.id, runDir, "text", `${result.log ?? ""}\nthe ${o.type} output is not valid: ${invalid}\n`, before, "log");
            this.fail(job, run.id, "INVALID_OUTPUT");
            return false;
          }
          if (o.type === "reference") {
            const reference = ReferenceArtifact.parse(JSON.parse(content));
            if (reference.sha !== undefined) {
              const tree = (await gitWork(this.ctx.user, wd, ["rev-parse", `${reference.sha}^{tree}`])).trim();
              if (tree !== before) {
                this.fail(job, run.id, "READ_ONLY_VIOLATION");
                return false;
              }
              committed = reference.sha;
              content = JSON.stringify({ ...reference, contentState: before });
            }
          }
          artifacts.push(this.saveArtifact(job.id, runDir, o.type, content, after, node.changesFiles && o.type === "diff" ? "output" : o.type));
        }
        if (node.changesFiles) {
          const diff = await gitWork(this.ctx.user, wd, ["diff", job.base, after]);
          artifacts.push(this.saveArtifact(job.id, runDir, "diff", diff, after));
        }
        this.complete(job.id, run.id, result.outcome, before, after, artifacts);
        if (committed) this.parentCommitted(job.id, committed);
        return true;
      }
      return false;
    } finally {
      this.ctx.pools.release(pools);
      this.ctx.released();
    }
  }

  private placeholderContext(job: JobRow): CommandRun["context"] {
    const ticket: Artifact | undefined = this.ticket(job.id);
    return {
      job: { id: job.id, title: job.title, branch: job.branch, base: job.base, oldBase: job.old_base, target: job.target, commit: jobCommit(this.ctx.db, this.ctx.db.events(job.id)) },
      ticketId: ticket ? DocumentArtifact.parse(JSON.parse(this.ctx.db.requireArtifact(ticket).toString("utf8"))).id ?? null : null,
      project: { repoDir: join(this.ctx.dir, "repo.git"), repoUrl: this.ctx.project.repo?.url ?? null, baseBranch: this.ctx.project.baseBranch },
    };
  }

  private backoff(nodeRunId: string): number {
    const n = this.networkFailures.get(nodeRunId) ?? 0;
    this.networkFailures.set(nodeRunId, n + 1);
    return backoffMs[Math.min(n, backoffMs.length - 1)]!;
  }

  private waitAuth(job: JobRow, nodeRunId: string, account: string): void {
    const delay = this.backoff(nodeRunId);
    this.ctx.db.append([{ jobId: job.id, type: "node_run.state_changed", payload: { nodeRunId, state: "waiting", waitingReason: "auth", resetAt: Date.now() + delay, auth: { account, osUser: appUser, kind: "tool" } } }]);
    this.setState(job.id, "waiting", "auth");
    this.ctx.notify({ kind: "login", title: job.title, body: `the login of ${account} expired or does not match`, jobId: job.id });
    this.timers.set(job.id, setTimeout(() => void this.retryWait(job.id, nodeRunId, "auth"), delay));
  }

  private resumeSession(run: NodeRunRow, agentId: string, session: Exclude<AgentSession, "new">, profile: string, connector: string): string | null {
    const attempts = this.ctx.db.db.prepare<[string, string], {
      profile: string; connector: string; os_user: string; agent_session: AgentSession | null; session_id: string; state: string; node: string; node_run_id: string;
    }>(`SELECT a.profile, a.connector, a.os_user, a.agent_session, a.session_id, n.state, n.node, a.node_run_id
        FROM attempts a JOIN node_runs n ON a.node_run_id = n.id
        WHERE n.job_id = ? AND a.agent_id = ? AND a.session_id IS NOT NULL
        ORDER BY a.id DESC`).iterate(run.job_id, agentId);
    for (const attempt of attempts) {
      if (attempt.profile !== profile || attempt.connector !== connector || attempt.os_user !== this.ctx.user) return null;
      if (attempt.node_run_id === run.id || attempt.agent_session !== session || attempt.state !== "completed") continue;
      if (session === "job" || attempt.node === run.node) return attempt.session_id;
    }
    return null;
  }

  private waitUntil(jobId: string, nodeRunId: string, reason: "quota" | "rate_limit", until: number): void {
    this.setRun(jobId, nodeRunId, "waiting", reason, { resetAt: until });
    this.setState(jobId, "waiting", reason);
    const t = this.timers.get(jobId);
    if (t) clearTimeout(t);
    this.timers.set(
      jobId,
      setTimeout(() => void this.release(jobId, [reason]), Math.max(0, until - Date.now()) + 1000),
    );
  }

  async releaseAuth(account: string, osUser: string | null): Promise<void> {
    for (const job of this.jobs()) {
      if (job.waiting_reason !== "auth") continue;
      if (job.state === "queued" && this.ctx.project.repo?.account === account) {
        clearTimeout(this.timers.get(job.id));
        this.timers.delete(job.id);
        void this.tick(job.id);
      }
      if (job.state !== "waiting") continue;
      const run = this.runs(job.id).find((r) => r.state === "waiting" && r.waiting_reason === "auth");
      const row = run ? (this.ctx.db.db.prepare("SELECT auth_account, auth_os_user FROM node_runs WHERE id = ?").get(run.id) as { auth_account: string | null; auth_os_user: string | null }) : null;
      if (row?.auth_account === account && (osUser === null || row.auth_os_user === osUser)) await this.release(job.id, ["auth"]);
    }
  }

  async release(jobId: string, reasons: string[]): Promise<void> {
    this.timers.delete(jobId);
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (job.state !== "waiting" || !reasons.includes(job.waiting_reason ?? "")) return;
      const open = this.runs(jobId).find((r) => r.state === "waiting");
      if (open) this.setRun(jobId, open.id, "waiting", "concurrency");
      this.setState(jobId, "running", null);
    });
    void this.tick(jobId);
  }

  private async knowledgeFiles(wanted: string[]): Promise<{ rel: string; abs: string }[]> {
    const root = join(this.ctx.dir, "knowledge");
    return (await knowledgeClosure(root, wanted)).map((rel) => ({ rel, abs: join(root, rel) }));
  }

  private async agentAttempt(
    job: JobRow,
    run: NodeRunRow,
    node: AgentNode,
    recipeNode: Recipe["nodes"][string],
    profile: AgentProfile,
    attemptId: string,
    agent: { id: string; session: AgentSession },
    x: { wd: string; context: CommandRun["context"]; inputs: AgentInput[]; onStart: (pgid: number, user: string) => void; env: Record<string, string>; continuation: (QuestionSubject & AgentContinuation) | null; sidecars: CommandRun["sidecars"]; knowledge: JobDefinitions["knowledgeByStep"] },
  ): Promise<Attempt> {
    const agents = this.ctx.agents!;
    const account = agents.account(profile.account);
    if (!account) return { kind: "failed", reason: "AGENT_UNAVAILABLE", retry: false, log: `Model account ${profile.account} is unavailable.` };
    if (x.continuation && (x.continuation.osUser !== this.ctx.user || x.continuation.connector !== account.connector)) {
      return { kind: "failed", reason: "HARNESS_ERROR", retry: false, log: "the project user or connector changed while the question was open" };
    }
    let connector;
    try {
      connector = await agents.resolve(account.connector);
    } catch (e) {
      return { kind: "failed", reason: "AGENT_UNAVAILABLE", retry: false, log: `${account.connector}: ${(e as Error).message}` };
    }
    const login = await agents.login(account.id);
    if (login.state.state === "logged_out") {
      return { kind: "failed", reason: "AGENT_UNAVAILABLE", retry: false, log: `Log in to ${account.connector} with account ${account.id}.` };
    }
    const spawn = spawnFor(this.ctx.user, { ...x.env, PECORE_JOB_ID: job.id });
    const resumeId: string | null = agent.session !== "new" && !x.continuation
      ? this.resumeSession(run, agent.id, agent.session, profile.profile, account.connector) : null;
    const attachments: string[] = await this.copyAttachments(job.id, x.wd);
    const r = await runAgentNode({
      node,
      nodeDir: this.ctx.defs.nodeDir,
      sidecars: x.sidecars,
      params: paramsWithDefaults(node.params, recipeNode.params),
      user: this.ctx.user,
      workdir: x.wd,
      context: x.context,
      inputs: x.inputs,
      attachments,
      knowledge: await this.knowledgeFiles(x.knowledge && Object.hasOwn(x.knowledge, run.node) ? x.knowledge[run.node]! : node.knowledge),
      development: this.ctx.development ?? false,
      agentContext: this.ctx.agentContext(agent.id),
      connector,
      login,
      spawn,
      model: profile.model,
      effort: profile.effort,
      resumeId,
      continuation: x.continuation ?? undefined,
      timeoutMs: node.timeoutSec * 1000,
      onStart: (pgid) => x.onStart(pgid, this.ctx.user),
      onSession: (sessionId, resumed) => this.ctx.db.append([{ jobId: job.id, type: "attempt.session_started", payload: { attemptId, sessionId, resumed } }]),
      onRaw: (line) => {
        this.ctx.db.logs.write(attemptId, line);
        this.ctx.live?.(attemptId, line);
      },
    });
    const usage = r.usage;
    const common = { usage, ...(r.model ? { model: r.model } : {}), cost: r.costUsd ?? null, log: `${r.kind === "completed" ? "" : `${"detail" in r ? r.detail : ""}\n`}${r.text}` };
    if (r.kind === "completed") return { ...common, kind: "completed", outcome: r.outcome, outputs: r.outputs, quotaRejected: r.quotaRejected };
    if (r.kind === "question") return { ...common, kind: "question", pending: r.pending, quotaRejected: r.quotaRejected };
    if (r.kind === "waiting") return { ...common, kind: "waiting", reason: r.reason, ...(r.resetAt !== undefined ? { resetAt: r.resetAt } : {}) };
    return { ...common, kind: "failed", reason: r.reason };
  }

  private async copyAttachments(jobId: string, wd: string): Promise<string[]> {
    const created = this.ctx.db.events(jobId).find((event) => event.type === "job.created");
    const paths: string[] = [];
    for (const artifact of created?.payload.attachments ?? []) {
      const path: string = `.pecore/attachments/${basename(artifact.name)}`;
      await writeFileAs(this.ctx.user, wd, path, this.ctx.db.requireArtifact(artifact));
      paths.push(path);
    }
    return paths;
  }

  private complete(jobId: string, nodeRunId: string, outcome: string, before: string | null, after: string | null, artifacts: Artifact[]): void {
    this.ctx.db.append([{ jobId, type: "node_run.completed", payload: { nodeRunId, outcome, contentBefore: before, contentAfter: after, artifacts } }]);
    this.ctx.changed(jobId);
  }

  private fail(job: JobRow, nodeRunId: string, reason: FailureReason, detail?: string): void {
    this.ctx.db.append([{ jobId: job.id, type: "node_run.failed", payload: { nodeRunId, reason } }]);
    const unavailable: boolean = reason === "AGENT_UNAVAILABLE";
    this.setState(job.id, unavailable ? "stopped" : "failed", reason, undefined, detail);
    this.ctx.notify({ kind: "job-finished", title: job.title, body: unavailable ? `Agent unavailable. ${detail ?? ""}`.trim() : `failed: ${reason}`, jobId: job.id });
    this.ended(job.id);
  }

  private async interrupt(jobId: string, nodeRunId: string, git: GitRecord | null, before: string | null): Promise<void> {
    if (git && before) await undoInterrupted(this.ctx.user, workdirOf(this.ctx.dir, jobId), jobId, git, before);
    this.setRun(jobId, nodeRunId, "interrupted", null);
  }

  private async retryWait(jobId: string, nodeRunId: string, reason: "network" | "auth"): Promise<void> {
    this.timers.delete(jobId);
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (job.state !== "waiting" || job.waiting_reason !== reason) return;
      this.setRun(jobId, nodeRunId, "waiting", "concurrency");
      this.setState(jobId, "running", null);
    });
    void this.tick(jobId);
  }

  async answer(itemId: string, choice: string, note: string | null, hash: string): Promise<void> {
    const item = this.ctx.db.db.prepare("SELECT * FROM human_queue WHERE id = ?").get(itemId) as { job_id: string; kind: string; state: string; subject: string; subject_hash: string; choices: string } | undefined;
    if (!item) throw new Error(`queue item ${itemId} not found`);
    if (item.state !== "open" || item.subject_hash !== hash) throw new Error("the item changed or was resolved");
    if (!(JSON.parse(item.choices) as string[]).includes(choice)) throw new Error(`${choice} is not a choice of this item`);
    if (item.kind === "ticket") {
      const { orderId } = JSON.parse(item.subject) as { orderId: string };
      resolveTicketOrder(this.ctx, itemId, orderId, choice, note);
      return;
    }
    const jobId = item.job_id;
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (item.kind === "agent-question") {
        if (!note?.trim()) throw new Error("an answer is required");
        const { nodeRunId } = JSON.parse(item.subject) as QuestionSubject;
        const pending: boolean = this.runs(jobId).some((run) => run.id === nodeRunId && run.state === "waiting" && run.waiting_reason === "human" && run.queue_item_id === itemId);
        if (!pending) throw new Error("the question changed or was resolved");
        const events: NewEvent[] = [
          { jobId, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } },
          { jobId, type: "node_run.state_changed", payload: { nodeRunId, state: "waiting", waitingReason: "concurrency" } },
        ];
        if (job.state === "waiting") events.push({ jobId, type: "job.state_changed", payload: { state: "running", reason: null } });
        this.ctx.db.append(events);
        this.ctx.changed(jobId);
        return;
      }
      if (item.kind === "round-limit") {
        this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
        if (job.state === "waiting") this.setState(jobId, "running", null);
        if (choice === "end") {
          this.setState(jobId, "failed", "round_limit");
          this.ended(jobId);
        }
        return;
      }
      if (item.kind === "ci-head") {
        const pending = this.ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE id = ? AND state = 'open'").get(itemId);
        if (!pending || (job.state !== "paused" && job.waiting_reason !== "ci_head")) throw new Error("the item changed or was resolved");
        this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
        if (choice === "stop") {
          this.setState(jobId, "stopped", null);
          this.ended(jobId);
        } else if (job.state === "waiting") this.setState(jobId, "running", null);
        return;
      }
      if (item.kind !== "human-node") return;
      const subject = JSON.parse(item.subject) as { nodeRunId: string; node: string; contentState: string | null };
      const recipe = this.recipe(job);
      const node = this.nodeFor(recipe, subject.node, jobNodes(jobDefinitions(this.ctx.db, jobId), this.ctx.defs.nodes));
      if (!isHumanNode(node)) return;
      const pending: boolean = this.runs(jobId).some((run) => run.id === subject.nodeRunId && run.state === "waiting" && run.queue_item_id === itemId);
      if (!pending) throw new Error("the item changed or was resolved");
      if (node.interface !== "decision" && choice === "approve") {
        const current: string = await contentState(this.ctx.user, workdirOf(this.ctx.dir, jobId));
        if (current !== subject.contentState) {
          this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId, state: "cancelled", choice: null, note: "The reviewed content changed." } }]);
          this.complete(jobId, subject.nodeRunId, "stale", subject.contentState, current, []);
          if (job.state === "waiting") this.setState(jobId, "running", null);
          return;
        }
      }
      const r = humanResult(node, choice, note);
      const artifacts: Artifact[] = r.userNote ? [this.saveArtifact(jobId, runDirName(subject.nodeRunId), "text", r.userNote, subject.contentState)] : [];
      this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
      this.complete(jobId, subject.nodeRunId, r.outcome, subject.contentState, subject.contentState, artifacts);
      if (job.state === "waiting") this.setState(jobId, "running", null);
    });
    void this.tick(jobId);
  }

  async pause(jobId: string): Promise<void> {
    const job = this.job(jobId);
    if (job.state === "waiting") {
      await this.exclusive(jobId, async () => this.setState(jobId, "paused", "user"));
      return;
    }
    if (job.state === "running") {
      this.pauseRequested.add(jobId);
      if (!this.running.has(jobId)) await this.exclusive(jobId, async () => {
        if (this.pauseRequested.delete(jobId) && this.job(jobId).state === "running") this.setState(jobId, "paused", "user");
      });
    }
  }

  async play(jobId: string): Promise<void> {
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (job.state !== "paused") return;
      const open = this.runs(jobId).find((r) => r.state === "waiting" && (r.waiting_reason === "human" || r.waiting_reason === "round_limit"));
      const roundLimit = this.ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE job_id = ? AND kind = 'round-limit' AND state = 'open'").get(jobId);
      const ciHead = this.ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE job_id = ? AND kind = 'ci-head' AND state = 'open'").get(jobId);
      if (open) this.setState(jobId, "waiting", open.waiting_reason);
      else if (roundLimit) this.setState(jobId, "waiting", "round_limit");
      else if (ciHead) this.setState(jobId, "waiting", "ci_head");
      else this.setState(jobId, "running", null);
    });
    void this.tick(jobId);
  }

  async stop(jobId: string): Promise<void> {
    this.stopRequested.add(jobId);
    const proc = this.running.get(jobId);
    if (proc) await stopGroup(proc.user, proc.pgid);
    await killJobProcesses(this.ctx.user, jobId);
    await this.exclusive(jobId, async () => {
      this.stopRequested.delete(jobId);
      const t = this.timers.get(jobId);
      if (t) clearTimeout(t);
      this.timers.delete(jobId);
      const job = this.job(jobId);
      if (isFinal(job.state)) return;
      for (const r of this.runs(jobId)) {
        if (r.state !== "pending" && r.state !== "waiting") continue;
        const question = this.agentQuestion(jobId, r.id);
        await this.interrupt(jobId, r.id, question?.subject.git ?? null, question?.subject.contentState ?? null);
      }
      const open = this.ctx.db.db.prepare("SELECT id FROM human_queue WHERE job_id = ? AND state = 'open'").all(jobId) as { id: string }[];
      for (const { id } of open) this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId: id, state: "cancelled", choice: null, note: null } }]);
      this.setState(jobId, "stopped", null);
      this.ended(jobId);
    });
  }

  async resume(jobId: string): Promise<void> {
    await this.exclusive(jobId, () => withProjectLocation(this.ctx, async () => {
      const job = this.job(jobId);
      if (job.state !== "failed" && job.state !== "stopped") throw new Error(`job ${jobId} is ${job.state}`);
      if (job.archived) throw new Error(`job ${jobId} is archived`);
      const wd = workdirOf(this.ctx.dir, jobId);
      const exists = await gitWork(this.ctx.user, this.ctx.dir, [`--git-dir=${join(this.ctx.dir, "repo.git")}`, "worktree", "list", "--porcelain"]);
      if (!exists.includes(`worktree ${wd}\n`)) await recreateWorktree(this.ctx.user, this.ctx.dir, jobId);
      await this.copyAttachments(jobId, wd);
      this.setState(jobId, "running", null, "resume");
    }));
    void this.tick(jobId);
  }

  async recoverAfterRestart(): Promise<void> {
    const obsolete = this.ctx.db.db.prepare<[], { id: string; job_id: string }>(`
      SELECT id, job_id FROM human_queue
      WHERE kind = 'round-limit' AND state = 'open' AND json_extract(subject, '$.cap') = 'maxNodeRuns'`).all();
    if (obsolete.length) this.ctx.db.append(obsolete.map(({ id, job_id }): NewEvent => ({
      jobId: job_id, type: "queue.resolved", payload: { itemId: id, state: "cancelled", choice: null, note: "The recipe-wide limit was removed." },
    })));
    for (const job of this.jobs()) {
      const open = this.runs(job.id).filter((r) => r.state === "running");
      for (const r of open) {
        if (r.pgid !== null && r.os_user !== null) await signalGroup(r.os_user, r.pgid, "KILL");
        const git = r.git_before ? (JSON.parse(r.git_before) as GitRecord) : null;
        const question = this.agentQuestion(job.id, r.id);
        if (question?.answer != null && git) {
          await undoInterrupted(this.ctx.user, workdirOf(this.ctx.dir, job.id), job.id, git, question.subject.questionTree).then(
            () => this.setRun(job.id, r.id, "waiting", "concurrency"),
            () => this.setRun(job.id, r.id, "interrupted", null),
          );
          continue;
        }
        const before = r.content_before;
        await this.interrupt(job.id, r.id, git, before).catch(() => this.setRun(job.id, r.id, "interrupted", null));
      }
      if (job.state === "waiting" && (job.waiting_reason === "ci" || job.waiting_reason === "ci_head")) continue;
      if (job.state === "running" || job.state === "waiting") this.setState(job.id, "paused", "quit");
    }
  }

  async archive(jobId: string): Promise<void> {
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (!isFinal(job.state)) throw new Error(`job ${jobId} is ${job.state}`);
      await removeWorktree(this.ctx.user, this.ctx.dir, workdirOf(this.ctx.dir, jobId));
      this.ctx.db.append([{ jobId, type: "job.archived", payload: {} }]);
      this.ctx.changed(jobId);
    });
  }

  async remove(jobId: string): Promise<void> {
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (!isFinal(job.state)) throw new Error(`job ${jobId} is ${job.state}; stop it first`);
      const live = this.children(jobId).filter((c) => !isFinal(c.state));
      if (live.length > 0) throw new Error(`job ${jobId} has children that are not finished: ${live.map((c) => c.id).join(", ")}`);
      await removeWorktree(this.ctx.user, this.ctx.dir, workdirOf(this.ctx.dir, jobId));
      await gitWork(this.ctx.user, this.ctx.dir, [`--git-dir=${join(this.ctx.dir, "repo.git")}`, "update-ref", "-d", `refs/heads/${jobBranch(jobId)}`]).catch(() => "");
      await this.services.down(jobId);
      const db = this.ctx.db.db;
      db.transaction(() => {
        db.prepare("DELETE FROM attempts WHERE node_run_id IN (SELECT id FROM node_runs WHERE job_id = ?)").run(jobId);
        db.prepare("DELETE FROM node_runs WHERE job_id = ?").run(jobId);
        db.prepare("DELETE FROM human_queue WHERE job_id = ?").run(jobId);
        db.prepare("DELETE FROM events WHERE job_id = ?").run(jobId);
        db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
      })();
      this.ctx.changed(jobId);
    });
  }

  async kick(): Promise<void> {
    if (this.closing) return;
    for (const job of this.jobs()) {
      if (this.closing) return;
      if (job.state === "queued" || (job.state === "waiting" && job.waiting_reason === "concurrency")) {
        await this.exclusive(job.id, async () => {
          const j = this.job(job.id);
          if (j.state === "waiting" && j.waiting_reason === "concurrency") this.setState(job.id, "running", null);
        });
        void this.tick(job.id);
      }
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    const procs = [...this.running.values()].filter((p): p is { pgid: number; user: string } => p !== null);
    await Promise.all(procs.map((p) => stopGroup(p.user, p.pgid)));
    await Promise.all([...this.locks.values()]);
    await this.services.stopAll().catch((e: unknown) => console.error("services:", e));
  }
}
