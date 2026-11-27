import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { apiClient, Node } from "@pecore/schemas";
import type { NodeTestView } from "@pecore/schemas";
import { setTestConfiguration } from "../../test/configuration";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";

const fakeAgent = fileURLToPath(new URL("../../../agents/test/fake-agent/agent.mjs", import.meta.url));

const init = [{ expect: "initialize" }, { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } } } } }];
const session = [{ expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } }];
const prompt = { expect: "session/prompt" };
const answer = (value: object) => ({
  send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(value) } } } },
});
const usageAnswer = { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: 0, cachedWriteTokens: 0 } } } };

async function setup(agent = false) {
  const root = await tempDir();
  const home = join(root, "home");
  const templates = join(root, "templates");
  const sampleProject = join(root, "test-project");
  await cp(shippedTemplates, templates, { recursive: true });
  await mkdir(sampleProject, { recursive: true });
  await writeFile(join(sampleProject, "README.md"), "Sample project\n");
  await writeFile(join(sampleProject, "hello.txt"), "hello\n");
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
  return { root, home, sampleProject, engine, call, close };
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

describe("node tests", () => {
  it("runs a command, keeps its changes between runs and resets the folder", async () => {
    const { call, close, sampleProject } = await setup();
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
      expect(await readFile(join(sampleProject, "hello.txt"), "utf8")).toBe("hello\n");
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
      const { id } = await call("runNodeTest", { body: { node: human, inputs: {}, sidecars: {} } });
      const waiting = await until(async () => {
        const view = await call("getNodeTest", { params: { id } });
        return view.state === "waiting" ? view : undefined;
      });
      expect(waiting.question).toMatchObject({ kind: "human", text: "Continue?", choices: ["yes", "no"] });
      await expect(call("answerNodeTest", { params: { id }, body: { choice: "maybe" } })).rejects.toMatchObject({ status: 400 });
      await call("answerNodeTest", { params: { id }, body: { choice: "yes", note: "Go on." } });
      expect(await finished(call, id)).toMatchObject({ state: "completed", outcome: "yes", outputs: [{ type: "feedback", content: "Go on." }] });
    } finally {
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
