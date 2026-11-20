import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { applyTraverseAcls } from "./osuser/acl";
import { cpus } from "node:os";
import { join, relative, resolve } from "node:path";
import { removeAs } from "./workdir/fs-as";
import { BuiltInHarness, defaultJobLimit, roleProfile, withForgeHosts } from "@pecore/schemas";
import { listOptions, satisfies } from "@pecore/agents";
import type { LoginState } from "@pecore/agents";
import type { Account, Accounts, ForgeAccount, JobState, LiveMessage, LoginView, NotificationTarget, Profiles, ProjectInput, Settings, SetupView, Tiers, WhyView } from "@pecore/schemas";
import type { ExportProjectBody, ExportProjectResult, ImportProjectBody, ImportProjectResult } from "@pecore/schemas";
import { AgentServices, protectedUser, spawnFor } from "./accounts/agents";
import type { AgentPaths, LoginInfo } from "./accounts/agents";
import { LoginRunner } from "./accounts/login";
import { identityOk } from "./runners/forge-env";
import { loadGlobal, loadProject } from "./definitions/load";
import type { DefinitionError, Global } from "./definitions/load";
import { JobExecutor } from "./graph/executor";
import type { JobRow, ProjectContext } from "./graph/executor";
import { logEvents } from "./observability/log-events";
import { whyJob } from "./observability/why";
import type { Notification } from "./store/chats-db";
import { createJob } from "./jobs/create";
import { startMergeWatch } from "./jobs/merge-watch";
import { resumeOrders } from "./jobs/plan";
import type { CreateJob } from "./jobs/create";
import type { TicketOrder } from "./jobs/plan";
import { homePaths, initHome } from "./home/layout";
import { autoSetup, openCodeModels } from "./home/autosetup";
import { takeLock } from "./home/lock";
import { beginProject, cancelCreation, finishProject, prepareRepo, readCreation, repoCreated, setupJobId } from "./projects/create";
import type { CreateOptions } from "./projects/create";
import { appUser, baseEnv } from "./runners/process";
import { protectedModeScript, protectedUserExists } from "./osuser/protected-mode";
import { commitDefinition, commitMessage } from "./home/git-commit";
import { ServicesRuntimeController } from "./services/runtime";
import { isFinal } from "./graph/job-machine";
import { Pools } from "./scheduler/pools";
import { ChatsDb } from "./store/chats-db";
import { ProjectDb } from "./store/project-db";
import { startSourcePolling } from "./sources/poll";
import type { OrderSink } from "./sources/poll";
import { OrchestratorChats } from "./orchestrator/chat";
import { intakeSink } from "./orchestrator/intake";
import { exportProject } from "./share/export";
import { beginImport } from "./share/import";

export type EngineOptions = { home: string; library: string; agents?: AgentPaths; checkLogins?: boolean; admin?: (script: string) => Promise<void>; orders?: OrderSink; notify?: (notification: Pick<Notification, "kind" | "title" | "body">) => void };

export class EngineStartError extends Error {
  constructor(readonly errors: DefinitionError[]) {
    super(errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("\n"));
  }
}

export class NotFoundError extends Error {}

type LoadedProject = { ctx: ProjectContext; executor: JobExecutor; sourcePolling?: ReturnType<typeof startSourcePolling>; deleting?: boolean };

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
  orchestrator!: OrchestratorChats;
  private chats!: ChatsDb;
  private intake: OrderSink | null = null;
  private stoppingOrchestrator: Promise<void> | null = null;
  private releaseLock!: () => Promise<void>;
  private stopMergeWatch: () => void = () => undefined;
  private globalFilesPending: Promise<unknown> = Promise.resolve();
  private shuttingDown: boolean = false;
  private readonly openCodeReady = new Map<string, boolean>();
  private setupHarnesses: SetupView["harnesses"] = BuiltInHarness.options.map((connector) => ({ connector, installed: false, version: null, loggedIn: false }));
  globalPause = false;
  private readonly loginRunner = new LoginRunner((p) => this.live({ type: "login.progress", ...p }));
  private readonly pausedByGlobal = new Set<string>();

  private constructor(readonly opts: EngineOptions) {
    super();
  }

  static async start(opts: EngineOptions): Promise<Engine> {
    const e = new Engine(opts);
    if (opts.notify) e.on("notify", opts.notify);
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
    this.accounts = withForgeHosts(global.value.accounts);
    this.profiles = global.value.profiles;
    this.tiers = global.value.tiers;
    if (this.opts.agents) {
      this.agents = new AgentServices(this.opts.agents, this.opts.home, () => this.settings, () => this.accounts);
      for (const e of await this.agents.loadConnectors()) console.error(e);
    }
    this.pools = new Pools((pool) => {
      if (pool === "jobs") return this.settings.limits.jobs ?? defaultJobLimit(cpus().length);
      if (pool === "agents") return this.settings.limits.agents;
      if (pool.startsWith("jobs:")) return this.projects.get(pool.slice(5))?.ctx.project.limits.jobs ?? null;
      if (pool.startsWith("provider:")) return this.settings.limits.providers[pool.slice(9)] ?? null;
      return null;
    });
    this.chats = new ChatsDb(p.chatsDb);
    this.orchestrator = new OrchestratorChats(this, this.chats, (message) => this.live(message));
    if (this.opts.checkLogins !== false) await this.runAutoSetup();
    for (const id of (await readdir(p.projects).catch(() => [] as string[])).sort()) {
      await this.openProject(id);
      const creation = await readCreation(this.projectDir(id));
      if (creation) this.creating.set(id, { step: creation.step, error: "the app quit during project creation" });
    }
    for (const { executor } of this.projects.values()) await executor.recoverAfterRestart();
    const resumedOrders: Map<LoadedProject, TicketOrder[]> = new Map();
    for (const project of this.projects.values()) {
      const resumed: TicketOrder[] = await resumeOrders(project.ctx);
      if (this.opts.orders && !this.creating.has(project.ctx.id)) resumedOrders.set(project, resumed);
    }
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
    if (this.agents && this.opts.checkLogins !== false) void this.checkAllLogins().then(() => this.emit("logins")).catch((error: unknown) => console.error("login check:", error));
    if (this.opts.orders) {
      for (const [project, resumed] of resumedOrders) project.sourcePolling = startSourcePolling(project.ctx, this.opts.orders, resumed);
    }
  }

  projectDir(id: string): string {
    if (Object.hasOwn(this.settings.projectPaths, id)) return this.settings.projectPaths[id]!;
    return join(homePaths(this.opts.home).projects, id);
  }

  global(): Global {
    return { settings: this.settings, accounts: this.accounts, profiles: this.profiles, tiers: this.tiers };
  }

  withGlobalFiles<T>(work: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.globalFilesPending.then(work);
    this.globalFilesPending = result.catch(() => undefined);
    return result;
  }

  private async runAutoSetup(): Promise<void> {
    const agents: AgentServices | null = this.agents;
    if (!agents || this.shuttingDown) return;
    await this.withGlobalFiles(async () => {
      const { harnesses, changes } = await autoSetup(this.opts.home, agents);
      this.setupHarnesses = harnesses;
      if (!changes) return;
      await this.reloadGlobal();
      this.notify({ kind: "auto-setup", title: "PeCore setup", body: changes.message });
      for (const [kind, content] of Object.entries(changes.files)) {
        this.definitionChanged(`${kind}.json`, createHash("sha256").update(content).digest("hex"));
      }
    }).catch((error: unknown) => console.error("auto-setup:", error));
  }

  async setupView(): Promise<SetupView> {
    const logins: LoginView[] = await this.loginViews().catch(() => []);
    const modelAccountWorks: boolean = logins.some((login) => {
      const harness: SetupView["harnesses"][number] | undefined = this.setupHarnesses.find((item) => item.connector === login.connector);
      if (!harness) return login.state === "logged_in";
      if (harness.connector === "opencode") return harness.loggedIn;
      const range: string | undefined = this.agents?.connector(login.connector)?.harness.versionRange;
      return login.state === "logged_in" && harness.version !== null && range !== undefined && satisfies(harness.version, range);
    });
    return { harnesses: this.setupHarnesses, modelAccountWorks };
  }

  private orderSink(): OrderSink | null {
    return this.opts.orders ?? (roleProfile(this.settings, "orchestrator") ? this.intake : null);
  }

  async startOrchestrator(url: string, token: string): Promise<void> {
    await this.orchestrator.start(url, token);
    this.intake = intakeSink(this.orchestrator);
    await this.refreshSourcePolling();
  }

  stopOrchestrator(): Promise<void> {
    this.stoppingOrchestrator ??= this.orchestrator.close();
    return this.stoppingOrchestrator;
  }

  private async refreshSourcePolling(): Promise<void> {
    const sink: OrderSink | null = this.orderSink();
    for (const project of this.projects.values()) {
      if (!sink && project.sourcePolling) {
        const existing = project.sourcePolling;
        delete project.sourcePolling;
        await existing.close();
      }
      if (sink && !project.sourcePolling && !this.creating.has(project.ctx.id)) {
        const resumed: TicketOrder[] = await resumeOrders(project.ctx);
        if (sink === this.orderSink() && !this.stoppingOrchestrator && !project.sourcePolling) {
          project.sourcePolling = startSourcePolling(project.ctx, sink, resumed);
        }
      }
    }
  }

  async reloadProject(id: string): Promise<DefinitionError[]> {
    const p = this.projects.get(id);
    if (!p) return [];
    const loaded = await loadProject(p.ctx.dir);
    if (loaded.project) {
      p.ctx.project = loaded.project;
      p.ctx.defs = loaded;
      p.sourcePolling?.wake();
    }
    if (loaded.errors.length) this.projectErrors.set(id, loaded.errors);
    else this.projectErrors.delete(id);
    this.live({ type: "project.updated", projectId: id });
    return loaded.errors;
  }

  async reloadGlobal(): Promise<DefinitionError[]> {
    const g = await loadGlobal(this.opts.home);
    if (!g.value) return g.errors;
    this.settings = g.value.settings;
    this.accounts = withForgeHosts(g.value.accounts);
    this.profiles = g.value.profiles;
    this.tiers = g.value.tiers;
    for (const { ctx } of this.projects.values()) ctx.settings = this.settings;
    await this.refreshSourcePolling();
    this.kick();
    return [];
  }

  private loginView(l: LoginInfo): LoginView {
    const s = l.state;
    return {
      id: l.id,
      account: l.account,
      osUser: l.osUser,
      connector: l.connector,
      defaultDir: l.defaultDir,
      state: s.state === "unknown" && this.openCodeReady.get(l.id) ? "logged_in" : s.state,
      email: s.state === "logged_in" ? s.email : null,
      plan: s.state === "logged_in" ? (s.plan ?? null) : null,
      running: this.loginRunner.isActive(l.id),
    };
  }

  private async loginInfo(id: string): Promise<LoginInfo> {
    const l = (await this.agents?.logins())?.find((x) => x.id === id);
    if (!l) throw new NotFoundError(`login ${id} not found`);
    return l;
  }

  async loginViews(): Promise<LoginView[]> {
    return ((await this.agents?.logins()) ?? []).map((l) => this.loginView(l));
  }

  private async releaseAuth(account: string, osUser: string | null): Promise<void> {
    for (const { executor } of this.projects.values()) await executor.releaseAuth(account, osUser);
  }

  private async checkLoginInfo(l: LoginInfo): Promise<LoginState> {
    const state = await this.agents!.check(l);
    await this.checkOpenCode(l, state);
    if (state.state !== "logged_out") await this.releaseAuth(l.account, l.osUser);
    return state;
  }

  private async checkOpenCode(l: LoginInfo, state: LoginState): Promise<void> {
    if (state.state !== "unknown" || l.connector !== "opencode") return;
    const connector = await this.agents!.resolve(l.connector);
    this.openCodeReady.set(l.id, (await openCodeModels(connector, l).catch(() => null)) !== null);
  }

  private async checkAllLogins(): Promise<void> {
    await this.agents!.checkAll();
    for (const l of await this.agents!.logins()) await this.checkOpenCode(l, l.state.state === "unchecked" ? { state: "unknown" } : l.state);
  }

  async startLogin(account: string, osUser: string): Promise<string> {
    const l = (await this.agents?.logins())?.find((x) => x.account === account && x.osUser === osUser);
    if (!l) throw new NotFoundError(`no login for account ${account} and user ${osUser}`);
    await this.loginRunner.harness(this.agents!, l, () => this.finishHarnessLogin(l));
    return l.id;
  }

  async startSetupLogin(connector: BuiltInHarness): Promise<string> {
    if (!this.agents || !this.setupHarnesses.some((harness) => harness.connector === connector && harness.installed)) throw new NotFoundError(`${connector} is not installed`);
    const login: LoginInfo = await this.agents.setupLogin(connector);
    await this.loginRunner.harness(this.agents, login, () => this.finishHarnessLogin(login));
    return login.id;
  }

  private async finishHarnessLogin(login: LoginInfo): Promise<string> {
    try {
      return (await this.checkLoginInfo(login)).state;
    } finally {
      await this.runAutoSetup();
    }
  }

  sendLoginCode(id: string, code: string): void {
    this.loginRunner.sendCode(id, code);
  }

  async recheckLogin(id: string): Promise<LoginView> {
    const l = await this.loginInfo(id);
    await this.checkLoginInfo(l);
    return this.loginView(await this.loginInfo(id));
  }

  private account(id: string): Account {
    const a = this.accounts.accounts.find((x) => x.id === id);
    if (!a) throw new NotFoundError(`account ${id} not found`);
    return a;
  }

  async recheckAccount(id: string): Promise<"logged_in" | "logged_out" | "unknown"> {
    const a = this.account(id);
    if (a.kind === "forge") {
      const ok = await identityOk(a);
      if (ok) await this.releaseAuth(id, null);
      return ok ? "logged_in" : "logged_out";
    }
    if (a.kind === "service") return "unknown";
    const states = [];
    for (const l of ((await this.agents?.logins()) ?? []).filter((x) => x.account === id)) states.push((await this.checkLoginInfo(l)).state);
    return states.includes("logged_out") ? "logged_out" : states.length > 0 && states.every((s) => s === "logged_in") ? "logged_in" : "unknown";
  }

  async startAccountLogin(id: string): Promise<string> {
    const a = this.account(id);
    if (a.kind !== "forge") throw new Error(`account ${id} has no tool login in PeCore; log in with ${a.kind === "service" ? a.tool : "the harness"} and recheck`);
    const loginId = `tool:${id}`;
    await this.loginRunner.tool(loginId, a, () => this.recheckAccount(id));
    return loginId;
  }

  async accountOptions(id: string): Promise<{ models: string[]; efforts: string[] } | null> {
    this.account(id);
    for (const l of ((await this.agents?.logins()) ?? []).filter((x) => x.account === id)) {
      const connector = await this.agents!.resolve(l.connector);
      await this.agents!.ensureProbeDir(l);
      const options = await listOptions({ connector, login: l, spawn: spawnFor(l.osUser), allowUnknownIdentity: true }).catch(() => null);
      const cli = l.connector === "opencode" ? await openCodeModels(connector, l).catch(() => null) : null;
      if (options || cli) return { models: cli?.models ?? options?.models ?? [], efforts: options?.efforts ?? [] };
    }
    return null;
  }

  definitionChanged(path: string, sha256: string | null): void {
    this.live({ type: "definition.changed", path, sha256 });
  }

  private async openProject(id: string): Promise<void> {
    const dir = this.projectDir(id);
    const loaded = await loadProject(dir);
    if (!loaded.project) {
      this.projectErrors.set(id, loaded.errors);
      return;
    }
    if (loaded.errors.length) this.projectErrors.set(id, loaded.errors);
    const db: ProjectDb = new ProjectDb(join(dir, "pecore.db"));
    const ctx: ProjectContext = {
      id,
      dir,
      library: homePaths(this.opts.home).library,
      db,
      project: loaded.project,
      defs: loaded,
      user: this.settings.protectedMode ? protectedUser : appUser,
      settings: this.settings,
      pools: this.pools,
      notify: (n) => this.notify({ kind: n.kind, title: n.title, body: n.body, target: { project: id, job: n.jobId, item: null } }),
      changed: (jobId) => {
        this.emit("job", { projectId: id, jobId });
        this.live({ type: "job.updated", projectId: id, jobId });
      },
      released: () => this.kick(),
      held: () => this.globalPause,
      agents: this.agents,
      orderAttachments: (orderId, attachmentIds) => this.orchestrator.jobAttachments(orderId, attachmentIds),
      rejectImport: (resolve) => this.deleteProject(id, resolve),
      setupEnded: (state) => this.setupEnded(id, state),
      forgeAccount: (accountId) => this.accounts.accounts.find((a): a is ForgeAccount => a.kind === "forge" && a.id === accountId),
      global: () => ({ profiles: this.profiles, tiers: this.tiers }),
      live: (attemptId, line) => {
        this.emit("log", { projectId: id, attemptId, line });
        for (const event of logEvents(line)) this.live({ type: "log.line", attemptId, event });
      },
    };
    ctx.db.onAppend = (events) => {
      for (const e of events) {
        if (e.type.startsWith("node_run.") && e.jobId !== null && "nodeRunId" in e.payload) this.live({ type: "node_run.updated", projectId: id, jobId: e.jobId, nodeRunId: e.payload.nodeRunId });
        if (e.type.startsWith("job.") && e.jobId !== null) this.live({ type: "job.updated", projectId: id, jobId: e.jobId });
        if (e.type === "queue.added" || e.type === "queue.resolved") this.live({ type: "queue.updated", projectId: id, itemId: e.payload.itemId });
        if (e.type === "queue.resolved" && e.jobId === null && e.payload.choice === "confirm") {
          const project: LoadedProject | undefined = this.projects.get(id);
          const imported: unknown = ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE id = ? AND kind = 'import'").get(e.payload.itemId);
          if (imported) {
            void resumeOrders(ctx).then((orders) => project?.sourcePolling?.wake(orders)).catch((error: unknown) => console.error(`orders of project ${id}:`, error));
          } else project?.sourcePolling?.wake();
        }
      }
    };
    this.projects.set(id, { ctx, executor: new JobExecutor(ctx) });
  }

  private live(msg: LiveMessage): void {
    this.emit("live", msg);
  }

  private setCreating(id: string, value: { step: number; error: string | null } | null): void {
    if (value === null) this.creating.delete(id);
    else this.creating.set(id, value);
    this.live({ type: "project.updated", projectId: id });
  }

  findJob(jobId: string): LoadedProject & { job: JobRow } {
    if (jobId !== setupJobId)
      for (const p of this.projects.values()) {
        const job = p.ctx.db.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
        if (job) return { ...p, job };
      }
    throw new NotFoundError(`job ${jobId} not found`);
  }

  findQueueItem(itemId: string): LoadedProject {
    for (const p of this.projects.values()) if (p.ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE id = ?").get(itemId)) return p;
    throw new NotFoundError(`queue item ${itemId} not found`);
  }

  why(jobId: string): WhyView {
    const { ctx, job } = this.findJob(jobId);
    return whyJob(ctx, job, this.globalPause);
  }

  async pauseAll(): Promise<void> {
    this.globalPause = true;
    for (const { ctx, executor } of this.projects.values())
      for (const job of executor.jobs())
        if (job.state === "running" || job.state === "waiting") {
          this.pausedByGlobal.add(`${ctx.id}/${job.id}`);
          await executor.pause(job.id);
        }
  }

  async playAll(): Promise<void> {
    this.globalPause = false;
    for (const key of this.pausedByGlobal) {
      const [projectId, jobId] = key.split("/") as [string, string];
      const p = this.projects.get(projectId);
      const job = p?.executor.jobs().find((j) => j.id === jobId);
      if (p && job?.state === "paused" && job.waiting_reason === "user") await p.executor.play(jobId);
    }
    this.pausedByGlobal.clear();
    this.kick();
  }

  async playInterrupted(): Promise<void> {
    for (const { executor } of this.projects.values()) for (const job of executor.jobs()) if (job.state === "paused" && job.waiting_reason === "quit") await executor.play(job.id);
  }

  interrupted(): number {
    return [...this.projects.values()].reduce((n, { executor }) => n + executor.jobs().filter((j) => j.state === "paused" && j.waiting_reason === "quit").length, 0);
  }

  notificationCount(): number {
    const open: number = [...this.projects.values()].reduce((n, { ctx }) => n + (ctx.db.db.prepare("SELECT COUNT(*) AS n FROM human_queue WHERE state = 'open' AND kind != 'agent-question'").get() as { n: number }).n, 0);
    return open + this.chats.unseenNotifications();
  }

  notifications(): Notification[] {
    return this.chats.notifications();
  }

  notify(n: { kind: string; title: string; body: string; target?: NotificationTarget }): void {
    this.chats.addNotification(n);
    this.emit("notify", { kind: n.kind, title: n.title, body: n.body });
    this.live({ type: "notify", kind: n.kind, title: n.title, body: n.body });
  }

  markNotificationsSeen(): void {
    this.chats.markNotificationsSeen();
    this.live({ type: "notify", kind: "seen", title: "", body: "" });
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

  async exportProject(id: string, input: ExportProjectBody): Promise<ExportProjectResult> {
    const project: LoadedProject | undefined = this.projects.get(id);
    if (!project) throw new NotFoundError(`project ${id} not found`);
    return exportProject(project.ctx, input);
  }

  async importProject(input: ImportProjectBody): Promise<ImportProjectResult> {
    const result: ImportProjectResult = await beginImport(this.opts.home, input, {
      accounts: this.accounts,
      knownProject: (id) => this.projects.has(id) || this.creating.has(id) || this.projectErrors.has(id) ||
        resolve(this.projectDir(id)) !== resolve(homePaths(this.opts.home).projects, id),
    });
    if (result.state === "imported") await this.continueCreation(result.id);
    return result;
  }

  async continueCreation(id: string): Promise<void> {
    const dir = this.projectDir(id);
    const creation = await readCreation(dir);
    if (!creation) return;
    if (!this.projects.has(id)) await this.openProject(id);
    const loaded: LoadedProject = this.project(id);
    const { ctx, executor } = loaded;
    try {
      if (creation.step < 4 && (await prepareRepo(this.opts.home, dir, ctx.project, this.createOptions())) === "setup") {
        const setup = executor.jobs().find((j) => j.id === setupJobId);
        if (!setup) await executor.createSetupJob(ctx.project.createRepo!);
        else if (setup.state === "succeeded") {
          await repoCreated(dir, ctx.project);
          return await this.continueCreation(id);
        } else if (setup.state === "failed" || setup.state === "stopped") await executor.resume(setupJobId);
        else if (setup.state === "paused") await executor.play(setupJobId);
        this.setCreating(id, { step: creation.step, error: null });
        return;
      }
      const findings = await finishProject(this.opts.home, dir, ctx.project, this.createOptions());
      const sink: OrderSink | null = this.orderSink();
      if (sink && !loaded.sourcePolling) loaded.sourcePolling = startSourcePolling(ctx, sink, []);
      this.setCreating(id, null);
      for (const f of findings) {
        const body = `${f.path} can be read by other users; run: ${f.fix.join(" ")}`;
        this.notify({ kind: "home-check", title: "Login files are readable", body, target: { project: id, job: null, item: null } });
      }
    } catch (e) {
      this.setCreating(id, { step: creation.step, error: (e as Error).message });
      throw e;
    }
  }

  async cancelCreation(id: string): Promise<void> {
    const dir = this.projectDir(id);
    if (!(await readCreation(dir))) throw new Error(`project ${id} is not being created`);
    const p = this.projects.get(id);
    if (p) {
      await p.sourcePolling?.close();
      await p.executor.close();
      p.ctx.db.close();
      this.projects.delete(id);
    }
    await cancelCreation(this.opts.home, dir, id);
    this.setCreating(id, null);
  }

  async deleteProject(id: string, resolveImport?: () => void): Promise<void> {
    const p: LoadedProject = this.project(id);
    if (p.deleting) throw new Error(`project ${id} is being deleted`);
    const running = p.executor.jobs().filter((j) => j.state === "running");
    if (running.length > 0) throw new Error(`stop the running jobs first: ${running.map((j) => j.title).join(", ")}`);
    p.deleting = true;
    try {
      await p.sourcePolling?.close();
      const jobs = p.executor.jobs();
      for (const j of jobs) if (!isFinal(j.state)) await p.executor.stop(j.id);
      for (const j of jobs) await p.executor.services.down(j.id).catch((e: unknown) => console.error("services:", e));
      await p.executor.close();
      resolveImport?.();
      p.ctx.db.close();
      this.projects.delete(id);
      this.projectErrors.delete(id);
      this.creating.delete(id);
      if (p.ctx.user !== appUser) await removeAs(p.ctx.user, p.ctx.dir, "work").catch(() => undefined);
      await rm(p.ctx.dir, { recursive: true, force: true });
      if (!relative(this.opts.home, p.ctx.dir).startsWith("..")) await commitDefinition(this.opts.home, [p.ctx.dir], commitMessage("project", id, "deleted"));
      this.live({ type: "project.updated", projectId: id });
    } finally {
      delete p.deleting;
    }
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
    const exists = await protectedUserExists();
    if (!on && removeUser && exists) await this.protectedTraverse(true);
    const script = protectedModeScript(on, dirs, { createUser: !exists, removeUser });
    if (script !== "") await this.opts.admin(script);
    if (on) await this.protectedTraverse();
    await this.withGlobalFiles(async () => {
      const file = homePaths(this.opts.home).settings;
      const current = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as Record<string, unknown>;
      await writeFile(file, JSON.stringify({ ...current, protectedMode: on }, null, 2) + "\n");
      await commitDefinition(this.opts.home, [file], commitMessage("settings", "protectedMode", "edited"));
      this.settings = { ...this.settings, protectedMode: on };
      for (const { ctx } of this.projects.values()) {
        ctx.settings = this.settings;
        ctx.user = on ? protectedUser : appUser;
      }
    });
  }

  private async protectedTraverse(remove = false): Promise<void> {
    const home = (await baseEnv(appUser)).HOME!;
    const targets = [join(homePaths(this.opts.home).adapters, "version")];
    for (const connector of new Set(this.accounts.accounts.flatMap((a) => (a.kind === "model" ? [a.connector] : [])))) {
      const resolved = await this.agents?.resolve(connector).catch(() => null);
      if (!resolved) continue;
      targets.push(resolved.harnessPath, await realpath(resolved.harnessPath));
    }
    for (const target of new Set(targets)) {
      const rel = relative(home, target);
      if (rel === "" || rel.startsWith("..")) continue;
      await applyTraverseAcls(target, protectedUser, home, remove);
    }
  }

  private setupEnded(id: string, state: JobState): void {
    if (state !== "succeeded") {
      this.setCreating(id, { step: 3, error: `the repository creation job ended ${state}` });
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
    this.shuttingDown = true;
    this.stopMergeWatch();
    const chats: Promise<void> = this.stopOrchestrator();
    await Promise.all([...this.projects.values()].map(({ sourcePolling }) => sourcePolling?.close()));
    await chats;
    await this.loginRunner.stopAll();
    await this.globalFilesPending;
    await Promise.all([...this.projects.values()].map(({ executor }) => executor.close()));
    for (const { ctx } of this.projects.values()) ctx.db.close();
    this.chats.close();
    await this.releaseLock();
  }
}

export type { CreateJob, OrderSink };
