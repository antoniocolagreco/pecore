import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Accounts, Node, Settings } from "@pecore/schemas";
import { AgentServices, protectedUser } from "../../src/accounts/agents";
import { homePaths } from "../../src/home/layout";
import { closeHome, moveLegacyFolders } from "../../src/home/legacy";
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
  successOutcomes: ["commit:success"],
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
  it("runs jobs and chats as pecore-agent, which reaches only its own folders and never the app's tokens, and gives the project back to the app when turned off", async () => {
    const root: string = await tempDir();
    await chmod(root, 0o711);
    const realHome: string | undefined = process.env.HOME;
    process.env.HOME = join(root, "user");
    await mkdir(process.env.HOME, { mode: 0o700 });
    const home: string = join(process.env.HOME, ".pecore");
    const templates: string = join(root, "templates");
    const sampleProject: string = join(root, "sample-project");
    await cp(shippedTemplates, templates, { recursive: true });
    await writeFile(join(templates, "nodes", "whoami.json"), JSON.stringify(whoami));
    await writeFile(join(templates, "recipes", "whoami-commit.json"), JSON.stringify(recipe));
    await mkdir(sampleProject);
    await writeFile(join(sampleProject, "README.md"), "Sample project\n");
    await writeFile(join(sampleProject, "hello.txt"), "hello\n");
    await mkdir(join(sampleProject, "src"));
    await writeFile(join(sampleProject, "src", "sample.txt"), "sample\n");
    const engine: Engine = await Engine.start({ home, templates, sampleProject, admin });
    try {
      await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["whoami-commit"]);
      const p = homePaths(home);
      const appLogin: string = join(p.harness, appUser, "claude");
      await mkdir(appLogin, { recursive: true, mode: 0o700 });
      await writeFile(join(appLogin, ".credentials.json"), "app-secret\n", { mode: 0o600 });
      await mkdir(p.templateNodes, { recursive: true, mode: 0o700 });
      await writeFile(join(p.templateNodes, "git-commit.json"), "{}\n", { mode: 0o600 });
      await mkdir(p.adapters, { recursive: true, mode: 0o755 });
      await writeFile(join(p.adapters, "version"), "0.0.0-test\n", { mode: 0o644 });

      const testNode = Node.parse({
        name: "whoami-test", description: "writes the test user", kind: "command",
        command: ["/bin/sh", "-c", "id -un > who.txt"], outcomes: ["success"], changesFiles: true,
        outcomeRules: [{ exitCode: 0, outcome: "success" }], timeoutSec: 60,
      });
      const testFolder: string = homePaths(home).test;
      const normalId: string = await engine.nodeTests.run({ node: testNode, inputs: {}, sidecars: {} });
      await until(() => engine.nodeTests.get(normalId).state === "completed");
      expect(await readFile(join(testFolder, "who.txt"), "utf8")).toBe(`${appUser}\n`);
      const slow = Node.parse({
        name: "slow-test", description: "waits", kind: "command", command: ["/bin/sh", "-c", "sleep 30"],
        outcomes: ["success"], changesFiles: false, outcomeRules: [{ exitCode: 0, outcome: "success" }], timeoutSec: 60,
      });
      const slowId: string = await engine.nodeTests.run({ node: slow, inputs: {}, sidecars: {} });
      await until(() => engine.nodeTests.get(slowId).state === "running");

      await engine.setProtectedMode(true);
      expect((await as(protectedUser, "id -un")).out).toBe(protectedUser);
      expect(await engine.nodeTests.activeView()).toBeNull();
      expect(() => engine.nodeTests.get(slowId)).toThrow();
      expect(await readFile(join(testFolder, "README.md"), "utf8")).toBe("Sample project\n");
      await expect(readFile(join(testFolder, "who.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      const testId: string = await engine.nodeTests.run({ node: testNode, inputs: {}, sidecars: {} });
      await until(() => engine.nodeTests.get(testId).state === "completed");
      expect(await readFile(join(testFolder, "who.txt"), "utf8")).toBe(`${protectedUser}\n`);
      expect((await execFileP("stat", ["-c", "%U", join(testFolder, ".git", "config")])).stdout.trim()).toBe(protectedUser);

      await closeHome(home);
      const marker: string = join(testFolder, "filter-ran");
      expect((await as(protectedUser, 'printf "%s" "$1" >> "$2"', `[filter "pecore-test"]\n\tclean = touch ${marker}\n`, join(testFolder, ".git", "config"))).ok).toBe(true);
      expect((await as(protectedUser, 'printf "%s" "$1" > "$2"', "* filter=pecore-test\n", join(testFolder, ".gitattributes"))).ok).toBe(true);
      const secondId: string = await engine.nodeTests.run({ node: testNode, inputs: {}, sidecars: {} });
      await until(() => engine.nodeTests.get(secondId).state === "completed");
      expect((await execFileP("stat", ["-c", "%U", marker])).stdout.trim()).toBe(protectedUser);

      const nestedNode = Node.parse({
        name: "nested-test", description: "creates nested files", kind: "command",
        command: ["/bin/sh", "-c", "mkdir -p src/generated && printf 'nested\\n' > src/generated/file"],
        outcomes: ["success"], changesFiles: true,
        outcomeRules: [{ exitCode: 0, outcome: "success" }], timeoutSec: 60,
      });
      const nestedId: string = await engine.nodeTests.run({ node: nestedNode, inputs: {}, sidecars: {} });
      await until(() => engine.nodeTests.get(nestedId).state === "completed");
      expect((await as(protectedUser, 'test -f "$1"', join(testFolder, "src", "generated", "file"))).ok).toBe(true);
      await engine.nodeTests.reset();
      expect(await readFile(join(testFolder, "README.md"), "utf8")).toBe("Sample project\n");
      expect((await as(protectedUser, 'test ! -e "$1"', join(testFolder, "src", "generated"))).ok).toBe(true);

      const project = engine.project("demo");
      const job: string = await engine.createJob("demo", { title: "Who runs jobs", request: "write who.txt" });
      await until(() => project.executor.job(job).state === "succeeded");
      expect((await gitApp(join(project.ctx.dir, "repo.git"), ["show", `factory/${job}:who.txt`])).trim()).toBe(protectedUser);

      for (const secret of [join(appLogin, ".credentials.json"), join(project.ctx.dir, "pecore.db"), join(project.ctx.dir, "project.json"), join(p.templateNodes, "git-commit.json"), p.chatsDb]) {
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
      expect((await as(protectedUser, 'mkdir -p "$1/.pecore-harness/legacy" "$1/.pecore-chats/x" && echo old-secret > "$1/.pecore-harness/legacy/auth.json" && chmod 600 "$1/.pecore-harness/legacy/auth.json"', agentHome)).ok).toBe(true);
      expect((await as(protectedUser, 'stat -c "%U %a" -- "$1"', join(agentHome, ".pecore-harness", "legacy", "auth.json"))).out).toBe(`${protectedUser} 600`);
      await moveLegacyFolders(home, true);
      expect((await as(protectedUser, 'cat -- "$1"', join(p.harness, protectedUser, "legacy", "auth.json"))).out).toBe("old-secret");
      expect((await as(protectedUser, 'stat -c "%U %a" -- "$1"', join(p.harness, protectedUser, "legacy", "auth.json"))).out).toBe(`${protectedUser} 600`);
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

      await engine.setProtectedMode(false, true);
      const repo: string = join(project.ctx.dir, "repo.git");
      expect((await execFileP("find", [repo, join(project.ctx.dir, "work"), "!", "-user", appUser])).stdout).toBe("");
      await gitApp(repo, ["update-ref", "-d", `refs/heads/factory/${job}`]);
      const after: string = await engine.createJob("demo", { title: "Who runs jobs now", request: "write who.txt" });
      await until(() => project.executor.job(after).state === "succeeded");
      expect((await gitApp(repo, ["show", `factory/${after}:who.txt`])).trim()).toBe(appUser);
    } finally {
      await engine.setProtectedMode(false, true).catch((error: unknown) => console.error(error));
      await engine.shutdown();
      process.env.HOME = realHome;
      await execFileP("sudo", ["-n", "rm", "-rf", "--", root]);
    }
  }, 300000);
});
