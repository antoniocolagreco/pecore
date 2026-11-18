import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { monotonicFactory } from "ulid";
import type { Artifact, ArtifactType, FailureReason, JobState, Node, Project, Recipe, Settings, WaitingReason } from "@pecore/schemas";
import { SpecArtifact } from "@pecore/schemas";
import type { Definitions } from "../definitions/load";
import { effectRecorder } from "../jobs/effects";
import { LogWriter } from "../observability/logs";
import { runCommandNode } from "../runners/command";
import { humanItem, humanResult } from "../runners/human";
import { paramsWithDefaults } from "../runners/placeholders";
import { signalGroup, stopGroup } from "../runners/process";
import { enoughDisk } from "../scheduler/disk";
import type { Pools } from "../scheduler/pools";
import { poolsFor } from "../scheduler/pools";
import type { ProjectDb } from "../store/project-db";
import { contentState, deleteScratch, recordGit, restoreState, undoInterrupted } from "../workdir/content-state";
import { gitWork } from "../workdir/git-as";
import { jobBranch } from "../workdir/repo";
import { addWorktree, recreateWorktree, removeWorktree, workdirOf } from "../workdir/worktrees";
import { assertTransition, isFinal } from "./job-machine";
import { nextStep } from "./rules";
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
  db: ProjectDb;
  project: Project;
  defs: Definitions;
  user: string;
  settings: Settings;
  pools: Pools;
  notify(n: { kind: string; title: string; body: string; jobId: string }): void;
  changed(jobId: string): void;
  released(): void;
};

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

  constructor(readonly ctx: ProjectContext) {}

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
      const d = nextStep(recipe, this.byId(recipe), this.history(jobId), this.allowances(jobId));
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
    if (job.parent_job_id !== null) return false;
    if (!(await enoughDisk(this.ctx.dir, this.ctx.settings.minFreeDiskGb))) {
      if (job.waiting_reason !== "disk") this.ctx.db.append([{ jobId: job.id, type: "job.state_changed", payload: { state: "queued", reason: "disk" } }]);
      return false;
    }
    await addWorktree(this.ctx.user, this.ctx.dir, job.id, job.base);
    this.setState(job.id, "running", null);
    return true;
  }

  private async finish(job: JobRow, state: "succeeded" | "not_delivered" | "failed", reason: string | null): Promise<void> {
    if (state !== "failed") await removeWorktree(this.ctx.user, this.ctx.dir, workdirOf(this.ctx.dir, job.id));
    this.setState(job.id, state, reason);
    this.ctx.notify({ kind: "job-finished", title: job.title, body: `${state}${reason ? `: ${reason}` : ""}`, jobId: job.id });
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
    if (node.kind !== "command") {
      this.ctx.db.append([{ jobId: job.id, type: "node_run.failed", payload: { nodeRunId: run.id, reason: "HARNESS_ERROR" } }]);
      await this.finish(job, "failed", "HARNESS_ERROR");
      return false;
    }

    const pools = poolsFor(this.ctx.id);
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
        this.ctx.db.append([{ jobId: job.id, type: "attempt.started", payload: { attemptId, nodeRunId: run.id, profile: null, connector: null, harnessVersion: null, connectorVersion: null, account: null, osUser: this.ctx.user, sessionGroup: null, logPath } }]);
        const log = await LogWriter.open(join(this.ctx.dir, logPath));
        const latest = this.latest(job.id);
        const commit = latest.get("commit");
        const commitSha = commit ? (JSON.parse(await readFile(join(this.ctx.dir, commit.path), "utf8")) as { sha: string }).sha : null;
        this.running.set(job.id, null);
        const result = await runCommandNode({
          node,
          nodeDir: join(this.ctx.dir, "nodes"),
          params: paramsWithDefaults(node.params, recipeNode.params),
          user: this.ctx.user,
          workdir: wd,
          context: {
            job: { id: job.id, title: job.title, branch: job.branch, base: job.base, oldBase: job.old_base, target: job.target, commit: commitSha },
            ticketId: null,
            project: { repoDir: join(this.ctx.dir, "repo.git"), repoUrl: this.ctx.project.repo?.url ?? null },
          },
          inputs: node.inputs.flatMap((t) => {
            const a = latest.get(t);
            return a ? [{ type: t, path: join(this.ctx.dir, a.path) }] : [];
          }),
          cleanTree: node.cleanCheckout ? before : null,
          onStart: (pgid, user) => {
            this.running.set(job.id, { pgid, user });
            if (this.stopRequested.has(job.id) || this.closing) void stopGroup(user, pgid);
            this.setRun(job.id, run.id, "running", null, { pgid, osUser: user });
          },
          effect: effectRecorder(this.ctx.db, job.id, run.id, run.node),
        });
        this.running.delete(job.id);
        log.write({ dir: "cmd", text: result.log, at: Date.now() });
        await log.close();
        if (this.closing) return false;
        const end = (reason: string) =>
          this.ctx.db.append([{ jobId: job.id, type: "attempt.ended", payload: { attemptId, endReason: reason, model: null, account: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: null, day: new Date().toISOString().slice(0, 10) } }]);

        if (this.stopRequested.has(job.id)) {
          end("interrupted");
          await this.interrupt(job.id, run.id, git, before);
          return false;
        }
        if (result.kind === "waiting") {
          end("network");
          const n = this.networkFailures.get(run.id) ?? 0;
          this.networkFailures.set(run.id, n + 1);
          const delay = backoffMs[Math.min(n, backoffMs.length - 1)]!;
          this.setRun(job.id, run.id, "waiting", "network", { resetAt: Date.now() + delay });
          this.setState(job.id, "waiting", "network");
          this.timers.set(job.id, setTimeout(() => void this.retryNetwork(job.id, run.id), delay));
          return false;
        }
        this.networkFailures.delete(run.id);
        if (result.kind === "failed") {
          end(result.reason);
          await undoInterrupted(this.ctx.user, wd, job.id, git, before);
          if (attempt + 1 < attempts) continue;
          await this.saveArtifact(job.id, runDir, "check-log", result.log, before);
          this.fail(job, run.id, result.reason);
          return false;
        }
        end(result.outcome);
        await deleteScratch(this.ctx.user, wd, node.scratchPaths, before);
        const after = await contentState(this.ctx.user, wd);
        if (!node.changesFiles && after !== before) {
          await restoreState(this.ctx.user, wd, before);
          this.fail(job, run.id, "READ_ONLY_VIOLATION");
          return false;
        }
        const artifacts: Artifact[] = [await this.saveArtifact(job.id, runDir, "check-log", result.log, after)];
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
        return true;
      }
      return false;
    } finally {
      this.ctx.pools.release(pools);
      this.ctx.released();
    }
  }

  private complete(jobId: string, nodeRunId: string, outcome: string, before: string | null, after: string | null, artifacts: Artifact[]): void {
    this.ctx.db.append([{ jobId, type: "node_run.completed", payload: { nodeRunId, outcome, contentBefore: before, contentAfter: after, artifacts } }]);
    this.ctx.changed(jobId);
  }

  private fail(job: JobRow, nodeRunId: string, reason: FailureReason): void {
    this.ctx.db.append([{ jobId: job.id, type: "node_run.failed", payload: { nodeRunId, reason } }]);
    this.setState(job.id, "failed", reason);
    this.ctx.notify({ kind: "job-finished", title: job.title, body: `failed: ${reason}`, jobId: job.id });
  }

  private async interrupt(jobId: string, nodeRunId: string, git: { branch: string | null; head: string | null; stash: string | null } | null, before: string | null): Promise<void> {
    if (git && before) await undoInterrupted(this.ctx.user, workdirOf(this.ctx.dir, jobId), jobId, git, before);
    this.setRun(jobId, nodeRunId, "interrupted", null);
  }

  private async retryNetwork(jobId: string, nodeRunId: string): Promise<void> {
    this.timers.delete(jobId);
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      if (job.state !== "waiting" || job.waiting_reason !== "network") return;
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
    const jobId = item.job_id;
    await this.exclusive(jobId, async () => {
      const job = this.job(jobId);
      this.ctx.db.append([{ jobId, type: "queue.resolved", payload: { itemId, state: "resolved", choice, note } }]);
      if (item.kind === "round-limit") {
        if (job.state === "waiting") this.setState(jobId, "running", null);
        if (choice === "end") this.setState(jobId, "failed", "round_limit");
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
        const git = r.git_before ? (JSON.parse(r.git_before) as { branch: string | null; head: string | null; stash: string | null }) : null;
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
      await removeWorktree(this.ctx.user, this.ctx.dir, workdirOf(this.ctx.dir, jobId));
      await gitWork(this.ctx.user, this.ctx.dir, [`--git-dir=${join(this.ctx.dir, "repo.git")}`, "update-ref", "-d", `refs/heads/${jobBranch(jobId)}`]).catch(() => "");
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
  }
}
