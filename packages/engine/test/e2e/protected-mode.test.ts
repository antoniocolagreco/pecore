import { execFile } from "node:child_process";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Accounts, Settings } from "@pecore/schemas";
import { AgentServices, protectedUser } from "../../src/accounts/agents";
import { homePaths } from "../../src/home/layout";
import { moveLegacyFolders } from "../../src/home/legacy";
import { Engine } from "../../src/main";
import { appUser } from "../../src/runners/process";
import { gitApp } from "../../src/workdir/git-as";
import { createProjectWithRecipes } from "../project";
import { shippedTemplates, tempDir } from "../tmp";

const execFileP = promisify(execFile);
const enabled: boolean = process.env.PECORE_PROTECTED_E2E === "1" && process.platform === "linux";

const whoami = {
  name: "whoami",
  description: "writes the name of the user that runs the node",
  kind: "command",
  command: ["/bin/sh", "-c", "id -un > who.txt"],
  outcomes: ["done"],
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  timeoutSec: 60,
};

const recipe = {
  name: "whoami-commit",
  description: "write who.txt and commit it",
  start: "write",
  successOutcomes: ["commit:done"],
  nodes: { write: { use: "whoami" }, commit: { use: "git-commit" } },
  edges: [{ from: "write", on: "done", to: "commit" }],
};

async function as(user: string, script: string, ...args: string[]): Promise<{ ok: boolean; out: string }> {
  return execFileP("sudo", ["-n", "-u", user, "--", "/bin/sh", "-c", script, "sh", ...args]).then(
    ({ stdout }) => ({ ok: true, out: stdout.trim() }),
    (error: { stdout?: string }) => ({ ok: false, out: (error.stdout ?? "").trim() }),
  );
}

async function admin(script: string): Promise<void> {
  await execFileP("sudo", ["-n", "/bin/sh", "-c", script]);
}

async function until<T>(fn: () => T | undefined | false, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!enabled)("protected mode on a real Linux system (PECORE_PROTECTED_E2E=1, passwordless sudo)", () => {
  it("runs jobs and chats as pecore-agent, which reaches only its own folders and never the app's tokens", async () => {
    const root: string = await tempDir();
    const home: string = join(root, "home");
    const templates: string = join(root, "templates");
    await cp(shippedTemplates, templates, { recursive: true });
    await writeFile(join(templates, "nodes", "whoami.json"), JSON.stringify(whoami));
    await writeFile(join(templates, "recipes", "whoami-commit.json"), JSON.stringify(recipe));
    const engine: Engine = await Engine.start({ home, templates, admin });
    try {
      await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["whoami-commit"]);
      const p = homePaths(home);
      const appLogin: string = join(p.harness, appUser, "claude");
      await mkdir(appLogin, { recursive: true, mode: 0o700 });
      await writeFile(join(appLogin, ".credentials.json"), "app-secret\n", { mode: 0o600 });
      await writeFile(p.accounts, JSON.stringify({ accounts: [] }) + "\n", { mode: 0o600 });

      await engine.setProtectedMode(true);
      expect((await as(protectedUser, "id -un")).out).toBe(protectedUser);

      const project = engine.project("demo");
      const job: string = await engine.createJob("demo", { title: "Who runs jobs", ticket: { text: "write who.txt" } });
      await until(() => project.executor.job(job).state === "succeeded");
      expect((await gitApp(join(project.ctx.dir, "repo.git"), ["show", `factory/${job}:who.txt`])).trim()).toBe(protectedUser);

      for (const secret of [p.settings, p.accounts, join(appLogin, ".credentials.json"), join(project.ctx.dir, "pecore.db")]) {
        expect(await as(protectedUser, 'cat -- "$1"', secret), secret).toEqual({ ok: false, out: "" });
      }
      for (const folder of [home, p.harness, join(p.harness, appUser), appLogin, p.projects, p.templates]) {
        expect((await as(protectedUser, 'ls -- "$1"', folder)).ok, folder).toBe(false);
      }

      await engine.startAgentChats("http://127.0.0.1:9/mcp", "chat-token");
      const chats: string[] = await readdir(p.chats);
      expect(chats).toContain("assistant");
      for (const chat of chats) {
        const token: string = join(p.chats, chat, "mcp-token");
        expect((await execFileP("stat", ["-c", "%U %a", token])).stdout.trim(), token).toBe(`${protectedUser} 600`);
        expect((await as(protectedUser, 'cat -- "$1"', token)).out).toContain("chat-token");
        expect((await as("nobody", 'cat -- "$1"', token)).ok).toBe(false);
        expect((await as(protectedUser, 'echo note > "$1"', join(p.chats, chat, "files-test.txt"))).ok).toBe(true);
      }
      expect((await as("nobody", 'ls -- "$1"', p.chats)).ok).toBe(false);

      const agentHome: string = (await as(protectedUser, 'printf %s "$HOME"')).out;
      expect((await as(protectedUser, 'mkdir -p "$1/.pecore-harness/legacy" "$1/.pecore-chats/x" && umask 077 && echo old-secret > "$1/.pecore-harness/legacy/auth.json"', agentHome)).ok).toBe(true);
      await moveLegacyFolders(home, true);
      expect((await as(protectedUser, 'cat -- "$1"', join(p.harness, protectedUser, "legacy", "auth.json"))).out).toBe("old-secret");
      expect((await execFileP("stat", ["-c", "%U %a", join(p.harness, protectedUser, "legacy", "auth.json")])).stdout.trim()).toBe(`${protectedUser} 600`);
      expect((await as(protectedUser, 'test -e "$1/.pecore-harness" || test -e "$1/.pecore-chats"', agentHome)).ok).toBe(false);
      expect((await as("nobody", 'cat -- "$1"', join(p.harness, protectedUser, "legacy", "auth.json"))).ok).toBe(false);

      const accounts = Accounts.parse({ accounts: [{ id: "codex-main", kind: "model", provider: "openai", connector: "codex", login: "subscription" }] });
      const services = new AgentServices({ connectorsDir: join(home, "none"), adaptersDir: join(home, "none"), adapters: {} }, home, () => Settings.parse({ protectedMode: true }), () => accounts);
      const [login] = await services.logins();
      expect(login!.configDir).toBe(join(p.harness, protectedUser, "codex-main"));
      await services.ensureProbeDir(login!);
      expect((await execFileP("stat", ["-c", "%U", join(login!.configDir, "probe")])).stdout.trim()).toBe(protectedUser);
      expect((await as(protectedUser, 'umask 077 && echo agent-secret > "$1"', join(login!.configDir, "auth.json"))).ok).toBe(true);
      expect((await as(protectedUser, 'cat -- "$1"', join(login!.configDir, "auth.json"))).out).toBe("agent-secret");
      expect((await as("nobody", 'cat -- "$1"', join(login!.configDir, "auth.json"))).ok).toBe(false);
      expect((await as("nobody", 'ls -- "$1"', join(p.harness, protectedUser))).ok).toBe(false);
    } finally {
      await engine.setProtectedMode(false, true).catch((error: unknown) => console.error(error));
      await engine.shutdown();
      await execFileP("sudo", ["-n", "rm", "-rf", "--", root]);
    }
  }, 300000);
});
