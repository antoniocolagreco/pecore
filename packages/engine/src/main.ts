import { EventEmitter } from "node:events";
import { readdir } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { defaultJobLimit } from "@pecore/schemas";
import type { Accounts, ForgeAccount, Profiles, ProjectInput, Settings, Tiers } from "@pecore/schemas";
import { AgentServices } from "./accounts/agents";
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
import { createProject } from "./projects/create";
import { appUser } from "./runners/process";
import { Pools } from "./scheduler/pools";
import { ChatsDb } from "./store/chats-db";
import { ProjectDb } from "./store/project-db";

export type EngineOptions = { home: string; library: string; agents?: AgentPaths; checkLogins?: boolean };

export class EngineStartError extends Error {
  constructor(readonly errors: DefinitionError[]) {
    super(errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("\n"));
  }
}

type LoadedProject = { ctx: ProjectContext; executor: JobExecutor };

export class Engine extends EventEmitter {
  readonly projects = new Map<string, LoadedProject>();
  readonly projectErrors = new Map<string, DefinitionError[]>();
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
    for (const id of (await readdir(p.projects).catch(() => [] as string[])).sort()) await this.openProject(id);
    for (const { executor } of this.projects.values()) await executor.recoverAfterRestart();
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
      user: appUser,
      settings: this.settings,
      pools: this.pools,
      notify: (n) => {
        this.chats.addNotification({ kind: n.kind, title: n.title, body: n.body, target: { project: id, job: n.jobId } });
        this.emit("notify", { ...n, projectId: id });
      },
      changed: (jobId) => this.emit("job", { projectId: id, jobId }),
      released: () => this.kick(),
      agents: this.agents,
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

  async createProject(input: ProjectInput, recipes: string[]): Promise<void> {
    await createProject(this.opts.home, input, recipes);
    await this.openProject(input.id);
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
