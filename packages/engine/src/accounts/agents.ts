import { execFile } from "node:child_process";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { access, constants } from "node:fs/promises";
import { delimiter, join, relative } from "node:path";
import { mkdirAs } from "../workdir/fs-as";
import { promisify } from "node:util";
import { checkLogin, parseConnector } from "@pecore/agents";
import type { Login, LoginState, Quota, ResolvedConnector, Spawn } from "@pecore/agents";
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

export async function resolveProgram(program: string, settings: Settings): Promise<string | null> {
  const set = settings.programPaths[program];
  if (set) return set;
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
    const read = async (dir: string) => {
      const out: Connector[] = [];
      for (const f of (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json"))) {
        const r = parseConnector(JSON.parse(await readFile(join(dir, f), "utf8")));
        if (r.connector) out.push(r.connector);
        else errors.push(`${join(dir, f)}: ${r.errors.join("; ")}`);
      }
      return out;
    };
    const builtin = await read(this.paths.connectorsDir);
    const user = await read(join(this.home, "connectors"));
    this.connectors = new Map([...builtin, ...user].map((c) => [c.name, c]));
    return errors;
  }

  connector(name: string): Connector | undefined {
    return this.connectors.get(name);
  }

  async resolve(name: string): Promise<ResolvedConnector> {
    const c = this.connectors.get(name);
    if (!c) throw new Error(`connector ${name} not found`);
    const harnessPath = await resolveProgram(c.harness.program, this.settings());
    if (!harnessPath) throw new Error(`${c.harness.program} not found; set its path in settings`);
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
      const id = `${a.id}:${user}`;
      out.push({ id, account: a.id, osUser: user, connector: a.connector, configDir: join(home, ".pecore-harness", a.id), defaultDir, home, state: this.loginStates.get(id) ?? { state: "unchecked" } });
    }
    return out;
  }

  async login(accountId: string): Promise<LoginInfo> {
    const l = (await this.logins()).find((x) => x.account === accountId);
    if (!l) throw new Error(`no login for account ${accountId}`);
    await this.ensureProbeDir(l);
    return l;
  }

  private async ensureProbeDir(l: LoginInfo): Promise<void> {
    if (l.osUser === appUser) await mkdir(join(l.configDir, "probe"), { recursive: true });
    else await mkdirAs(l.osUser, l.home, relative(l.home, join(l.configDir, "probe")));
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

  readonly quotas = new Map<string, { quota: Quota; seenAt: number }>();

  noteQuota(account: string, quota: Quota, now = Date.now()): void {
    this.quotas.set(account, { quota, seenAt: now });
  }
}
