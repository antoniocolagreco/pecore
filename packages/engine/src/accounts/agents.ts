import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { access, constants } from "node:fs/promises";
import { delimiter, join, relative } from "node:path";
import { privateDirectory } from "../osuser/acl";
import { mkdirAs } from "../workdir/fs-as";
import { promisify } from "node:util";
import { checkLogin, parseConnector } from "@pecore/agents";
import type { Login, LoginState, ResolvedConnector, Spawn } from "@pecore/agents";
import type { Accounts, Connector, ModelAccount, Settings } from "@pecore/schemas";
import { appUser, baseEnv, spawnAs } from "../runners/process";

const execFileP = promisify(execFile);

export const protectedUser = "pecore-agent";

export type AgentPaths = { connectorsDir: string; adaptersDir: string; adapters: Record<string, { version: string; entry: string }> };

export type LoginInfo = Login & { id: string; connector: string; state: LoginState | { state: "unchecked" } };

async function executable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

export async function resolveProgram(program: string): Promise<string | null> {
  if (program.startsWith("/")) return program;
  const shell = process.env.SHELL ?? "/bin/sh";
  try {
    const { stdout } = await execFileP(shell, ["-lc", 'command -v "$1"', "sh", program], { timeout: 10_000 });
    const path = stdout.trim().split("\n").pop() ?? "";
    if (path.startsWith("/")) return path;
  } catch {
    /* fall through to PATH */
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, program);
    if (dir && (await executable(p))) return p;
  }
  return null;
}

export function spawnFor(user: string, extraEnv: Record<string, string> = {}): Spawn {
  return async (p) => {
    const env = { ...(await baseEnv(user)), ...extraEnv, ...p.env };
    return spawnAs({ user, argv: p.argv, env, cwd: p.cwd });
  };
}

export class AgentServices {
  private connectors = new Map<string, Connector>();
  readonly loginStates = new Map<string, LoginState | { state: "unchecked" }>();
  private readonly cooldowns = new Map<string, { until: number; kind: "quota" | "rate_limit"; strikes: number }>();

  constructor(
    readonly paths: AgentPaths,
    private readonly home: string,
    private settings: () => Settings,
    private accounts: () => Accounts,
  ) {}

  async loadConnectors(): Promise<string[]> {
    const errors: string[] = [];
    const connectors: Map<string, Connector> = new Map();
    const dir: string = this.paths.connectorsDir;
    for (const file of (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".json"))) {
      const path: string = join(dir, file);
      const result = parseConnector(JSON.parse(await readFile(path, "utf8")));
      if (result.connector) connectors.set(result.connector.name, result.connector);
      else errors.push(`${path}: ${result.errors.join("; ")}`);
    }
    this.connectors = connectors;
    return errors;
  }

  connector(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  async resolve(name: string): Promise<ResolvedConnector> {
    const c = this.connectors.get(name);
    if (!c) throw new Error(`connector ${name} not found`);
    const harnessPath = await resolveProgram(c.harness.program);
    if (!harnessPath) throw new Error(`${c.harness.program} not found on PATH`);
    return {
      ...c,
      harnessPath,
      nodePath: join(this.paths.adaptersDir, "node", "bin", "node"),
      adaptersDir: this.paths.adaptersDir,
      adapters: this.paths.adapters,
      platform: process.platform === "darwin" ? "darwin" : "linux",
    };
  }

  osUser(): string {
    return this.settings().protectedMode ? protectedUser : appUser;
  }

  async logins(): Promise<LoginInfo[]> {
    const user = this.osUser();
    const home = (await baseEnv(user)).HOME!;
    const seen = new Set<string>();
    const out: LoginInfo[] = [];
    for (const a of this.accounts().accounts) {
      if (a.kind !== "model") continue;
      const first = !seen.has(a.connector);
      seen.add(a.connector);
      const defaultDir = !this.settings().protectedMode && first;
      out.push(this.loginTarget(a.connector, a.id, user, home, defaultDir));
    }
    return out;
  }

  async setupLogin(connector: string): Promise<LoginInfo> {
    const existing: LoginInfo | undefined = (await this.logins()).find((login) => login.connector === connector);
    if (existing) return existing;
    const user: string = this.osUser();
    const home: string = (await baseEnv(user)).HOME!;
    return this.loginTarget(connector, connector, user, home, !this.settings().protectedMode);
  }

  private loginTarget(connector: string, account: string, osUser: string, home: string, defaultDir: boolean): LoginInfo {
    const id: string = `${account}:${osUser}`;
    return { id, account, osUser, connector, configDir: join(this.harnessDir(osUser), account), defaultDir, home, state: this.loginStates.get(id) ?? { state: "unchecked" } };
  }

  private harnessDir(osUser: string): string {
    return join(this.home, "harness", osUser);
  }

  async login(accountId: string): Promise<LoginInfo> {
    const l = (await this.logins()).find((x) => x.account === accountId);
    if (!l) throw new Error(`no login for account ${accountId}`);
    await this.ensureProbeDir(l);
    return l;
  }

  async ensureProbeDir(l: LoginInfo): Promise<void> {
    const base: string = this.harnessDir(l.osUser);
    await privateDirectory(base, l.osUser, this.home);
    if (l.osUser === appUser) await mkdir(join(l.configDir, "probe"), { recursive: true, mode: 0o700 });
    else await mkdirAs(l.osUser, base, relative(base, join(l.configDir, "probe")));
  }

  account(id: string): ModelAccount | undefined {
    const a = this.accounts().accounts.find((x) => x.id === id);
    return a?.kind === "model" ? a : undefined;
  }

  async check(l: LoginInfo): Promise<LoginState> {
    await this.ensureProbeDir(l);
    const connector = await this.resolve(l.connector);
    const state = await checkLogin({ connector, login: l, spawn: spawnFor(l.osUser) }).catch((): LoginState => ({ state: "unknown" }));
    const expected = this.account(l.account)?.email;
    const final: LoginState = state.state === "logged_in" && expected && state.email.toLowerCase() !== expected.toLowerCase() ? { state: "logged_out" } : state;
    this.loginStates.set(l.id, final);
    return final;
  }

  async checkAll(): Promise<void> {
    for (const l of await this.logins()) await this.check(l);
  }

  coolDown(account: string, kind: "quota" | "rate_limit", resetAt: number | undefined, now = Date.now()): number {
    const prev = this.cooldowns.get(account);
    const strikes = (prev?.strikes ?? 0) + 1;
    const backoff = [1, 2, 4, 8][Math.min(strikes - 1, 3)]! * 60_000;
    const until = resetAt && resetAt > now ? resetAt : now + backoff;
    this.cooldowns.set(account, { until, kind, strikes });
    return until;
  }

  cooling(account: string, now = Date.now()): { until: number; kind: "quota" | "rate_limit" } | null {
    const c = this.cooldowns.get(account);
    if (!c) return null;
    if (c.until <= now) return null;
    return { until: c.until, kind: c.kind };
  }

  clearCooldown(account: string): void {
    this.cooldowns.delete(account);
  }
}
