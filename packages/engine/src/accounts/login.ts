import { writeFile, mkdir } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { createInterface } from "node:readline";
import { prepareLogin } from "@pecore/agents";
import type { ForgeAccount } from "@pecore/schemas";
import { appUser, baseEnv, run, spawnAs } from "../runners/process";
import type { Proc } from "../runners/process";
import { writeFileAs } from "../workdir/fs-as";
import { checkTrackerBridge } from "./atlassian";
import type { TrackerBridge } from "./atlassian";
import type { AgentServices, LoginInfo } from "./agents";

export type LoginProgress = { loginId: string; text: string; url: string | null; done: boolean };

const toolLogin: Partial<Record<ForgeAccount["tool"], (host: string) => string[]>> = {
  gh: (host) => ["gh", "auth", "login", "--hostname", host, "--web", "--git-protocol", "https"],
  glab: (host) => ["glab", "auth", "login", "--hostname", host, "--device"],
};

export class LoginRunner {
  private readonly active = new Map<string, Proc>();

  constructor(private readonly progress: (p: LoginProgress) => void) {}

  isActive(loginId: string): boolean {
    return this.active.has(loginId);
  }

  async harness(agents: AgentServices, l: LoginInfo, done: () => Promise<string>): Promise<void> {
    await this.active.get(l.id)?.stop();
    const connector = await agents.resolve(l.connector);
    const plan = prepareLogin({ connector, login: l });
    for (const f of plan.files) {
      if (l.osUser === appUser) {
        await mkdir(dirname(f.path), { recursive: true });
        await writeFile(f.path, f.content);
      } else await writeFileAs(l.osUser, l.home, relative(l.home, f.path), f.content);
    }
    const env = { ...(await baseEnv(l.osUser)), ...plan.command.env };
    for (const argv of plan.before) {
      const r = await run({ user: l.osUser, argv, env, cwd: l.home, timeoutMs: 60_000 });
      if (r.code !== 0) throw new Error(`${argv.join(" ")} failed: ${r.stderr.trim()}`);
    }
    const proc = await spawnAs({ user: l.osUser, argv: plan.command.argv, env, cwd: l.home });
    this.stream(l.id, proc, new RegExp(plan.urlPattern), done);
  }

  async tool(loginId: string, account: ForgeAccount, done: () => Promise<string>): Promise<void> {
    const argv = toolLogin[account.tool]?.(account.host);
    if (!argv) throw new Error(`no login command for ${account.tool}; log in with it in a terminal, then recheck`);
    await this.active.get(loginId)?.stop();
    const proc = await spawnAs({ user: appUser, argv, env: { ...(await baseEnv(appUser)), GH_PROMPT_DISABLED: "1" }, cwd: (await baseEnv(appUser)).HOME! });
    proc.stdin.on("error", () => undefined);
    if (account.tool === "gh") proc.stdin.write("\n");
    this.stream(loginId, proc, /https:\/\/\S+/, (code) => code === 0 ? done() : Promise.resolve("logged_out"));
  }

  async trackerBridge(loginId: string, account: string, server: TrackerBridge, done: () => Promise<void>): Promise<void> {
    if (this.active.has(loginId)) return;
    const name: string = server === "atlassian" ? "Atlassian" : "Linear";
    await new Promise<void>((started, failed) => {
      void checkTrackerBridge(account, server, {
        interactive: true,
        onStart: (proc) => {
          this.active.set(loginId, proc);
          this.progress({ loginId, text: `Connecting to ${name}…`, url: null, done: false });
          started();
        },
        onAuthorize: (url) => this.progress({ loginId, text: `Complete ${name} sign-in in your browser.`, url, done: false }),
      }).then(async () => {
        await done();
        this.active.delete(loginId);
        this.progress({ loginId, text: `Connected to ${name}.`, url: null, done: true });
      }).catch((error: unknown) => {
        failed(error);
        this.active.delete(loginId);
        this.progress({ loginId, text: (error as Error).message, url: null, done: true });
      });
    });
  }

  sendCode(loginId: string, code: string): void {
    const proc = this.active.get(loginId);
    if (!proc) throw new Error(`login ${loginId} is not running`);
    proc.stdin.write(`${code}\n`);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((p) => p.stop()));
  }

  private stream(loginId: string, proc: Proc, pattern: RegExp, done: (code: number | null) => Promise<string>): void {
    this.active.set(loginId, proc);
    let url: string | null = null;
    const onLine = (line: string) => {
      url ??= pattern.exec(line)?.[0] ?? null;
      this.progress({ loginId, text: line, url, done: false });
    };
    createInterface({ input: proc.stdout }).on("line", onLine);
    createInterface({ input: proc.stderr }).on("line", onLine);
    void proc.exited.then(async (exit) => {
      this.active.delete(loginId);
      const state = await done(exit.code).catch((e: unknown) => `check failed: ${(e as Error).message}`);
      this.progress({ loginId, text: `login ended (exit ${exit.code ?? exit.signal}); state: ${state}`, url, done: true });
    });
  }
}
