import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, matchesGlob, relative } from "node:path";
import { monotonicFactory } from "ulid";
import type { RawLine, Usage } from "@pecore/agents";
import type { AgentNode, Artifact, ArtifactType, FailureReason, ForgeAccount, JobState, Node, Profiles, Project, Settings, Tiers, WaitingReason } from "@pecore/schemas";
import { Recipe, SpecArtifact } from "@pecore/schemas";
import { spawnFor } from "../accounts/agents";
import type { AgentServices } from "../accounts/agents";
import { ensureConfirmed, needsConfirmation, recordConfirmation } from "../definitions/confirm";
import type { ConfirmSubject } from "../definitions/confirm";
import type { Definitions } from "../definitions/load";
import { effectRecorder } from "../jobs/effects";
import { LogWriter } from "../observability/logs";
import { runAgentNode } from "../runners/agent";
import { commitSha, fetchBase, latestArtifact, reentryPending } from "../jobs/stacked";
import { runCommandNode, runMergedCheck } from "../runners/command";
import type { CommandRun } from "../runners/command";
import { forgeEnv, identityOk, ToolAuthError } from "../runners/forge-env";
import { budgetBlock } from "../scheduler/budget";
import { candidateProfiles, pickProfile } from "../scheduler/tiers";
import type { ProfileChoice } from "../scheduler/tiers";
import { humanItem, humanResult } from "../runners/human";
import { paramsWithDefaults } from "../runners/placeholders";
import { appUser, killJobProcesses, signalGroup, stopGroup } from "../runners/process";
import { enoughDisk } from "../scheduler/disk";
import type { Pools } from "../scheduler/pools";
import { poolsFor } from "../scheduler/pools";
import type { ProjectDb } from "../store/project-db";
import { contentState, deleteScratch, recordGit, restoreState, undoInterrupted } from "../workdir/content-state";
import type { GitRecord } from "../workdir/content-state";
import { gitWork } from "../workdir/git-as";
import { setupJobId } from "../projects/create";
import { JobServices, recordServicesConfirmation } from "../services/job-services";
import type { ServicesSubject } from "../services/job-services";
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
  library: string;
  db: ProjectDb;
  project: Project;
  defs: Definitions;
  user: string;
  settings: Settings;
  pools: Pools;
  notify(n: { kind: string; title: string; body: string; jobId: string }): void;
  changed(jobId: string): void;
  released(): void;
  agents: AgentServices | null;
  forgeAccount(id: string): ForgeAccount | undefined;
  setupEnded?: (state: JobState) => void;
  held?: () => boolean;
  global(): { profiles: Profiles; tiers: Tiers };
  live?: (attemptId: string, line: RawLine) => void;
};

type AttemptExtra = { usage?: Usage; model?: string; cost?: number | null; log: string };
type Attempt =
  | (AttemptExtra & { kind: "completed"; outcome: string; outputs: { type: ArtifactType; content: string }[]; quotaRejected?: { resetAt?: number } | null })
  | (AttemptExtra & { kind: "failed"; reason: FailureReason })
  | (AttemptExtra & { kind: "waiting"; reason: "network" | "quota" | "rate_limit" | "auth"; resetAt?: number });

function localDay(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const backoffMs = [60_000, 120_000, 240_000, 480_000];

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
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
    this.services = new JobServices(ctx.db, ctx.dir, ctx.project.services, () => ctx.settings.servicesRuntime);
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

  private setState(jobId: string, state: JobState, reason: string | null, cause?: "resume" | "base_change"): void {
    const job = this.job(jobId);
    if (job.state === state && job.waiting_reason === reason) return;
    if (job.state !== state) assertTransition(job.state, state, { archived: job.archived === 1, ...(cause ? { cause } : {}) });
    this.ctx.db.append([{ jobId, type: "job.state_changed", payload: { state, reason } }]);
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

  private nodeFor(recipe: Recipe, id: string): Node {
    const r = recipe.nodes[id]!;
    const def = this.ctx.defs.nodes.get(r.use);
    if (!def) throw new Error(`node instance ${r.use} not found`);
    return def;
  }

  private byId(recipe: Recipe): Map<string, Node> {
    return new Map(Object.keys(recipe.nodes).map((id) => [id, this.nodeFor(recipe, id)]));
  }

  private history(jobId: string): RunRecord[] {
    return this.runs(jobId)
      .filter((r) => (r.state === "completed" || r.state === "skipped") && r.outcome !== null)
      .map((r) => ({ nodeId: r.node, outcome: r.outcome!, viaEdge: r.via_edge }));
  }

  private allowances(jobId: string): Allowances {
    const rows = this.ctx.db.db.prepare("SELECT subject FROM human_queue WHERE job_id = ? AND kind = 'round-limit' AND state = 'resolved' AND choice = 'allow'").all(jobId) as { subject: string }[];
    const a: Allowances = { extraRounds: {}, extraNodeRuns: 0 };
    for (const { subject } of rows) {
      const s = JSON.parse(subject) as { edge: number | null; cap: string };
      if (s.cap === "maxNodeRuns") a.extraNodeRuns += 1;
      else if (s.edge !== null) a.extraRounds[s.edge] = (a.extraRounds[s.edge] ?? 0) + 1;
    }
    return a;
  }

  artifacts(jobId: string): Artifact[] {
    const out: Artifact[] = [];
    for (const e of this.ctx.db.events(jobId)) {
      if (e.type === "job.created" && e.payload.ticket) out.push(e.payload.ticket);
      if (e.type === "node_run.completed") out.push(...e.payload.artifacts);
    }
    return out;
  }

  private latest(jobId: string): Map<ArtifactType, Artifact> {
    const m = new Map<ArtifactType, Artifact>();
    for (const a of this.artifacts(jobId)) m.set(a.type, a);
    return m;
  }

  private async saveArtifact(jobId: string, runDir: string, type: ArtifactType, content: string, state: string | null): Promise<Artifact> {
    const ext = type === "diff" ? "patch" : type === "check-log" || type === "user-note" ? "txt" : "json";
    const path = join(this.ctx.dir, "artifacts", jobId, runDir, `${type}.${ext}`);
    await mkdir(join(this.ctx.dir, "artifacts", jobId, runDir), { recursive: true });
    await writeFile(path, content);
    return { type, path: relative(this.ctx.dir, path), sha256: sha256(content), contentState: state };
  }

  tick(jobId: string): Promise<void> {
    return this.exclusive(jobId, () => this.advance(jobId)).catch((e: unknown) => this.crash(jobId, e));
  }

  private async advance(jobId: string): Promise<void> {
    for (;;) {
      const job = this.job(jobId);
      if (job.state === "queued") {
        if (!(await this.startJob(job))) return;
        continue;
      }
      if (job.state !== "running" || this.stopRequested.has(jobId) || this.closing) return;
      if (this.pauseRequested.delete(jobId)) {
        this.setState(jobId, "paused", "user");
        return;
      }
      const recipe = this.recipe(job);
      const runs = this.runs(jobId);
      const open = runs.find((r) => r.state === "pending" || r.state === "waiting" || r.state === "running");
      if (open) {
        const done = await this.runNode(job, recipe, open);
        if (!done) return;
        continue;
      }
      const d = reentryPending(this.ctx.db.events(jobId), recipe.onBaseChanged)
        ? reenterOnBaseChange(recipe, this.history(jobId), this.allowances(jobId))!
        : nextStep(recipe, this.byId(recipe), this.history(jobId), this.allowances(jobId));
      if (d.kind === "end") {
        await this.finish(job, d.state, d.reason);
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
    if (job.id !== setupJobId && this.ctx.held?.()) return false;
    if (!(await enoughDisk(this.ctx.dir, this.ctx.settings.minFreeDiskGb))) {
      if (job.waiting_reason !== "disk") this.ctx.db.append([{ jobId: job.id, type: "job.state_changed", payload: { state: "queued", reason: "disk" } }]);
      return false;
    }
    const base = await this.freshBase(job);
    if (base === null) return false;
    await addWorktree(this.ctx.user, this.ctx.dir, job.id, base);
    this.setState(job.id, "running", null);
    return true;
  }

  private async freshBase(job: JobRow): Promise<string | null> {
    const repo = this.ctx.project.repo;
    if (repo === null || job.id === setupJobId || job.target.startsWith(jobBranch(""))) return job.base;
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
    this.setState(job.id, state, reason);
    this.ctx.notify({ kind: "job-finished", title: job.title, body: `${state}${reason ? `: ${reason}` : ""}`, jobId: job.id });
    this.ended(job.id);
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
    this.ctx.db.append([{ jobId: setupJobId, type: "job.created", payload: { title: "Create the remote repository", recipe, ticket: null, parentJobId: null, baseBranch, base, target: baseBranch, branch: jobBranch(setupJobId) } }]);
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
    const sha = await commitSha(this.ctx.dir, latestArtifact(this.ctx.db.events(parentId), "commit"));
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
    await this.exclusive(jobId, async () => {
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
      if (!worktrees.includes(`worktree ${workdirOf(this.ctx.dir, jobId)}\n`)) await recreateWorktree(this.ctx.user, this.ctx.dir, jobId);
      this.ctx.db.append([changed, ...(job.archived ? [{ jobId, type: "job.unarchived" as const, payload: {} }] : [])]);
      this.setState(jobId, "running", null, "base_change");
      reentered = true;
    });
    if (reentered) void this.tick(jobId);
  }

  async checkMerges(): Promise<void> {
    for (const job of this.jobs()) {
      if (job.merged_at !== null) continue;
      await this.checkMerge(job.id).catch((e: unknown) => console.error(`merge check of job ${job.id}:`, e));
    }
  }

  async checkMerge(jobId: string): Promise<boolean> {
    const job = this.job(jobId);
    if (job.merged_at !== null) return true;
    const url = await this.mergedUrl(job);
    if (url === null) return false;
    await this.deliveryMerged(job, url);
    return true;
  }

  private async mergedUrl(parent: JobRow): Promise<string | null> {
    const events = this.ctx.db.events(parent.id);
    const delivery = latestArtifact(events, "delivery");
    if (!delivery) return null;
    const producer = events.find((e) => e.type === "node_run.completed" && e.payload.artifacts.some((a) => a.path === delivery.path));
    if (producer?.type !== "node_run.completed") return null;
    const nodeId = producer.payload.nodeRunId.split("/")[1]!.split("#")[0]!;
    const node = this.nodeFor(this.recipe(parent), nodeId);
    if (node.kind !== "command" || !node.mergedCheck) return null;
    const confirmed = await ensureConfirmed(this.ctx.db, parent.id, join(this.ctx.dir, "nodes"), node);
    if (!confirmed.confirmed) return null;
    const env: Record<string, string> = {};
    for (const a of this.toolAccounts(node.credentials)) Object.assign(env, await forgeEnv(a));
    const result = await runMergedCheck({
      node,
      nodeDir: join(this.ctx.dir, "nodes"),
      params: paramsWithDefaults(node.params, this.recipe(parent).nodes[nodeId]?.params),
      context: await this.placeholderContext(parent),
      inputs: [{ type: "delivery", path: join(this.ctx.dir, delivery.path) }],
      extraEnv: env,
      scripts: confirmed.scripts,
    });
    if (result !== "done") return null;
    return (JSON.parse(await readFile(join(this.ctx.dir, delivery.path), "utf8")) as { url: string }).url;
  }

  private async deliveryMerged(parent: JobRow, url: string): Promise<void> {
    this.ctx.db.append([{ jobId: parent.id, type: "job.delivery_merged", payload: { url } }]);
    this.ctx.changed(parent.id);
    for (const child of this.children(parent.id)) {
      this.ctx.notify({ kind: "job-finished", title: child.title, body: `its parent's delivery was merged into ${parent.target}`, jobId: child.id });
      await this.requestBaseChange(child.id, "parent_merged", parent.target);
    }
  }

  private requiresMet(jobId: string, recipe: Recipe, nodeId: string, current: string): boolean {
    const runs = this.runs(jobId).filter((r) => r.state === "completed");
    for (const req of recipe.nodes[nodeId]!.requires) {
      const last = runs.filter((r) => r.node === req).at(-1);
      if (!last) return false;
      const node = this.nodeFor(recipe, req);
      const ok = last.outcome === "passed" || (node.kind === "human" && last.outcome === "approve");
      if (!ok || last.content_before !== current || last.content_after !== current) return false;
    }
    return true;
  }

  private async runNode(job: JobRow, recipe: Recipe, run: NodeRunRow): Promise<boolean> {
    const node = this.nodeFor(recipe, run.node);
    const recipeNode = recipe.nodes[run.node]!;
    const wd = workdirOf(this.ctx.dir, job.id);
    const runDir = runDirName(run.id);
    if (run.state === "waiting" && (run.waiting_reason === "human" || run.waiting_reason === "network")) return false;

    if (recipeNode.optional) {
      const spec = this.latest(job.id).get("spec");
      const named = spec ? SpecArtifact.safeParse(JSON.parse(await readFile(join(this.ctx.dir, spec.path), "utf8"))).data?.optionalNodes ?? [] : [];
      if (!named.includes(run.node)) {
        this.ctx.db.append([{ jobId: job.id, type: "node_run.completed", payload: { nodeRunId: run.id, outcome: "skipped", contentBefore: null, contentAfter: null, artifacts: [] } }]);
        return true;
      }
    }

    const before = await contentState(this.ctx.user, wd);
    if (recipeNode.requires.length > 0 && !this.requiresMet(job.id, recipe, run.node, before)) {
      this.complete(job.id, run.id, "stale", before, before, []);
      return true;
    }

    if (node.kind === "human") {
      const item = humanItem(run.id, run.node, node, [...this.latest(job.id).values()], before);
      const itemId = ulid();
      this.ctx.db.append([
        { jobId: job.id, type: "queue.added", payload: { itemId, ...item } },
        { jobId: job.id, type: "node_run.state_changed", payload: { nodeRunId: run.id, state: "waiting", waitingReason: "human", queueItemId: itemId } },
      ]);
      this.setState(job.id, "waiting", "human");
      this.ctx.notify({ kind: "needs-user", title: job.title, body: `${run.node} waits for your review`, jobId: job.id });
      return false;
    }
    if (node.kind === "source") throw new Error("source nodes cannot run in a recipe");

    let confirmedScripts: Record<string, string> | undefined;
    if (needsConfirmation(node)) {
      const c = await ensureConfirmed(this.ctx.db, job.id, join(this.ctx.dir, "nodes"), node);
      if (!c.confirmed) {
        if (run.waiting_reason !== "confirmation") {
          this.setRun(job.id, run.id, "waiting", "confirmation", { queueItemId: c.itemId });
          this.ctx.notify({ kind: "needs-user", title: job.title, body: `${recipeNode.use} waits for your confirmation`, jobId: job.id });
        }
        this.setState(job.id, "waiting", "confirmation");
        return false;
      }
      confirmedScripts = c.scripts;
    }

    let servicesEnv: Record<string, string> = {};
    if (job.id !== setupJobId) {
      const s = await this.services.ensure(job.id, job.base, () => {
        this.setRun(job.id, run.id, "waiting", "services");
        this.setState(job.id, "waiting", "services");
      });
      if (s.kind === "confirm") {
        if (run.waiting_reason !== "confirmation") {
          this.setRun(job.id, run.id, "waiting", "confirmation", { queueItemId: s.itemId });
          this.ctx.notify({ kind: "needs-user", title: job.title, body: "a new compose file waits for your confirmation", jobId: job.id });
        }
        this.setState(job.id, "waiting", "confirmation");
        return false;
      }
      servicesEnv = s.env;
      if (this.job(job.id).state === "waiting") this.setState(job.id, "running", null);
    }

    const tools = node.kind === "command" ? this.toolAccounts(node.credentials) : [];
    const toolEnv: Record<string, string> = {};
    try {
      for (const a of tools) Object.assign(toolEnv, await forgeEnv(a));
    } catch (e) {
      if (!(e instanceof ToolAuthError)) throw e;
      this.waitAuth(job, run.id, e.account);
      return false;
    }

    let profile: Extract<ProfileChoice, { kind: "profile" }> | null = null;
    let pools = poolsFor(this.ctx.id);
    if (node.kind === "agent") {
      const agents = this.ctx.agents;
      if (!agents) throw new Error("agents are not configured");
      const g = this.ctx.global();
      const choice = pickProfile({
        candidates: candidateProfiles(node, recipeNode.agent, g.tiers),
        profiles: g.profiles,
        providerOf: (acc) => agents.account(acc)?.provider,
        excludedProviders: this.providersOf(job.id, recipeNode.agent?.providerNot ?? node.agent.providerNot),
        cooling: (acc) => agents.cooling(acc),
      });
      if (choice.kind === "none") {
        await this.saveArtifact(job.id, runDir, "check-log", choice.why, before);
        this.fail(job, run.id, "HARNESS_ERROR");
        return false;
      }
      if (choice.kind === "wait") {
        this.waitUntil(job.id, run.id, choice.reason, choice.until);
        return false;
      }
      const block = budgetBlock(this.ctx.db.db, this.ctx.project, job.id);
      if (block) {
        const open = this.ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE job_id = ? AND kind = 'budget' AND state = 'open'").get(job.id);
        if (!open) {
          const subject = { ...block, project: this.ctx.id };
          this.ctx.db.append([{ jobId: job.id, type: "queue.added", payload: { itemId: ulid(), kind: "budget", subject, subjectHash: sha256(JSON.stringify(subject)), choices: ["raise", "stop"] } }]);
          this.ctx.notify({ kind: "budget", title: job.title, body: `budget ${block.limit} reached`, jobId: job.id });
        }
        this.setRun(job.id, run.id, "waiting", "budget");
        this.setState(job.id, "waiting", "budget");
        return false;
      }
      profile = choice;
      pools = poolsFor(this.ctx.id, ["agents", `provider:${choice.provider}`, `account:${choice.account}`]);
    }

    if (!this.ctx.pools.tryTake(pools)) {
      if (run.waiting_reason !== "concurrency") this.setRun(job.id, run.id, "waiting", "concurrency");
      this.setState(job.id, "waiting", "concurrency");
      return false;
    }
    try {
      const attempts = node.retry + 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const git = await recordGit(this.ctx.user, wd, job.id);
        this.ctx.db.append([{ jobId: job.id, type: "node_run.git_recorded", payload: { nodeRunId: run.id, ...git } }]);
        this.setRun(job.id, run.id, "running", null, { osUser: this.ctx.user });
        const attemptId = ulid();
        const logPath = join("logs", `${attemptId}.jsonl.zst`);
        const sessionGroup = node.kind === "agent" ? (recipeNode.session ?? null) : null;
        this.ctx.db.append([
          {
            jobId: job.id,
            type: "attempt.started",
            payload: { attemptId, nodeRunId: run.id, profile: profile?.profile ?? null, connector: profile ? (this.ctx.agents!.account(profile.account)?.connector ?? null) : null, harnessVersion: null, connectorVersion: null, account: profile?.account ?? null, osUser: this.ctx.user, sessionGroup, logPath },
          },
        ]);
        const log = await LogWriter.open(join(this.ctx.dir, logPath));
        const latest = this.latest(job.id);
        const context = await this.placeholderContext(this.job(job.id));
        const inputs = [...node.inputs, ...node.optionalInputs].flatMap((t) => {
          const a = latest.get(t);
          return a ? [{ type: t, path: join(this.ctx.dir, a.path) }] : [];
        });
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
                nodeDir: join(this.ctx.dir, "nodes"),
                params: paramsWithDefaults(node.params, recipeNode.params),
                user: this.ctx.user,
                workdir: wd,
                context,
                inputs,
                cleanTree: node.cleanCheckout ? before : null,
                extraEnv: { ...servicesEnv, ...toolEnv },
                ...(confirmedScripts ? { scripts: confirmedScripts } : {}),
                onStart,
                effect: effectRecorder(this.ctx.db, job.id, run.id, run.node),
              })
            : await this.agentAttempt(job, run, node, recipeNode, profile!, attemptId, sessionGroup, { wd, context, inputs, log, onStart, env: servicesEnv });
        this.running.delete(job.id);
        if (result.log) log.write({ dir: "cmd", text: result.log, at: Date.now() });
        await log.close();
        if (this.closing) return false;
        const end = (reason: string) =>
          this.ctx.db.append([
            {
              jobId: job.id,
              type: "attempt.ended",
              payload: { attemptId, endReason: reason, model: result.model ?? profile?.model ?? null, account: profile?.account ?? null, tokens: result.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: result.cost ?? null, day: localDay() },
            },
          ]);

        if (this.stopRequested.has(job.id)) {
          end("interrupted");
          await this.interrupt(job.id, run.id, git, before);
          return false;
        }
        if (result.kind === "waiting") {
          end(result.reason);
          await undoInterrupted(this.ctx.user, wd, job.id, git, before);
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
          if (attempt + 1 < attempts && result.reason !== "INVALID_OUTPUT") continue;
          await this.saveArtifact(job.id, runDir, "check-log", result.log, before);
          this.fail(job, run.id, result.reason);
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
        const artifacts: Artifact[] = node.kind === "command" ? [await this.saveArtifact(job.id, runDir, "check-log", result.log, after)] : [];
        for (const o of result.outputs) {
          let content = o.content;
          if (o.type === "commit") {
            const sha = (JSON.parse(content) as { sha?: string }).sha ?? "";
            const tree = (await gitWork(this.ctx.user, wd, ["rev-parse", `${sha}^{tree}`])).trim();
            if (tree !== before) {
              this.fail(job, run.id, "READ_ONLY_VIOLATION");
              return false;
            }
            content = JSON.stringify({ sha, contentState: before });
          }
          artifacts.push(await this.saveArtifact(job.id, runDir, o.type, content, after));
        }
        if (node.changesFiles) {
          const diff = await gitWork(this.ctx.user, wd, ["diff", job.base, after]);
          artifacts.push(await this.saveArtifact(job.id, runDir, "diff", diff, after));
        }
        this.complete(job.id, run.id, result.outcome, before, after, artifacts);
        const committed = await commitSha(this.ctx.dir, artifacts.find((a) => a.type === "commit"));
        if (committed) this.parentCommitted(job.id, committed);
        return true;
      }
      return false;
    } finally {
      this.ctx.pools.release(pools);
      this.ctx.released();
    }
  }

  private async placeholderContext(job: JobRow): Promise<CommandRun["context"]> {
    const latest = this.latest(job.id);
    const read = async <T>(a: Artifact | undefined) => (a ? (JSON.parse(await readFile(join(this.ctx.dir, a.path), "utf8")) as T) : null);
    return {
      job: { id: job.id, title: job.title, branch: job.branch, base: job.base, oldBase: job.old_base, target: job.target, commit: (await read<{ sha: string }>(latest.get("commit")))?.sha ?? null },
      ticketId: (await read<{ id: string | null }>(latest.get("ticket")))?.id ?? null,
      project: { repoDir: join(this.ctx.dir, "repo.git"), repoUrl: this.ctx.project.repo?.url ?? null, baseBranch: this.ctx.project.baseBranch },
    };
  }

  private toolAccounts(credentials: string[]): ForgeAccount[] {
    return credentials.map((name) => {
      const id = name === "project.account" ? this.ctx.project.repo?.account : name;
      const account = id === undefined ? undefined : this.ctx.forgeAccount(id);
      if (!account) throw new Error(`forge account ${id ?? name} not found`);
      return account;
    });
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

  private providersOf(jobId: string, nodeIds: string[]): Set<string> {
    const out = new Set<string>();
    if (nodeIds.length === 0 || !this.ctx.agents) return out;
    const rows = this.ctx.db.db
      .prepare(`SELECT a.account FROM attempts a JOIN node_runs n ON a.node_run_id = n.id WHERE n.job_id = ? AND n.node IN (${nodeIds.map(() => "?").join(",")}) AND a.account IS NOT NULL`)
      .all(jobId, ...nodeIds) as { account: string }[];
    for (const r of rows) {
      const p = this.ctx.agents.account(r.account)?.provider;
      if (p) out.add(p);
    }
    return out;
  }

  private resumeSession(jobId: string, node: string, profile: string, resume: boolean, group: string | null): string | null {
    if (!resume && group === null) return null;
    const row = this.ctx.db.db
      .prepare(
        `SELECT a.session_id FROM attempts a JOIN node_runs n ON a.node_run_id = n.id
         WHERE n.job_id = ? AND n.state = 'completed' AND a.profile = ? AND a.session_id IS NOT NULL AND ${group !== null ? "a.session_group = ?" : "n.node = ?"}
         ORDER BY a.started_at DESC LIMIT 1`,
      )
      .get(jobId, profile, group ?? node) as { session_id: string } | undefined;
    return row?.session_id ?? null;
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

  private async knowledgeFiles(globs: string[]): Promise<{ rel: string; abs: string }[]> {
    if (globs.length === 0) return [];
    const root = join(this.ctx.dir, "knowledge");
    const files = (await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []))
      .filter((e) => e.isFile())
      .map((e) => relative(root, join(e.parentPath, e.name)));
    return files.filter((f) => globs.some((g) => matchesGlob(f, g))).map((rel) => ({ rel, abs: join(root, rel) }));
  }

  private async agentAttempt(
    job: JobRow,
    run: NodeRunRow,
    node: AgentNode,
    recipeNode: Recipe["nodes"][string],
    profile: Extract<ProfileChoice, { kind: "profile" }>,
    attemptId: string,
    sessionGroup: string | null,
    x: { wd: string; context: CommandRun["context"]; inputs: CommandRun["inputs"]; log: LogWriter; onStart: (pgid: number, user: string) => void; env: Record<string, string> },
  ): Promise<Attempt> {
    const agents = this.ctx.agents!;
    const account = agents.account(profile.account);
    if (!account) return { kind: "failed", reason: "HARNESS_ERROR", log: `account ${profile.account} not found` };
    let connector;
    try {
      connector = await agents.resolve(account.connector);
    } catch (e) {
      return { kind: "failed", reason: "COMMAND_NOT_FOUND", log: (e as Error).message };
    }
    const login = await agents.login(account.id);
    const spawn = spawnFor(this.ctx.user, { ...x.env, PECORE_JOB_ID: job.id });
    const resumeId = this.resumeSession(job.id, run.node, profile.profile, node.resume, sessionGroup);
    const r = await runAgentNode({
      node,
      nodeDir: join(this.ctx.dir, "nodes"),
      params: paramsWithDefaults(node.params, recipeNode.params),
      user: this.ctx.user,
      workdir: x.wd,
      context: x.context,
      inputs: x.inputs,
      knowledge: await this.knowledgeFiles(node.knowledge),
      connector,
      login,
      spawn,
      model: profile.model,
      effort: profile.effort,
      resumeId,
      timeoutMs: node.timeoutSec * 1000,
      onStart: (pgid) => x.onStart(pgid, this.ctx.user),
      onSession: (sessionId, resumed) => this.ctx.db.append([{ jobId: job.id, type: "attempt.session_started", payload: { attemptId, sessionId, resumed } }]),
      onRaw: (line) => {
        x.log.write(line);
        this.ctx.live?.(attemptId, line);
      },
    });
    const usage = r.usage;
    const common = { usage, ...(r.model ? { model: r.model } : {}), cost: r.costUsd ?? null, log: `${r.kind === "completed" ? "" : `${"detail" in r ? r.detail : ""}\n`}${r.text}` };
    if (r.kind === "completed") return { ...common, kind: "completed", outcome: r.outcome, outputs: r.outputs, quotaRejected: r.quotaRejected };
    if (r.kind === "waiting") return { ...common, kind: "waiting", reason: r.reason, ...(r.resetAt !== undefined ? { resetAt: r.resetAt } : {}) };
    return { ...common, kind: "failed", reason: r.reason };
  }

  private complete(jobId: string, nodeRunId: string, outcome: string, before: string | null, after: string | null, artifacts: Artifact[]): void {
    this.ctx.db.append([{ jobId, type: "node_run.completed", payload: { nodeRunId, outcome, contentBefore: before, contentAfter: after, artifacts } }]);
    this.ctx.changed(jobId);
  }

  private fail(job: JobRow, nodeRunId: string, reason: FailureReason): void {
    this.ctx.db.append([{ jobId: job.id, type: "node_run.failed", payload: { nodeRunId, reason } }]);
    this.setState(job.id, "failed", reason);
    this.ctx.notify({ kind: "job-finished", title: job.title, body: `failed: ${reason}`, jobId: job.id });
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
    if (item.kind === "engine-node" || item.kind === "source-node") {
      this.ctx.db.append([{ jobId: null, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
      if (choice === "confirm") recordConfirmation(this.ctx.db, JSON.parse(item.subject) as ConfirmSubject);
      for (const j of this.jobs()) if (j.state === "waiting" && j.waiting_reason === "confirmation") await this.release(j.id, ["confirmation"]);
      return;
    }
    if (item.kind === "services") {
      this.ctx.db.append([{ jobId: null, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
      if (choice === "confirm") recordServicesConfirmation(this.ctx.db, JSON.parse(item.subject) as ServicesSubject);
      for (const j of this.jobs()) if (j.state === "waiting" && j.waiting_reason === "confirmation") await this.release(j.id, ["confirmation"]);
      return;
    }
    const jobId = item.job_id;
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
      if (item.kind === "budget") {
        if (job.state !== "waiting") return;
        const open = this.runs(jobId).find((r) => r.state === "waiting");
        if (choice === "stop") {
          if (open) this.setRun(jobId, open.id, "interrupted", null);
          this.setState(jobId, "stopped", null);
          return;
        }
        if (open) this.setRun(jobId, open.id, "waiting", "concurrency");
        this.setState(jobId, "running", null);
        return;
      }
      if (item.kind === "round-limit") {
        if (job.state === "waiting") this.setState(jobId, "running", null);
        if (choice === "end") {
          this.setState(jobId, "failed", "round_limit");
          this.ended(jobId);
        }
        return;
      }
      if (item.kind !== "human-node") return;
      const subject = JSON.parse(item.subject) as { nodeRunId: string; node: string; contentState: string | null };
      const recipe = this.recipe(job);
      const node = this.nodeFor(recipe, subject.node);
      if (node.kind !== "human") return;
      const r = humanResult(node, choice, note);
      const artifacts = r.userNote ? [await this.saveArtifact(jobId, runDirName(subject.nodeRunId), "user-note", r.userNote, subject.contentState)] : [];
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
      if (open) this.setState(jobId, "waiting", open.waiting_reason);
      else if (roundLimit) this.setState(jobId, "waiting", "round_limit");
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
      for (const r of this.runs(jobId)) if (r.state === "pending" || r.state === "waiting") this.setRun(jobId, r.id, "interrupted", null);
      const open = this.ctx.db.db.prepare("SELECT id FROM human_queue WHERE job_id = ? AND state = 'open'").all(jobId) as { id: string }[];
      for (const { id } of open) this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId: id, state: "cancelled", choice: null, note: null } }]);
      this.setState(jobId, "stopped", null);
      this.ended(jobId);
    });
  }

  async resume(jobId: string): Promise<void> {
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (job.state !== "failed" && job.state !== "stopped") throw new Error(`job ${jobId} is ${job.state}`);
      if (job.archived) throw new Error(`job ${jobId} is archived`);
      const wd = workdirOf(this.ctx.dir, jobId);
      const exists = await gitWork(this.ctx.user, this.ctx.dir, [`--git-dir=${join(this.ctx.dir, "repo.git")}`, "worktree", "list", "--porcelain"]);
      if (!exists.includes(`worktree ${wd}\n`)) await recreateWorktree(this.ctx.user, this.ctx.dir, jobId);
      this.setState(jobId, "running", null, "resume");
    });
    void this.tick(jobId);
  }

  async recoverAfterRestart(): Promise<void> {
    for (const job of this.jobs()) {
      const open = this.runs(job.id).filter((r) => r.state === "running");
      for (const r of open) {
        if (r.pgid !== null && r.os_user !== null) await signalGroup(r.os_user, r.pgid, "KILL");
        const git = r.git_before ? (JSON.parse(r.git_before) as GitRecord) : null;
        const before = r.content_before;
        await this.interrupt(job.id, r.id, git, before).catch(() => this.setRun(job.id, r.id, "interrupted", null));
      }
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
      await rm(join(this.ctx.dir, "artifacts", jobId), { recursive: true, force: true });
      const logs = this.ctx.db.db.prepare("SELECT a.log_path FROM attempts a JOIN node_runs n ON a.node_run_id = n.id WHERE n.job_id = ?").all(jobId) as { log_path: string }[];
      for (const { log_path } of logs) await rm(join(this.ctx.dir, log_path), { force: true });
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
    for (const job of this.jobs()) {
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
