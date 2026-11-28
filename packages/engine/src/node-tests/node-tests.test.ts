import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { apiClient, Node } from "@pecore/schemas";
import type { NodeTestView } from "@pecore/schemas";
import { setTestConfiguration } from "../../test/configuration";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";
import * as acl from "../osuser/acl";

const execFileP = promisify(execFile);
const fakeAgent = fileURLToPath(new URL("../../../agents/test/fake-agent/agent.mjs", import.meta.url));

const init = [{ expect: "initialize" }, { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } } } } }];
const session = [{ expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } }];
const prompt = { expect: "session/prompt" };
const answer = (value: object) => ({
  send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(value) } } } },
});
const usageAnswer = { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: 0, cachedWriteTokens: 0 } } } };

async function setup(agent = false, opts: { sampleLink?: boolean; existingLink?: boolean; missingSample?: boolean; upstream?: boolean; dependencies?: boolean } = {}) {
  const root = await tempDir();
  const home = join(root, "home");
  const templates = join(root, "templates");
  const project = join(root, "sample-source");
  const source = join(project, "sample");
  const sampleProject = opts.sampleLink ? join(root, "test-project") : project;
  await cp(shippedTemplates, templates, { recursive: true });
  if (!opts.missingSample) {
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "README.md"), "Sample project\n");
    await writeFile(join(source, "hello.txt"), "hello\n");
    if (opts.upstream) {
      await writeFile(join(source, "greeting.txt"), "Hello\n");
      await mkdir(join(project, "upstream"), { recursive: true });
      await writeFile(join(project, "upstream", "greeting.txt"), "Hi\n");
    }
    if (opts.dependencies) {
      await writeFile(join(source, ".gitignore"), "node_modules/\n");
      await writeFile(join(source, "package.json"), "{\"name\":\"sample\",\"private\":true}\n");
      await writeFile(join(source, "package-lock.json"), "{\"name\":\"sample\",\"lockfileVersion\":3}\n");
    }
    if (opts.sampleLink) await symlink(project, sampleProject);
    if (opts.existingLink) {
      await mkdir(home, { recursive: true });
      await symlink(source, join(home, "test"));
    }
  }
  let agents;
  if (agent) {
    const connectors = join(root, "connectors");
    await mkdir(connectors);
    const script = join(root, "agent.jsonl");
    await writeFile(script, [
      ...init, ...session, prompt,
      { write: { path: "agent.txt", content: "written by the agent\n" } },
      answer({ outcome: "approved", output: { body: "Looks good.", comments: [] } }),
      usageAnswer,
    ].map((step) => JSON.stringify(step)).join("\n") + "\n");
    await writeFile(join(connectors, "fake.json"), JSON.stringify({
      name: "fake", title: "Fake", kind: "native",
      harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" },
      command: ["{harnessPath}", fakeAgent],
      env: { FAKE_AGENT_SCRIPT: script },
      reader: "claude-code",
    }));
    await mkdir(home, { recursive: true });
    await setTestConfiguration(home, "accounts", { accounts: [{ id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" }] });
    await setTestConfiguration(home, "agents", { agents: [{
      id: "agent-default", kind: "agent", name: "Default Agent", color: "#68389A",
      model: { account: "fake", model: "m1" }, compaction: { auto: 131_072, max: 262_144 },
    }] });
    agents = { connectorsDir: connectors, adaptersDir: join(root, "adapters"), adapters: {} };
  }
  const engine = await Engine.start({ home, templates, sampleProject, ...(agents ? { agents, checkLogins: false } : {}) });
  const api = await startApi(engine, { handlers: handlers("0.0.0-test"), validateResponses: true });
  const call = apiClient({ port: api.port, token: api.token });
  const close = async () => {
    await api.close();
    await engine.shutdown();
  };
  return { root, home, source, sampleProject, engine, call, close };
}

async function until<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function finished(call: ReturnType<typeof apiClient>, id: string): Promise<NodeTestView> {
  return until(async () => {
    const view = await call("getNodeTest", { params: { id } });
    return view.state === "running" ? undefined : view;
  });
}

async function shippedNode(name: string): Promise<Node> {
  return Node.parse(JSON.parse(await readFile(join(shippedTemplates, "nodes", `${name}.json`), "utf8")));
}

async function fakeNpm(root: string, body: string): Promise<void> {
  const bin: string = join(root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "npm"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
}

const command = (extra: object = {}) => Node.parse({
  name: "write", description: "Write a file", kind: "command",
  command: ["/bin/sh", "-c", "printf 'changed\n' > hello.txt"],
  outcomes: ["success"], changesFiles: true, timeoutSec: 30,
  outcomeRules: [{ exitCode: 0, outcome: "success" }],
  ...extra,
});

const human = Node.parse({
  name: "decide", description: "Ask the user", kind: "human", interface: "decision",
  outcomes: ["yes", "no"], outputs: { yes: "feedback" },
  params: { type: "object", properties: { question: { type: "string", minLength: 1, default: "Continue?" } }, required: ["question"] },
});

const review = Node.parse({
  name: "review", description: "Review the change", kind: "human", interface: "code-review",
  outcomes: ["approved", "changes_requested", "rejected"], outputs: { changes_requested: "code_review" },
  params: { type: "object", properties: { question: { type: "string", default: "Not the review text" } } },
});

describe("node tests", () => {
  it("runs a command, keeps its changes between runs and resets the folder", async () => {
    const { call, close, source } = await setup();
    try {
      const { id } = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      const first = await finished(call, id);
      expect(first).toMatchObject({ state: "completed", outcome: "success", failureReason: null });
      expect(first.files).toEqual([{ status: "M", path: "hello.txt" }]);
      expect(first.diff).toContain("+changed");
      const result = await call("getLog", { params: { id }, query: { view: "raw" } });
      expect(result.view).toBe("raw");
      expect(result.view === "raw" && result.lines.some((line) => JSON.stringify(line).includes("exit: 0"))).toBe(true);

      const second = await call("runNodeTest", { body: { node: command({ name: "read", command: ["/bin/cat", "hello.txt"] }), inputs: {}, sidecars: {} } });
      const view = await finished(call, second.id);
      const log = await call("getLog", { params: { id: second.id }, query: { view: "events" } });
      expect(view.state).toBe("completed");
      expect(log).toMatchObject({ view: "events", events: [{ type: "output", text: expect.stringContaining("changed") }] });

      await call("resetNodeTests");
      expect(await readFile(join(source, "hello.txt"), "utf8")).toBe("hello\n");
      await expect(call("getNodeTest", { params: { id } })).rejects.toMatchObject({ status: 404 });
      const restored = await call("runNodeTest", { body: { node: command({ name: "read", command: ["/bin/cat", "hello.txt"] }), inputs: {}, sidecars: {} } });
      await finished(call, restored.id);
      const restoredLog = await call("getLog", { params: { id: restored.id }, query: { view: "events" } });
      expect(restoredLog).toMatchObject({ view: "events", events: [{ type: "output", text: expect.stringContaining("hello") }] });
    } finally {
      await close();
    }
  });

  it("resets after a commit and a deleted file", async () => {
    const { call, close } = await setup();
    try {
      const node = command({
        name: "commit", changesFiles: true,
        command: ["/bin/sh", "-c", "printf 'changed\n' > hello.txt && git add -A && git commit -q -m change && rm README.md"],
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      expect((await finished(call, id)).state).toBe("completed");
      await call("resetNodeTests");
      const { id: read } = await call("runNodeTest", { body: { node: command({ name: "read", command: ["/bin/cat", "README.md"] }), inputs: {}, sidecars: {} } });
      const view = await finished(call, read);
      const log = await call("getLog", { params: { id: read }, query: { view: "events" } });
      expect(view.state).toBe("completed");
      expect(log).toMatchObject({ view: "events", events: [{ type: "output", text: expect.stringContaining("Sample project") }] });
    } finally {
      await close();
    }
  });

  it("rejects an input that is not of its artifact type and passes a valid one", async () => {
    const { call, close } = await setup();
    try {
      const node = command({ name: "read-spec", command: ["/bin/cat"], inputs: ["spec"] });
      await expect(call("runNodeTest", { body: { node, inputs: { spec: "not json" }, sidecars: {} } })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("spec input is not valid") });
      const spec = JSON.stringify({ feature: "Demo", scenarios: [{ name: "One", given: ["a"], when: "b", then: ["c"] }] });
      const { id } = await call("runNodeTest", { body: { node, inputs: { spec }, sidecars: {} } });
      expect((await finished(call, id)).state).toBe("completed");
      const log = await call("getLog", { params: { id }, query: { view: "events" } });
      expect(log).toMatchObject({ view: "events", events: [{ type: "output", text: expect.stringContaining('"feature":"Demo"') }] });
    } finally {
      await close();
    }
  });

  it("stops a running command", async () => {
    const { call, close } = await setup();
    try {
      const node = command({ name: "wait", command: ["/bin/sh", "-c", "sleep 30"] });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      await until(() => call("getNodeTest", { params: { id } }).then((view) => view.state === "running"));
      await call("stopNodeTest", { params: { id } });
      expect(await finished(call, id)).toMatchObject({ state: "stopped" });
    } finally {
      await close();
    }
  });

  it("asks a Human node's question and completes its outcome", async () => {
    const { call, close } = await setup();
    try {
      const { id } = await call("runNodeTest", { body: { node: human, inputs: { diff: "diff --git a/a b/a\n" }, sidecars: {} } });
      const waiting = await until(async () => {
        const view = await call("getNodeTest", { params: { id } });
        return view.state === "waiting" ? view : undefined;
      });
      expect(waiting.question).toMatchObject({
        kind: "human", text: "Continue?", choices: ["yes", "no"],
        inputs: [{ type: "diff", content: "diff --git a/a b/a\n" }],
      });
      await expect(call("answerNodeTest", { params: { id }, body: { choice: "maybe" } })).rejects.toMatchObject({ status: 400 });
      await call("answerNodeTest", { params: { id }, body: { choice: "yes", note: "Go on." } });
      expect(await finished(call, id)).toMatchObject({ state: "completed", outcome: "yes", outputs: [{ type: "feedback", content: "Go on." }], question: null });
      await expect(call("answerNodeTest", { params: { id }, body: { choice: "yes" } })).rejects.toMatchObject({ status: 400 });
    } finally {
      await close();
    }
  });

  it("uses the Human runner's review question and result", async () => {
    const { call, close } = await setup();
    try {
      const diff: string = "diff --git a/a b/a\n";
      const first = await call("runNodeTest", { body: { node: review, inputs: { diff }, sidecars: {} } });
      const waiting = await until(async () => {
        const view = await call("getNodeTest", { params: { id: first.id } });
        return view.state === "waiting" ? view : undefined;
      });
      expect(waiting.question).toEqual({
        kind: "human", text: "Review the change", choices: ["approved", "changes_requested", "rejected"],
        notes: ["changes_requested"], inputs: [{ type: "diff", content: diff }],
      });
      await call("answerNodeTest", { params: { id: first.id }, body: { choice: "changes_requested", note: "Fix the typo." } });
      expect(await finished(call, first.id)).toMatchObject({
        state: "completed", outcome: "changes_requested",
        outputs: [{ type: "code_review", content: JSON.stringify({ body: "Fix the typo.", comments: [] }) }],
      });

      const second = await call("runNodeTest", { body: { node: review, inputs: { diff }, sidecars: {} } });
      await until(async () => {
        const view = await call("getNodeTest", { params: { id: second.id } });
        return view.state === "waiting" ? view : undefined;
      });
      await call("answerNodeTest", { params: { id: second.id }, body: { choice: "approved", note: "Looks good." } });
      expect(await finished(call, second.id)).toMatchObject({ state: "completed", outcome: "approved", outputs: [] });
    } finally {
      await close();
    }
  });

  it("keeps only the active test and the last finished one", async () => {
    const { call, close } = await setup();
    try {
      const first = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect((await finished(call, first.id)).state).toBe("completed");
      const firstLog = await call("getLog", { params: { id: first.id }, query: { view: "events" } });
      expect(firstLog.view).toBe("events");

      const second = await call("runNodeTest", { body: { node: command({ name: "slow", command: ["/bin/sh", "-c", "sleep 30"] }), inputs: {}, sidecars: {} } });
      expect((await call("getNodeTest", { params: { id: first.id } })).state).toBe("completed");
      await call("stopNodeTest", { params: { id: second.id } });
      expect((await finished(call, second.id)).state).toBe("stopped");
      await expect(call("getNodeTest", { params: { id: first.id } })).rejects.toMatchObject({ status: 404 });
      await expect(call("getLog", { params: { id: first.id }, query: { view: "events" } })).rejects.toMatchObject({ status: 404 });
      expect((await call("getNodeTest", { params: { id: second.id } })).state).toBe("stopped");
      expect((await call("getLog", { params: { id: second.id }, query: { view: "events" } })).view).toBe("events");
    } finally {
      await close();
    }
  });

  it("applies the test folder access only when it creates or resets the folder", async () => {
    const { call, close } = await setup();
    const accessible = vi.spyOn(acl, "privateDirectory");
    try {
      const first = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      await finished(call, first.id);
      expect(accessible).toHaveBeenCalledTimes(1);
      const second = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      await finished(call, second.id);
      expect(accessible).toHaveBeenCalledTimes(1);
      await call("resetNodeTests");
      expect(accessible).toHaveBeenCalledTimes(2);
    } finally {
      accessible.mockRestore();
      await close();
    }
  });

  it("runs an Agent node with the unsaved prompt and shows its output", async () => {
    const { call, close } = await setup(true);
    try {
      const node = Node.parse({
        name: "review", description: "Review the change", kind: "agent", prompt: "review.md",
        outcomes: ["approved"], outputs: { approved: "code_review" }, changesFiles: true, timeoutSec: 60,
        agent: { tier: "standard" },
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: { diff: "diff --git a/a b/a\n" }, sidecars: { "review.md": "Unsaved prompt marker. Review the change." } } });
      const view = await finished(call, id);
      expect(view).toMatchObject({ state: "completed", outcome: "approved", outputs: [{ type: "code_review", content: expect.stringContaining("Looks good.") }] });
      expect(view.files).toEqual([{ status: "A", path: "agent.txt" }]);
      const raw = await call("getLog", { params: { id }, query: { view: "raw" } });
      expect(JSON.stringify(raw)).toContain("Unsaved prompt marker");
    } finally {
      await close();
    }
  });

  it("copies a symlinked sample and replaces an old test folder symlink without touching the source", async () => {
    const { call, close, source, home } = await setup(false, { sampleLink: true, existingLink: true });
    try {
      const { id } = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect((await finished(call, id)).state).toBe("completed");
      expect(await readFile(join(source, "hello.txt"), "utf8")).toBe("hello\n");
      expect((await lstat(join(home, "test"))).isSymbolicLink()).toBe(false);
      await call("resetNodeTests");
      expect(await readFile(join(source, "hello.txt"), "utf8")).toBe("hello\n");
      expect(await readFile(join(home, "test", "repo", "hello.txt"), "utf8")).toBe("hello\n");
    } finally {
      await close();
    }
  });

  it("runs one test at a time", async () => {
    const { call, close } = await setup();
    try {
      const node = command({ name: "slow", command: ["/bin/sh", "-c", "sleep 30"] });
      const results = await Promise.allSettled([
        call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } }),
        call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } }),
      ]);
      const started = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const rejected = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      expect(started).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ status: 409 });
      const id: string = started[0]!.id;
      expect((await call("getActiveNodeTest"))?.id).toBe(id);
      await call("stopNodeTest", { params: { id } });
      expect((await finished(call, id)).state).toBe("stopped");
      expect(await call("getActiveNodeTest")).toBeNull();
    } finally {
      await close();
    }
  });

  it("restores a read-only node that changed files and fails it", async () => {
    const { call, close, home } = await setup();
    try {
      const node = command({
        name: "read-only", changesFiles: false,
        command: ["/bin/sh", "-c", "printf 'not-a-sha'; printf 'x' > new.txt"],
        outputs: { success: "sha" }, outputRules: { success: { stdoutLastLine: "sha" } },
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      expect(await finished(call, id)).toMatchObject({
        state: "failed", failureReason: "READ_ONLY_VIOLATION", outcome: null, outputs: [], diff: "", files: [],
      });
      await expect(lstat(join(home, "test", "repo", "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await close();
    }
  });

  it("fails a Command whose output does not match its artifact type", async () => {
    const { call, close } = await setup();
    try {
      const node = command({
        name: "invalid-output", changesFiles: false, command: ["/bin/sh", "-c", "printf 'not-a-sha'"],
        outputs: { success: "sha" }, outputRules: { success: { stdoutLastLine: "sha" } },
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      expect(await finished(call, id)).toMatchObject({
        state: "failed", failureReason: "INVALID_OUTPUT", outcome: null, outputs: [],
        error: expect.stringContaining("sha output is not valid"),
      });
    } finally {
      await close();
    }
  });

  it("clears a completed result when scratch files cannot be deleted", async () => {
    const { call, close } = await setup();
    try {
      const node = command({
        name: "break-scratch", changesFiles: true, scratchPaths: ["tmp/**"],
        command: ["/bin/sh", "-c", "rm -rf .git; printf 'note'"],
        outputs: { success: "feedback" }, outputRules: { success: { stdoutLastLine: "note" } },
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      expect(await finished(call, id)).toMatchObject({
        state: "failed", failureReason: "HARNESS_ERROR", outcome: null, outputs: [],
      });
    } finally {
      await close();
    }
  });

  it("clears a completed result when the file rules cannot be checked", async () => {
    const { call, close } = await setup();
    try {
      const node = command({
        name: "break-git", changesFiles: false, command: ["/bin/sh", "-c", "rm -rf .git; printf 'note'"],
        outputs: { success: "feedback" }, outputRules: { success: { stdoutLastLine: "note" } },
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      expect(await finished(call, id)).toMatchObject({
        state: "failed", failureReason: "HARNESS_ERROR", outcome: null, outputs: [],
      });
    } finally {
      await close();
    }
  });

  it("deletes a completed node's scratch files before showing file changes", async () => {
    const { call, close, home } = await setup();
    try {
      const node = command({
        name: "scratch", changesFiles: false, scratchPaths: ["coverage/**"],
        command: ["/bin/sh", "-c", "mkdir -p coverage && printf 'x' > coverage/report.txt && printf 'ok'"],
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      expect(await finished(call, id)).toMatchObject({ state: "completed", outcome: "success", diff: "", files: [] });
      await expect(lstat(join(home, "test", "repo", "coverage", "report.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await close();
    }
  });

  it.skipIf(process.platform !== "linux")("stops a detached process that carries the test id", async () => {
    const { call, close, home } = await setup();
    try {
      const node = command({ name: "detached", command: ["/bin/sh", "-c", "setsid sleep 30 & echo $! > detached.pid; wait"] });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } });
      const pid = await until(async () => {
        const text = await readFile(join(home, "test", "repo", "detached.pid"), "utf8").catch(() => "");
        return text.trim() ? Number(text.trim()) : undefined;
      });
      await call("stopNodeTest", { params: { id } });
      expect((await finished(call, id)).state).toBe("stopped");
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    } finally {
      await close();
    }
  });

  it("returns a bad request when the sample project cannot be restored", async () => {
    const { call, close } = await setup(false, { missingSample: true });
    try {
      await expect(call("resetNodeTests")).rejects.toMatchObject({ status: 400 });
    } finally {
      await close();
    }
  });

  it("refuses an Agent node with tracker access instead of running without its tools", async () => {
    const { call, close } = await setup(true);
    try {
      const node = Node.parse({
        name: "tracker", description: "Read a ticket", kind: "agent", prompt: "tracker.md",
        outcomes: ["success"], changesFiles: false, timeoutSec: 30, agent: { tier: "standard" },
        tracker: { access: "read", account: "project.account" },
      });
      const { id } = await call("runNodeTest", { body: { node, inputs: {}, sidecars: { "tracker.md": "Read the ticket." } } });
      expect(await finished(call, id)).toMatchObject({ state: "failed", failureReason: "AGENT_UNAVAILABLE", error: expect.stringContaining("Tracker access") });
    } finally {
      await close();
    }
  });

  it("gives Git Rebase a newer base that it reaches or conflicts with", async () => {
    const { call, close, home } = await setup(false, { upstream: true });
    try {
      const rebase: Node = await shippedNode("git-rebase");
      const clean = await call("runNodeTest", { body: { node: rebase, inputs: {}, sidecars: {} } });
      expect(await finished(call, clean.id)).toMatchObject({ state: "completed", outcome: "success", files: [{ status: "M", path: "greeting.txt" }] });
      expect(await readFile(join(home, "test", "repo", "greeting.txt"), "utf8")).toBe("Hi\n");

      await call("resetNodeTests");
      expect(await readFile(join(home, "test", "repo", "greeting.txt"), "utf8")).toBe("Hello\n");
      const edit = await call("runNodeTest", { body: { node: command({ name: "edit", command: ["/bin/sh", "-c", "printf 'Howdy\\n' > greeting.txt"] }), inputs: {}, sidecars: {} } });
      expect((await finished(call, edit.id)).state).toBe("completed");
      const conflict = await call("runNodeTest", { body: { node: rebase, inputs: {}, sidecars: {} } });
      expect(await finished(call, conflict.id)).toMatchObject({ state: "completed", outcome: "rebase_conflict", files: [] });
      expect(await readFile(join(home, "test", "repo", "greeting.txt"), "utf8")).toBe("Howdy\n");
    } finally {
      await close();
    }
  });

  it("commits with Git Commit and returns the new SHA", async () => {
    const { call, close } = await setup();
    try {
      const edit = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect((await finished(call, edit.id)).state).toBe("completed");
      const commit = await call("runNodeTest", { body: { node: await shippedNode("git-commit"), inputs: {}, sidecars: {} } });
      const view = await finished(call, commit.id);
      expect(view).toMatchObject({ state: "completed", outcome: "success", outputs: [{ type: "sha", content: expect.stringMatching(/^[0-9a-f]{40}$/) }] });
      const head = await call("runNodeTest", { body: { node: command({ name: "head", changesFiles: false, command: ["git", "rev-parse", "HEAD"] }), inputs: {}, sidecars: {} } });
      await finished(call, head.id);
      const log = await call("getLog", { params: { id: head.id }, query: { view: "events" } });
      expect(log).toMatchObject({ view: "events", events: [{ type: "output", text: expect.stringContaining(view.outputs[0]!.content) }] });
    } finally {
      await close();
    }
  });

  it("replaces a test folder made from an older sample", async () => {
    const { call, close, home } = await setup();
    try {
      const old: string = join(home, "test");
      await mkdir(old, { recursive: true });
      await writeFile(join(old, "old.txt"), "old\n");
      await execFileP("git", ["init", "-q"], { cwd: old });
      const { id } = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect(await finished(call, id)).toMatchObject({ state: "completed", files: [{ status: "M", path: "hello.txt" }] });
      await expect(lstat(join(old, "old.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await close();
    }
  });

  it("installs the sample's dependencies once and keeps them on reset", async () => {
    const { root, call, close, home } = await setup(false, { dependencies: true });
    const count: string = join(root, "npm-calls");
    await fakeNpm(root, `echo "$*" >> '${count}'; mkdir -p node_modules`);
    try {
      const first = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect(await finished(call, first.id)).toMatchObject({ state: "completed", notice: null, files: [{ status: "M", path: "hello.txt" }] });
      expect(await readFile(count, "utf8")).toBe("ci --ignore-scripts --no-audit --no-fund\n");
      await writeFile(join(home, "test", "repo", "node_modules", "kept.txt"), "kept\n");
      await call("resetNodeTests");
      expect(await readFile(join(home, "test", "repo", "node_modules", "kept.txt"), "utf8")).toBe("kept\n");
      expect(await readFile(join(home, "test", "repo", "hello.txt"), "utf8")).toBe("hello\n");
      expect(await readFile(count, "utf8")).toBe("ci --ignore-scripts --no-audit --no-fund\n");
    } finally {
      vi.unstubAllEnvs();
      await close();
    }
  });

  it("reports a failed install in the panel and retries it on reset", async () => {
    const { root, call, close } = await setup(false, { dependencies: true });
    await fakeNpm(root, "echo 'npm error network unreachable' >&2; exit 1");
    try {
      const first = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect(await finished(call, first.id)).toMatchObject({
        state: "completed", notice: expect.stringMatching(/could not be installed[\s\S]*network unreachable/),
      });
      await expect(call("resetNodeTests")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("network unreachable") });
      await fakeNpm(root, "mkdir -p node_modules");
      await call("resetNodeTests");
      const second = await call("runNodeTest", { body: { node: command(), inputs: {}, sidecars: {} } });
      expect(await finished(call, second.id)).toMatchObject({ state: "completed", notice: null });
    } finally {
      vi.unstubAllEnvs();
      await close();
    }
  });

  it("explains that Repository nodes cannot be tested", async () => {
    const { call, close } = await setup();
    try {
      const node = Node.parse({
        name: "publish", description: "Publish", kind: "repository", account: "project.account",
        script: "git status", outcomes: ["success"], changesFiles: false,
        outcomeRules: [{ exitCode: 0, outcome: "success" }],
      });
      await expect(call("runNodeTest", { body: { node, inputs: {}, sidecars: {} } })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Repository nodes") });
    } finally {
      await close();
    }
  });
});
