import { EventEmitter } from "node:events";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { defaultJobLimit } from "@pecore/schemas";
import type { Accounts, ForgeAccount, JobState, Profiles, ProjectInput, Settings, Tiers } from "@pecore/schemas";
import { AgentServices, protectedUser } from "./accounts/agents";
import type { AgentPaths } from "./accounts/agents";
import { loadGlobal, loadProject } from "./definitions/load";
import type { DefinitionError } from "./definitions/load";
import { JobExecutor } from "./graph/executor";
import type { ProjectContext } from "./graph/executor";
import { createJob } from "./jobs/create";
import { startMergeWatch } from "./jobs/merge-watch";
import type { CreateJob } from "./jobs/create";
import { homePaths, initHome } from "./home/layout";
import { takeLock } from "./home/lock";
import { beginProject, cancelCreation, finishProject, prepareRepo, readCreation, repoCreated, setupJobId } from "./projects/create";
import type { CreateOptions } from "./projects/create";
import { appUser } from "./runners/process";
import { protectedModeScript, protectedUserExists } from "./osuser/protected-mode";
import { commitDefinition, commitMessage } from "./home/git-commit";
import { ServicesRuntimeController } from "./services/runtime";
import { isFinal } from "./graph/job-machine";
import { Pools } from "./scheduler/pools";
import { ChatsDb } from "./store/chats-db";
import { ProjectDb } from "./store/project-db";

export type EngineOptions = { home: string; library: string; agents?: AgentPaths; checkLogins?: boolean; admin?: (script: string) => Promise<void> };

export class EngineStartError extends Error {
  constructor(readonly errors: DefinitionError[]) {
    super(errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("\n"));
  }
}

type LoadedProject = { ctx: ProjectContext; executor: JobExecutor };

export class Engine extends EventEmitter {
  readonly projects = new Map<string, LoadedProject>();
  readonly projectErrors = new Map<string, DefinitionError[]>();
  readonly creating = new Map<string, { step: number; error: string | null }>();
  private pools!: Pools;
  private settings!: Settings;
  private accounts!: Accounts;
  private profiles!: Profiles;
  private tiers!: Tiers;
  agents: AgentServices | null = null;
  private chats!: ChatsDb;
  private releaseLock!: () => Promise<void>;
  private stopMergeWatch: () => void = () => undefined;

  private constructor(readonly opts: EngineOptions) {
    super();
  }

  static async start(opts: EngineOptions): Promise<Engine> {
    const e = new Engine(opts);
    await e.init();
    return e;
  }

  private async init(): Promise<void> {
    const p = homePaths(this.opts.home);
    await initHome(this.opts.home, { library: this.opts.library });
    this.releaseLock = await takeLock(p.lock);
    const global = await loadGlobal(this.opts.home);
    if (!global.value) {
      await this.releaseLock();
      throw new EngineStartError(global.errors);
    }
    this.settings = global.value.settings;
    this.accounts = global.value.accounts;
    this.profiles = global.value.profiles;
    this.tiers = global.value.tiers;
    if (this.opts.agents) {
      this.agents = new AgentServices(this.opts.agents, this.opts.home, () => this.settings, () => this.accounts);
      for (const e of await this.agents.loadConnectors()) console.error(e);
    }
    const jobLimit = this.settings.limits.jobs ?? defaultJobLimit(cpus().length);
    this.pools = new Pools((pool) => {
      if (pool === "jobs") return jobLimit;
      if (pool === "agents") return this.settings.limits.agents;
      if (pool.startsWith("jobs:")) return this.projects.get(pool.slice(5))?.ctx.project.limits.jobs ?? null;
      if (pool.startsWith("provider:")) return this.settings.limits.providers[pool.slice(9)] ?? null;
      return null;
    });
    this.chats = new ChatsDb(p.chatsDb);
    for (const id of (await readdir(p.projects).catch(() => [] as string[])).sort()) {
      await this.openProject(id);
      const creation = await readCreation(this.projectDir(id));
      if (creation) this.creating.set(id, { step: creation.step, error: "the app quit during project creation" });
    }
    for (const { executor } of this.projects.values()) await executor.recoverAfterRestart();
    if (this.settings.servicesRuntime !== null && [...this.projects.values()].some(({ ctx }) => ctx.project.services !== null)) {
      const live = (jobId: string) => [...this.projects.values()].some(({ executor }) => executor.jobs().some((j) => j.id === jobId && !isFinal(j.state)));
      await new ServicesRuntimeController(this.settings.servicesRuntime).sweep((jobId) => !live(jobId)).catch((e: unknown) => console.error("services sweep:", e));
    }
    this.kick();
    this.stopMergeWatch = startMergeWatch(
      () => this.settings.mergeCheckSec,
      async () => {
        for (const { executor } of this.projects.values()) await executor.checkMerges();
      },
    );
    if (this.agents && this.opts.checkLogins !== false) void this.agents.checkAll().then(() => this.emit("logins"));
  }

  private projectDir(id: string): string {
    return this.settings.projectPaths[id] ?? join(homePaths(this.opts.home).projects, id);
  }

  private async openProject(id: string): Promise<void> {
    const dir = this.projectDir(id);
    const loaded = await loadProject(dir);
    if (!loaded.project) {
      this.projectErrors.set(id, loaded.errors);
      return;
    }
    if (loaded.errors.length) this.projectErrors.set(id, loaded.errors);
    const ctx: ProjectContext = {
      id,
      dir,
      library: homePaths(this.opts.home).library,
      db: new ProjectDb(join(dir, "pecore.db")),
      project: loaded.project,
      defs: loaded,
      user: this.settings.protectedMode ? protectedUser : appUser,
      settings: this.settings,
      pools: this.pools,
      notify: (n) => {
        this.chats.addNotification({ kind: n.kind, title: n.title, body: n.body, target: { project: id, job: n.jobId } });
        this.emit("notify", { ...n, projectId: id });
      },
      changed: (jobId) => this.emit("job", { projectId: id, jobId }),
      released: () => this.kick(),
      agents: this.agents,
      setupEnded: (state) => this.setupEnded(id, state),
      forgeAccount: (accountId) => this.accounts.accounts.find((a): a is ForgeAccount => a.kind === "forge" && a.id === accountId),
      global: () => ({ profiles: this.profiles, tiers: this.tiers }),
      live: (attemptId, line) => this.emit("log", { projectId: id, attemptId, line }),
    };
    this.projects.set(id, { ctx, executor: new JobExecutor(ctx) });
  }

  private kick(): void {
    for (const { executor } of this.projects.values()) void executor.kick();
  }

  project(id: string): LoadedProject {
    const p = this.projects.get(id);
    if (!p) throw new Error(`project ${id} not found`);
    return p;
  }

  private createOptions(): CreateOptions {
    return { accounts: this.accounts, protectedMode: this.settings.protectedMode, ...(this.opts.admin ? { admin: this.opts.admin } : {}) };
  }

  async createProject(input: ProjectInput, recipes: string[]): Promise<void> {
    const project = await beginProject(this.opts.home, input, recipes, this.createOptions());
    await this.continueCreation(project.id);
  }

  async continueCreation(id: string): Promise<void> {
    const dir = this.projectDir(id);
    const creation = await readCreation(dir);
    if (!creation) return;
    if (!this.projects.has(id)) await this.openProject(id);
    const { ctx, executor } = this.project(id);
    try {
      if (creation.step < 4 && (await prepareRepo(this.opts.home, dir, ctx.project, this.createOptions())) === "setup") {
        const setup = executor.jobs().find((j) => j.id === setupJobId);
        if (!setup) await executor.createSetupJob(ctx.project.createRepo!);
        else if (setup.state === "succeeded") {
          await repoCreated(dir, ctx.project);
          return await this.continueCreation(id);
        } else if (setup.state === "failed" || setup.state === "stopped") await executor.resume(setupJobId);
        else if (setup.state === "paused") await executor.play(setupJobId);
        this.creating.set(id, { step: creation.step, error: null });
        return;
      }
      const findings = await finishProject(this.opts.home, dir, ctx.project, this.createOptions());
      this.creating.delete(id);
      for (const f of findings) {
        const body = `${f.path} can be read by other users; run: ${f.fix.join(" ")}`;
        this.chats.addNotification({ kind: "home-check", title: "Login files are readable", body, target: { project: id, job: null } });
      }
    } catch (e) {
      this.creating.set(id, { step: creation.step, error: (e as Error).message });
      throw e;
    }
  }

  async cancelCreation(id: string): Promise<void> {
    const dir = this.projectDir(id);
    if (!(await readCreation(dir))) throw new Error(`project ${id} is not being created`);
    const p = this.projects.get(id);
    if (p) {
      await p.executor.close();
      p.ctx.db.close();
      this.projects.delete(id);
    }
    await cancelCreation(this.opts.home, dir, id);
    this.creating.delete(id);
  }

  async setProtectedMode(on: boolean, removeUser = false): Promise<void> {
    if (!this.opts.admin) throw new Error("protected mode needs the admin prompt");
    const executors = [...this.projects.values()].map((p) => p.executor);
    for (const executor of executors) for (const job of executor.jobs()) if (job.state === "running" || job.state === "waiting") await executor.pause(job.id);
    const end = Date.now() + 30 * 60_000;
    while (executors.some((e) => e.jobs().some((j) => j.state === "running"))) {
      if (Date.now() > end) throw new Error("jobs did not pause within 30 minutes");
      await new Promise((r) => setTimeout(r, 200));
    }
    const dirs = [...this.projects.values()].map((p) => p.ctx.dir);
    await this.opts.admin(protectedModeScript(on, dirs, { createUser: !(await protectedUserExists()), removeUser }));
    const file = homePaths(this.opts.home).settings;
    const current = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as Record<string, unknown>;
    await writeFile(file, JSON.stringify({ ...current, protectedMode: on }, null, 2) + "\n");
    await commitDefinition(this.opts.home, [file], commitMessage("settings", "protectedMode", "edited"));
    this.settings = { ...this.settings, protectedMode: on };
    for (const { ctx } of this.projects.values()) {
      ctx.settings = this.settings;
      ctx.user = on ? protectedUser : appUser;
    }
  }

  private setupEnded(id: string, state: JobState): void {
    if (state !== "succeeded") {
      this.creating.set(id, { step: 3, error: `the repository creation job ended ${state}` });
      return;
    }
    void this.continueCreation(id).catch((e: unknown) => console.error(`project ${id}:`, e));
  }

  async createJob(projectId: string, req: CreateJob): Promise<string> {
    const p = this.project(projectId);
    const id = await createJob(p.ctx, req);
    void p.executor.tick(id);
    return id;
  }

  async shutdown(): Promise<void> {
    this.stopMergeWatch();
    await Promise.all([...this.projects.values()].map(({ executor }) => executor.close()));
    for (const { ctx } of this.projects.values()) ctx.db.close();
    this.chats.close();
    await this.releaseLock();
  }
}

export type { CreateJob };
