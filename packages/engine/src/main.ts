import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { applyTraverseAcls } from "./osuser/acl";
import { cpus, homedir } from "node:os";
import { join, relative } from "node:path";
import { removeAs } from "./workdir/fs-as";
import { definitionOperations } from "./api/routes/definitions";
import { globalFileHandlers } from "./api/routes/settings";
import { appName, assistantAgentId, BuiltInHarness, defaultAgentId, defaultJobLimit, ForgeDiscovery, freeProjectManager, projectManagerClash, projectManagers, withForgeHosts } from "@pecore/schemas";
import { listOptions, satisfies } from "@pecore/agents";
import type { LoginState } from "@pecore/agents";
import type { Account, AccountOptions, Accounts, AgentDefinitions, ChatAgent, ForgeAccount, JobState, LiveMessage, LoginView, NodeAgent, NodeAgentCatalog, NotificationTarget, ProjectManagerAgent, Profiles, ProjectInput, ProjectManagerIdentity, Settings, SetupView, Tiers, WhyView } from "@pecore/schemas";
import type { AccountDiscovery } from "@pecore/schemas";
import { HttpError } from "./api/server";
import type { CompleteProjectImportBody, ExportProjectBody, ExportProjectResult, ImportProjectBody, ImportProjectPreview, ImportProjectResult } from "@pecore/schemas";
import { AgentServices, protectedUser, spawnFor } from "./accounts/agents";
import type { AgentPaths, LoginInfo } from "./accounts/agents";
import { checkTrackerBridge, TrackerMcpAuthError } from "./accounts/atlassian";
import { LoginRunner } from "./accounts/login";
import { discoverForgeAccounts, forgeLoginUser, newForgeAccounts } from "./accounts/forges";
import { identityOk } from "./runners/forge-env";
import { loadProject, validateGlobal } from "./definitions/load";
import type { DefinitionError, Global } from "./definitions/load";
import { seedTemplates } from "./definitions/seed";
import { JobExecutor } from "./graph/executor";
import type { JobRow, ProjectContext } from "./graph/executor";
import { logEvents } from "./observability/log-events";
import { whyJob } from "./observability/why";
import type { Notification } from "./store/chats-db";
import { createJob } from "./jobs/create";
import { startWatch } from "./jobs/merge-watch";
import { resumeOrders } from "./jobs/plan";
import type { CreateJob } from "./jobs/create";
import { homePaths, initHome } from "./home/layout";
import { closeHome, moveLegacyFolders } from "./home/legacy";
import { ensureBuiltInAgents, findHarness, openCodeModels, registerHarnessAccount, saveHarnessProfiles } from "./home/autosetup";
import { takeLock } from "./home/lock";
import { beginProject, cancelCreation, finishProject, prepareRepo, readCreation, repoCreated, setupJobId } from "./projects/create";
import type { CreateOptions } from "./projects/create";
import { appUser, baseEnv } from "./runners/process";
import { protectedModeScript, protectedUserExists } from "./osuser/protected-mode";
import { ServicesRuntimeController } from "./services/runtime";
import { isFinal } from "./graph/job-machine";
import { Pools } from "./scheduler/pools";
import { ChatsDb } from "./store/chats-db";
import { Catalog } from "./store/catalog";
import { Configuration } from "./store/configuration";
import { ProjectDb } from "./store/project-db";
import { AgentChats } from "./chat/chat";
import { exportProject } from "./share/export";
import { InvalidArchive } from "./share/archive";
import { beginImport, previewImport } from "./share/import";
import { reviewProjectContents } from "./share/review";

export type EngineOptions = { home: string; templates: string; downloads?: string; development?: boolean; agents?: AgentPaths; checkLogins?: boolean; discoverForges?: boolean; detectRuntime?: () => Promise<Settings["servicesRuntime"]>; admin?: (script: string) => Promise<void>; notify?: (notification: Pick<Notification, "kind" | "title" | "body">) => void };

export class EngineStartError extends Error {
  constructor(readonly errors: DefinitionError[]) {
    super(errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("\n"));
  }
}

export class NotFoundError extends Error {}

type LoadedProject = { ctx: ProjectContext; executor: JobExecutor; deleting?: boolean };

export class Engine extends EventEmitter {
  readonly projects = new Map<string, LoadedProject>();
  readonly projectErrors = new Map<string, DefinitionError[]>();
  readonly creating = new Map<string, { step: number; error: string | null }>();
  private pools!: Pools;
  private settings!: Settings;
  private accounts!: Accounts;
  private profiles!: Profiles;
  private agentDefinitions!: AgentDefinitions;
  private tiers!: Tiers;
  agents: AgentServices | null = null;
  agentChats!: AgentChats;
  private chats!: ChatsDb;
  configuration!: Configuration;
  catalog!: Catalog;
  private stoppingAgentChats: Promise<void> | null = null;
  private releaseLock!: () => Promise<void>;
  private stopMergeWatch: () => void = () => undefined;
  private stopCiWatch: () => void = () => undefined;
  private wakeCiWatch: () => void = () => undefined;
  private globalFilesPending: Promise<unknown> = Promise.resolve();
  private shuttingDown: boolean = false;
  private readonly openCodeReady = new Map<string, boolean>();
  private readonly options = new Map<string, Promise<AccountOptions | null>>();
  private startupReads: Promise<void> = Promise.resolve();
  private runtimeDetection: Promise<void> = Promise.resolve();
  setupDone: Promise<void> = Promise.resolve();
  private modelSetupDone: Promise<void> = Promise.resolve();
  private readonly discovering = new Set<AccountDiscovery>();
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
    process.umask(0o077);
    const p = homePaths(this.opts.home);
    await initHome(this.opts.home);
    this.releaseLock = await takeLock(p.lock);
    await moveLegacyFolders(this.opts.home, await protectedUserExists()).catch((e: unknown) => console.error("moving old folders into PECORE_HOME:", e));
    await closeHome(this.opts.home);
    let global: Global;
    try {
      this.chats = new ChatsDb(p.chatsDb);
      this.configuration = new Configuration(this.chats.db);
      this.catalog = new Catalog(this.chats.db);
      await seedTemplates(this.catalog, this.opts.templates);
      global = this.configuration.read();
      const errors: DefinitionError[] = validateGlobal(global);
      if (errors.length) throw new EngineStartError(errors);
      if (ensureBuiltInAgents(this.configuration, false)) global = this.configuration.read();
    } catch (error) {
      this.chats?.close();
      await this.releaseLock();
      throw error;
    }
    this.applyConfiguration(global);
    if (this.opts.agents) {
      this.agents = new AgentServices(this.opts.agents, this.opts.home, () => this.settings, () => this.accounts);
      for (const e of await this.agents.loadConnectors()) console.error(e);
    }
    this.pools = new Pools((pool) => {
      if (pool === "jobs") return this.settings.limits.jobs ?? defaultJobLimit(cpus().length);
      if (pool === "agents") return this.settings.limits.agents;
      return null;
    });
    this.agentChats = new AgentChats(this, this.chats, (message) => this.live(message));
    this.modelSetupDone = this.setupModels(BuiltInHarness.options).catch((error: unknown) => console.error("model setup:", error));
    const forgeSetup: Promise<void> = this.opts.discoverForges
      ? this.setupForges().catch((error: unknown) => console.error("forge setup:", error)) : Promise.resolve();
    this.setupDone = Promise.all([this.modelSetupDone, forgeSetup]).then(() => undefined);
    if (this.opts.detectRuntime && this.settings.servicesRuntime === null) {
      this.runtimeDetection = this.detectServicesRuntime(this.opts.detectRuntime).catch((error: unknown) => console.error("services runtime detection:", error));
    }
    for (const id of (await readdir(p.projects).catch(() => [] as string[])).sort()) {
      await this.openProject(id);
      if (this.projects.has(id)) await this.assignProjectManager(id).catch((e: unknown) => console.error(`project ${id} manager:`, e));
      const creation = await readCreation(this.projectDir(id));
      if (creation) this.creating.set(id, { step: creation.step, error: "the app quit during project creation" });
    }
    for (const { executor } of this.projects.values()) await executor.recoverAfterRestart();
    for (const { ctx } of this.projects.values()) await resumeOrders(ctx);
    if (this.settings.servicesRuntime !== null && this.projects.size > 0) {
      const live = (jobId: string) => [...this.projects.values()].some(({ executor }) => executor.jobs().some((j) => j.id === jobId && !isFinal(j.state)));
      await new ServicesRuntimeController(this.settings.servicesRuntime).sweep((jobId) => !live(jobId)).catch((e: unknown) => console.error("services sweep:", e));
    }
    void this.setupDone.then(() => this.kick());
    this.stopMergeWatch = startWatch(
      () => this.settings.mergeCheckSec * 1000,
      async () => {
        for (const { executor } of this.projects.values()) await executor.checkMerges();
      },
    ).stop;
    const ciWatch = startWatch(() => {
      const next: number[] = [...this.projects.values()].flatMap(({ executor }) => executor.nextCiCheck() ?? []);
      return next.length ? Math.min(...next) - Date.now() : null;
    }, async () => {
      for (const { executor } of this.projects.values()) await executor.checkCi();
    });
    this.stopCiWatch = ciWatch.stop;
    this.wakeCiWatch = ciWatch.wake;
    if (this.agents && this.opts.checkLogins !== false) {
      this.startupReads = this.modelSetupDone.then(() => this.checkAllLogins()).then(() => this.emit("logins")).catch((error: unknown) => console.error("login check:", error))
        .then(async () => {
          if (this.shuttingDown) return;
          const reads: Promise<unknown>[] = this.accounts.accounts.filter(({ kind }) => kind === "model").map(({ id }) => this.accountOptions(id));
          const chats: (ChatAgent | undefined)[] = [this.chatAgent(), ...Array.from(this.projects.keys(), (id) => this.chatAgent(id))];
          for (const { model } of [...this.agentCatalog().agents, ...chats.filter((agent) => agent !== undefined)]) {
            if (model) reads.push(this.accountOptions(model.account, model.model));
          }
          await Promise.allSettled(reads);
        });
    }
  }

  projectDir(id: string): string {
    return join(homePaths(this.opts.home).projects, id);
  }

  global(): Global {
    return { settings: this.settings, agents: this.agentDefinitions, accounts: this.accounts, profiles: this.profiles, tiers: this.tiers };
  }

  agentCatalog(): NodeAgentCatalog {
    return { ...this.agentDefinitions, agents: this.agentDefinitions.agents.filter((agent) => agent.kind === "agent") };
  }

  private catalogAgent(id: string): NodeAgent | undefined {
    return this.agentDefinitions.agents.find((agent): agent is NodeAgent => agent.kind === "agent" && agent.id === id);
  }

  managerId(project: string, pm: ProjectManagerIdentity): string {
    return pm.agentId ?? `legacy-${project}`;
  }

  chatAgent(project?: string | null): ChatAgent | undefined {
    if (project == null) {
      const card: NodeAgent | undefined = this.catalogAgent(assistantAgentId);
      return card && { ...card, kind: "assistant" };
    }
    const pm: ProjectManagerIdentity | null | undefined = this.projects.get(project)?.ctx.project.pm;
    if (!pm) return undefined;
    const id: string = this.managerId(project, pm);
    const identity: ProjectManagerAgent | undefined = this.agentDefinitions.agents.find((agent): agent is ProjectManagerAgent => agent.kind === "pm" && agent.id === id);
    const selected: NodeAgent | undefined = identity && this.catalogAgent(identity.cardId);
    const card: NodeAgent | undefined = selected ?? this.catalogAgent(defaultAgentId);
    if (!card) return undefined;
    return { id, kind: "pm", name: identity?.name ?? pm.name, color: identity?.color ?? pm.color, cardId: card.id,
      model: card.model, compaction: card.compaction };
  }

  agentContext(id: string): string {
    return this.chats.agentContext(id);
  }

  setAgentContext(id: string, markdown: string): void {
    this.chats.setAgentContext(id, markdown);
  }

  withConfiguration<T>(work: () => Promise<T>): Promise<T> {
    const result: Promise<T> = this.globalFilesPending.then(work);
    this.globalFilesPending = result.catch(() => undefined);
    return result;
  }

  accountDiscovery(): AccountDiscovery[] {
    return [...this.discovering];
  }

  private async discoverAccount<T>(provider: AccountDiscovery, work: () => Promise<T>): Promise<T | undefined> {
    this.discovering.add(provider);
    this.live({ type: "accounts.discovery_changed" });
    try {
      return await work();
    } catch (error) {
      console.error(`Discovering ${provider} accounts:`, error);
      return undefined;
    } finally {
      this.discovering.delete(provider);
      this.live({ type: "accounts.discovery_changed" });
    }
  }

  private async setupModels(providers: readonly BuiltInHarness[]): Promise<void> {
    const agents: AgentServices | null = this.agents;
    if (this.shuttingDown) return;
    const added = new Set<BuiltInHarness>();
    const findings = agents && this.opts.checkLogins !== false ? await Promise.all(providers.map((provider) => this.discoverAccount(provider, async () => {
      const result = await findHarness(agents, provider);
      this.setupHarnesses = this.setupHarnesses.map((harness) => harness.connector === provider ? result.harness : harness);
      if (!this.shuttingDown) await this.withConfiguration(async () => {
        if (!registerHarnessAccount(this.configuration, result)) return;
        added.add(provider);
        this.accounts = withForgeHosts(this.configuration.accounts());
        this.configurationChanged("accounts");
      });
      return result;
    }))) : [];
    if (this.shuttingDown) return;
    await this.withConfiguration(async () => {
      const changes = saveHarnessProfiles(this.configuration, findings.filter((result) => result !== undefined), added);
      const cardsChanged: boolean = ensureBuiltInAgents(this.configuration, true);
      if (!changes && !cardsChanged) return;
      await this.reloadGlobal();
      if (changes) {
        this.notify({ kind: "auto-setup", title: `${appName} setup`, body: changes.message });
        for (const kind of changes.changed) this.configurationChanged(kind);
      }
      if (cardsChanged) this.configurationChanged("agents");
    });
  }

  private async setupForges(): Promise<void> {
    const counts: (number | undefined)[] = await Promise.all(ForgeDiscovery.options.map((forge) => this.discoverAccount(forge, async () => {
      const logins = await discoverForgeAccounts(forge);
      if (!logins.length || this.shuttingDown) return 0;
      return this.withConfiguration(async () => {
        const accounts: Accounts = this.configuration.accounts();
        const added: ForgeAccount[] = await newForgeAccounts(accounts, logins);
        if (!added.length) return 0;
        this.configuration.write({ accounts: { accounts: [...accounts.accounts, ...added] } });
        this.accounts = withForgeHosts(this.configuration.accounts());
        this.configurationChanged("accounts");
        return added.length;
      });
    })));
    const added: number = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
    if (added) this.notify({ kind: "auto-setup", title: `${appName} setup`, body: `Added ${added} Git hosting ${added === 1 ? "account" : "accounts"}.` });
  }

  private async detectServicesRuntime(detect: () => Promise<Settings["servicesRuntime"]>): Promise<void> {
    const runtime = await detect();
    if (!runtime || this.shuttingDown) return;
    const files = globalFileHandlers(this);
    const file = await files.getSettings();
    if (file.value.servicesRuntime !== null) return;
    await files.putSettings({ params: undefined, query: undefined, body: { value: { ...file.value, servicesRuntime: runtime }, baseSha256: file.sha256 } });
    this.notify({ kind: "auto-setup", title: `${appName} setup`, body: `Found ${runtime} for project services.` });
  }

  async setupView(): Promise<SetupView> {
    await this.modelSetupDone;
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

  async startAgentChats(url: string, token: string): Promise<void> {
    await this.agentChats.start(url, token);
  }

  stopAgentChats(): Promise<void> {
    this.stoppingAgentChats ??= this.agentChats.close();
    return this.stoppingAgentChats;
  }

  async reloadProject(id: string): Promise<DefinitionError[]> {
    const p = this.projects.get(id);
    if (!p) return [];
    const loaded = await loadProject(p.ctx.dir, p.ctx.templates, p.ctx.db.definition.read(), { global: this.catalog, project: p.ctx.db.catalog });
    if (loaded.project) {
      p.ctx.project = loaded.project;
      p.ctx.defs = loaded;
    }
    if (loaded.errors.length) this.projectErrors.set(id, loaded.errors);
    else this.projectErrors.delete(id);
    this.live({ type: "project.updated", projectId: id });
    return loaded.errors;
  }

  async reloadGlobal(): Promise<DefinitionError[]> {
    const value: Global = this.configuration.read();
    const errors: DefinitionError[] = validateGlobal(value);
    if (errors.length) return errors;
    this.applyConfiguration(value);
    for (const { ctx } of this.projects.values()) ctx.settings = this.settings;
    this.kick();
    return [];
  }

  private applyConfiguration(value: Global): void {
    this.settings = value.settings;
    this.agentDefinitions = value.agents;
    this.accounts = withForgeHosts(value.accounts);
    this.profiles = value.profiles;
    this.tiers = value.tiers;
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
      await this.modelSetupDone;
      const provider = BuiltInHarness.safeParse(login.connector);
      if (provider.success) await this.setupModels([provider.data]);
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
    if (a.kind === "service") {
      if ((a.tool !== "atlassian" && a.tool !== "linear") || this.loginRunner.isActive(`tool:${id}`)) return "unknown";
      try {
        await checkTrackerBridge(id, a.tool);
        await this.releaseAuth(id, null);
        return "logged_in";
      } catch (error) {
        if (error instanceof TrackerMcpAuthError) return "logged_out";
        throw error;
      }
    }
    const states = [];
    for (const l of ((await this.agents?.logins()) ?? []).filter((x) => x.account === id)) states.push((await this.checkLoginInfo(l)).state);
    return states.includes("logged_out") ? "logged_out" : states.length > 0 && states.every((s) => s === "logged_in") ? "logged_in" : "unknown";
  }

  async startAccountLogin(id: string): Promise<string> {
    const a = this.account(id);
    if (a.kind === "service" && (a.tool === "atlassian" || a.tool === "linear")) {
      const loginId: string = `tool:${id}`;
      await this.loginRunner.trackerBridge(loginId, id, a.tool, () => this.releaseAuth(id, null));
      return loginId;
    }
    if (a.kind !== "forge") throw new Error(`account ${id} has no tool login in ${appName}; log in with ${a.kind === "service" ? a.tool : "the harness"} and recheck`);
    const loginId = `tool:${id}`;
    await this.loginRunner.tool(loginId, a, async () => {
      if (!a.user) {
        const user: string | undefined = await forgeLoginUser(a);
        if (user) await this.withConfiguration(async () => {
          const account: Account | undefined = this.accounts.accounts.find((entry) => entry.id === id);
          if (account?.kind !== "forge" || account.user || account.tool !== a.tool || account.host !== a.host) return;
          this.configuration.write({ accounts: { accounts: this.accounts.accounts.map((entry) => entry.id === id ? { ...account, user } : entry) } });
          await this.reloadGlobal();
          this.configurationChanged("accounts");
        });
      }
      return this.recheckAccount(id);
    });
    return loginId;
  }

  async accountOptions(id: string, model: string | null = null, refresh: boolean = false): Promise<AccountOptions | null> {
    this.account(id);
    if (refresh) for (const key of [...this.options.keys()]) if (key === id || key.startsWith(id + "\n")) this.options.delete(key);
    const account: AccountOptions | null = await this.keptOptions(id, () => this.readAccountOptions(id));
    if (!account || model === null) return account;
    return this.keptOptions(id + "\n" + model, async () => {
      const efforts: string[] | null = await this.readModelEfforts(id, model);
      return efforts && { models: account.models, efforts };
    });
  }

  private keptOptions(key: string, read: () => Promise<AccountOptions | null>): Promise<AccountOptions | null> {
    const kept: Promise<AccountOptions | null> | undefined = this.options.get(key);
    if (kept) return kept;
    const reading: Promise<AccountOptions | null> = read();
    this.options.set(key, reading);
    const forget = (): void => { if (this.options.get(key) === reading) this.options.delete(key); };
    reading.then((options) => { if (!options) forget(); }, forget);
    return reading;
  }

  private async readAccountOptions(id: string): Promise<AccountOptions | null> {
    for (const l of ((await this.agents?.logins()) ?? []).filter((x) => x.account === id)) {
      const connector = await this.agents!.resolve(l.connector);
      await this.agents!.ensureProbeDir(l);
      const options = await listOptions({ connector, login: l, spawn: spawnFor(l.osUser), allowUnknownIdentity: true }).catch(() => null);
      const cli = l.connector === "opencode" ? await openCodeModels(connector, l).catch(() => null) : null;
      if (options || cli) return { models: cli?.models ?? options?.models ?? [], efforts: options?.efforts ?? [] };
    }
    return null;
  }

  private async readModelEfforts(id: string, model: string): Promise<string[] | null> {
    for (const l of ((await this.agents?.logins()) ?? []).filter((x) => x.account === id)) {
      const connector = await this.agents!.resolve(l.connector);
      await this.agents!.ensureProbeDir(l);
      const options = await listOptions({ connector, login: l, spawn: spawnFor(l.osUser), model, allowUnknownIdentity: true }).catch(() => null);
      if (options) return options.efforts;
    }
    return null;
  }

  definitionChanged(path: string, sha256: string | null): void {
    this.live({ type: "definition.changed", path, sha256 });
  }

  configurationChanged(kind: keyof Global): void {
    this.live({ type: "configuration.changed", kind });
  }

  private async openProject(id: string): Promise<void> {
    const dir = this.projectDir(id);
    const templates: string = this.opts.templates;
    const path: string = join(dir, "pecore.db");
    if (!(await lstat(path).catch(() => null))?.isFile()) {
      this.projectErrors.set(id, [{ file: path, path: "", message: "project database not found" }]);
      return;
    }
    const db: ProjectDb = new ProjectDb(path, this.catalog.db);
    const loaded: Awaited<ReturnType<typeof loadProject>> = await loadProject(dir, templates, db.definition.read(), { global: this.catalog, project: db.catalog });
    if (!loaded.project) {
      db.close();
      this.projectErrors.set(id, loaded.errors);
      return;
    }
    if (loaded.errors.length) this.projectErrors.set(id, loaded.errors);
    const ctx: ProjectContext = {
      id,
      dir,
      templates,
      ciScheduled: () => this.wakeCiWatch(),
      db,
      project: loaded.project!,
      defs: loaded,
      user: this.settings.protectedMode ? protectedUser : appUser,
      development: this.opts.development ?? false,
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
      orderAttachments: (orderId, attachmentIds) => this.agentChats.jobAttachments(orderId, attachmentIds),
      agentQuestion: (itemId) => {
        try {
          this.agentChats.askPm(id, itemId);
        } catch (e) {
          console.error(`agent question ${itemId}:`, e);
        }
      },
      setupEnded: (state) => this.setupEnded(id, state),
      forgeAccount: (accountId) => this.accounts.accounts.find((a): a is ForgeAccount => a.kind === "forge" && a.id === accountId),
      serviceAccount: (accountId) => this.accounts.accounts.find((a): a is Extract<Account, { kind: "service" }> => a.kind === "service" && a.id === accountId),
      agentCard: (agentId) => this.catalogAgent(agentId),
      agentContext: (agentId) => this.agentContext(agentId),
      openTrackerRun: (...args) => this.agentChats.openTrackerRun(...args),
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

  deleteNotification(id: string): void {
    if (this.chats.deleteNotification(id)) this.live({ type: "notify", kind: "deleted", title: "", body: "" });
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
    return { accounts: this.accounts, protectedMode: this.settings.protectedMode, templates: this.opts.templates, ...(this.opts.admin ? { admin: this.opts.admin } : {}) };
  }

  projectManagers(except?: string): ProjectManagerIdentity[] {
    return [...this.projects.values()].flatMap(({ ctx }) => {
      const pm: ProjectManagerIdentity | null = this.projectManagerIdentity(ctx.id);
      return ctx.id !== except && pm ? [pm] : [];
    });
  }

  projectManagerIdentity(project: string): ProjectManagerIdentity | null {
    const agent = this.chatAgent(project);
    return agent?.kind === "pm" ? { agentId: agent.id, name: agent.name, color: agent.color } : null;
  }

  projectManagerFor(pm: ProjectManagerIdentity | null | undefined, except?: string): ProjectManagerIdentity {
    const used: ProjectManagerIdentity[] = this.projectManagers(except);
    if (pm) {
      const clash = projectManagerClash(pm, used);
      if (clash) throw new HttpError("bad_request", `Another project's Project Manager already uses this ${clash === "name" ? "name" : "colour"}.`);
      return { name: pm.name, color: pm.color };
    }
    const chosen: ProjectManagerIdentity | null = freeProjectManager(used);
    if (chosen) return chosen;
    for (let index: number = projectManagers.length + 1; ; index++) {
      const fallback: ProjectManagerIdentity = { name: `Manager ${index}`, color: `#${((index * 0x9e3779) & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}` };
      if (!projectManagerClash(fallback, used)) return fallback;
    }
  }

  private async assignProjectManager(id: string): Promise<void> {
    const { ctx } = this.project(id);
    const current: ProjectManagerIdentity | null = ctx.project.pm;
    const used: ProjectManagerIdentity[] = this.projectManagers(id);
    const resolved: ProjectManagerIdentity | null = this.projectManagerIdentity(id);
    if (current && resolved && !used.some(({ agentId }) => agentId === resolved.agentId) && !projectManagerClash(resolved, used)) return;
    const pm: ProjectManagerIdentity = { ...this.projectManagerFor(null, id), agentId: `pm-${randomUUID()}` };
    const path: string = `projects/${id}/project.json`;
    const definitions = definitionOperations(this).handlers;
    const file = await definitions.getDefinition({ params: { path }, body: undefined, query: undefined });
    const content: string = JSON.stringify({ ...JSON.parse(file.content) as object, pm }, null, 2) + "\n";
    await definitions.saveDefinition({ params: { path }, query: undefined, body: { content, baseSha256: file.sha256 } });
  }

  async createProject(input: ProjectInput): Promise<void> {
    const project = await this.withConfiguration(async () => {
      const pm: ProjectManagerIdentity = { ...this.projectManagerFor(input.pm), agentId: `pm-${randomUUID()}` };
      const project = await beginProject(this.opts.home, { ...input, pm }, this.createOptions());
      await this.openProject(project.id);
      this.setCreating(project.id, { step: 3, error: null });
      return project;
    });
    await this.continueCreation(project.id);
  }

  async exportProject(id: string, input: ExportProjectBody): Promise<ExportProjectResult> {
    const project: LoadedProject | undefined = this.projects.get(id);
    if (!project) throw new NotFoundError(`project ${id} not found`);
    return exportProject(project.ctx, input);
  }

  async exportProjectToDownloads(id: string, history: boolean, acceptFindings: string[] = []): Promise<ExportProjectResult> {
    const downloads: string = this.opts.downloads ?? join(homedir(), "Downloads");
    await mkdir(downloads, { recursive: true });
    return this.exportProject(id, { path: join(downloads, `${id}.tar.zst`), history, logs: false, acceptFindings });
  }

  async importProject(input: ImportProjectBody): Promise<ImportProjectResult> {
    const result: ImportProjectResult = await beginImport(this.opts.home, input, this.importOptions());
    if (result.state === "imported") await this.continueCreation(result.id);
    return result;
  }

  previewProjectImport(path: string): Promise<ImportProjectPreview> {
    return previewImport(this.opts.home, path, this.importOptions(), (dir, manifest) => reviewProjectContents(this, dir, manifest));
  }

  async completeProjectImport({ digest, ...input }: CompleteProjectImportBody): Promise<{ id: string; differences?: string[] }> {
    const result: ImportProjectResult = await beginImport(this.opts.home, input, this.importOptions(), digest);
    if (result.state !== "imported") throw new InvalidArchive("Choose a local forge account for each account the project needs.");
    await this.continueCreation(result.id);
    return { id: result.id, ...(result.differences ? { differences: result.differences } : {}) };
  }

  private importOptions() {
    return {
      accounts: this.accounts,
      catalog: this.catalog,
      knownProject: (id: string) => this.projects.has(id) || this.creating.has(id) || this.projectErrors.has(id),
    };
  }

  async continueCreation(id: string): Promise<void> {
    const dir = this.projectDir(id);
    const creation = await readCreation(dir);
    if (!creation) return;
    if (!this.projects.has(id)) {
      await this.openProject(id);
      if (this.projects.has(id)) await this.assignProjectManager(id).catch((e: unknown) => console.error(`project ${id} manager:`, e));
    }
    const loaded: LoadedProject = this.project(id);
    const { ctx, executor } = loaded;
    try {
      if (creation.step < 4 && (await prepareRepo(dir, ctx.project, this.createOptions())) === "setup") {
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
      const findings = await finishProject(dir, this.createOptions());
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
      await p.executor.close();
      p.ctx.db.close();
      this.projects.delete(id);
    }
    await cancelCreation(dir);
    this.setCreating(id, null);
  }

  async deleteProject(id: string): Promise<void> {
    const p: LoadedProject = this.project(id);
    if (p.deleting) throw new Error(`project ${id} is being deleted`);
    const running = p.executor.jobs().filter((j) => j.state === "running");
    if (running.length > 0) throw new Error(`stop the running jobs first: ${running.map((j) => j.title).join(", ")}`);
    p.deleting = true;
    try {
      const jobs = p.executor.jobs();
      for (const j of jobs) if (!isFinal(j.state)) await p.executor.stop(j.id);
      for (const j of jobs) await p.executor.services.down(j.id).catch((e: unknown) => console.error("services:", e));
      await p.executor.close();
      p.ctx.db.close();
      this.projects.delete(id);
      this.projectErrors.delete(id);
      this.creating.delete(id);
      if (p.ctx.user !== appUser) await removeAs(p.ctx.user, p.ctx.dir, "work").catch(() => undefined);
      await rm(p.ctx.dir, { recursive: true, force: true });
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
    await this.withConfiguration(async () => {
      const settings: Settings = { ...this.settings, protectedMode: on };
      this.configuration.write({ settings });
      this.settings = settings;
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
    this.stopCiWatch();
    const chats: Promise<void> = this.stopAgentChats();
    await chats;
    await this.loginRunner.stopAll();
    await this.setupDone;
    await this.startupReads;
    await this.runtimeDetection;
    await Promise.allSettled(this.options.values());
    await this.globalFilesPending;
    await Promise.all([...this.projects.values()].map(({ executor }) => executor.close()));
    for (const { ctx } of this.projects.values()) ctx.db.close();
    this.chats.close();
    await this.releaseLock();
  }
}

export type { CreateJob };
