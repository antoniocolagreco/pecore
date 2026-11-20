import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { apiClient } from "@pecore/schemas";
import type { ChatDetail, LiveMessage } from "@pecore/schemas";
import { FakeForge, forgeAccount } from "../../test/fake-forge";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";

const fakeAgent = fileURLToPath(new URL("../../../agents/test/fake-agent/agent.mjs", import.meta.url));
const shim = fileURLToPath(new URL("../../../agents/scripts/orchestrator-mcp.mjs", import.meta.url));
const realHome = process.env.HOME;
const realPath: string | undefined = process.env.PATH;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const writeHello = {
  name: "write-hello",
  description: "writes hello.txt",
  kind: "command",
  command: ["/bin/sh", "-c", "echo hello > hello.txt"],
  outcomes: ["done"],
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  timeoutSec: 30,
};
const bigOut = {
  name: "big-out",
  description: "prints 300 KB",
  kind: "command",
  command: ["/bin/sh", "-c", "printf HEAD; head -c 300000 /dev/zero | tr '\\0' x; printf END"],
  outcomes: ["done"],
  changesFiles: false,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  timeoutSec: 30,
};
const reviewed = {
  name: "reviewed",
  description: "write, human review, commit",
  start: "write",
  successOutcomes: ["commit:done"],
  nodes: { write: { use: "write-hello" }, human: { use: "human-review" }, commit: { use: "git-commit" } },
  edges: [
    { from: "write", on: "done", to: "human" },
    { from: "human", on: "approve", to: "commit" },
  ],
};
const big = { name: "big", description: "one noisy command", start: "out", successOutcomes: ["out:done"], nodes: { out: { use: "big-out" } }, edges: [] };
const fakeSource = {
  name: "fake-source",
  description: "one ticket from a trusted author",
  kind: "source",
  params: { type: "object", properties: { trusted: { type: "array", items: { type: "string" }, default: [] }, pollSec: { type: "integer", default: 300 } } },
  list: { command: ["/bin/sh", "-c", `printf '[{"id":"7","title":"Login broken"}]'`] },
  read: { command: ["/bin/sh", "-c", `printf '{"title":"Login broken","body":"the login button does nothing","author":"alice"}'`] },
  comment: { command: ["/bin/true"] },
  replies: { command: ["/bin/sh", "-c", "printf '[]'"] },
  timeoutSec: 10,
};

const init = (image = false) => [
  { expect: "initialize" },
  { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} }, promptCapabilities: { image } } } } },
];
const newSession = [{ expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } }];
const replyWith = (text: string) => [
  { send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } } },
  { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn" } } },
];

const usage = (used: number) => ({ send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "usage_update", used, size: 1_000_000 } } } });

type Rpc ={ id: number; result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function setup(build: (root: string) => object[][], extra: { source?: boolean; orchestrator?: (root: string) => object[][]; compaction?: object; forge?: boolean } = {}) {
  const root = await tempDir();
  const scripts: object[][] = build(root);
  const orchestratorScripts: object[][] = extra.orchestrator?.(root) ?? [];
  process.env.HOME = join(root, "user");
  await mkdir(process.env.HOME);
  const forge: FakeForge | null = extra.forge ? await FakeForge.start() : null;
  const home = join(root, "home");
  const library = join(root, "library");
  await cp(shippedLibrary, library, { recursive: true });
  await writeFile(join(library, "nodes", "write-hello.json"), JSON.stringify(writeHello));
  await writeFile(join(library, "nodes", "big-out.json"), JSON.stringify(bigOut));
  await writeFile(join(library, "recipes", "reviewed.json"), JSON.stringify(reviewed));
  await writeFile(join(library, "recipes", "big.json"), JSON.stringify(big));
  const files: string[] = [];
  for (const [i, s] of scripts.entries()) {
    const f = join(root, `script-${i}.jsonl`);
    await writeFile(f, s.map((x) => JSON.stringify(x)).join("\n") + "\n");
    files.push(f);
  }
  const connectors = join(root, "connectors");
  await mkdir(connectors);
  const orchestratorFiles: string[] = [];
  for (const [i, s] of orchestratorScripts.entries()) {
    const f = join(root, `orchestrator-${i}.jsonl`);
    await writeFile(f, s.map((x) => JSON.stringify(x)).join("\n") + "\n");
    orchestratorFiles.push(f);
  }
  const connector = (name: string, scriptFiles: string[]) => JSON.stringify({ name, title: "Fake", kind: "native", harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" }, command: ["{harnessPath}", fakeAgent], env: { FAKE_AGENT_SCRIPT: scriptFiles.join(",") }, reader: "claude-code" });
  await writeFile(join(connectors, "fake.json"), connector("fake", files));
  await mkdir(home, { recursive: true });
  if (extra.orchestrator) {
    await writeFile(join(connectors, "fake-background.json"), connector("fake-background", orchestratorFiles));
    await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [
      { id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" },
      { id: "background", kind: "model", provider: "fakeco", connector: "fake-background", login: "subscription" },
    ] }));
    await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p1", account: "fake", model: "m1" }, { id: "p2", account: "background", model: "m2" }] }));
    await writeFile(join(home, "settings.json"), JSON.stringify({ assistant: { profile: "p1" }, orchestrator: { profile: "p2", ...extra.compaction && { compaction: extra.compaction } } }));
  } else {
    await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" }, ...(forge ? [forgeAccount] : [])] }));
    await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p1", account: "fake", model: "m1" }] }));
    await writeFile(join(home, "settings.json"), JSON.stringify({ assistant: { profile: "p1" } }));
  }
  await writeFile(join(home, "tiers.json"), JSON.stringify({ tiers: { strong: ["p1"] } }));
  const agents = { connectorsDir: connectors, adaptersDir: join(root, "adapters"), adapters: {} };
  const open = async () => {
    const engine = await Engine.start({ home, library, agents, checkLogins: false });
    const api = await startApi(engine, { handlers: handlers("0.0.0-test"), validateResponses: true });
    return { engine, api, call: apiClient({ port: api.port, token: api.token }), close: async () => { await api.close(); await engine.shutdown(); } };
  };
  const first = await open();
  await first.engine.createProject({ id: "demo", name: "Demo", repo: null, defaultRecipe: "reviewed" }, ["reviewed", "big"]);
  if (extra.source) {
    const dir = first.engine.projectDir("demo");
    await writeFile(join(dir, "nodes", "fake-source.json"), JSON.stringify({ ...fakeSource, comment: { command: ["/bin/sh", "-c", `echo posted >> '${join(root, "comments")}'`] } }));
    const project = JSON.parse(await readFile(join(dir, "project.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(dir, "project.json"), JSON.stringify({ ...project, source: { node: "fake-source", params: { trusted: ["alice"] } } }));
    expect(await first.engine.reloadProject("demo")).toEqual([]);
  }
  return { root, forge, open, ...first };
}

function mcp(tokenFile: string) {
  const child = spawn(process.execPath, [shim, tokenFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
  let next = 1;
  const rpc = async (method: string, params: unknown): Promise<Rpc> => {
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }) + "\n");
    return JSON.parse((await lines.next()).value as string) as Rpc;
  };
  const tool = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
  return { rpc, tool, close: () => child.stdin!.end() };
}

const tokenFileOf = (chatId: string) => join(process.env.HOME!, ".pecore-chats", chatId, "mcp-token");
const intakeChat = (t: { engine: Engine }) => t.engine.orchestrator.chats().find(({ project }) => project === "demo")!.id;
const plan = [
  { key: "api", title: "API", ticketText: "add the endpoint", dependsOn: [] },
  { key: "ui", title: "UI", ticketText: "add the screen", dependsOn: ["api"] },
];

afterEach(() => {
  process.env.HOME = realHome;
  if (realPath !== undefined) process.env.PATH = realPath;
});

describe("orchestrator chat with the MCP shim (section 6, Phase 6 decisions 1, 3 and 4)", () => {
  it("exposes partial replies before the prompt ends and saves one complete reply", async () => {
    const t = await setup((root) => [[
      ...init(),
      ...newSession,
      { expect: "session/prompt" },
      replyWith("First")[0]!,
      { waitFile: join(root, "next") },
      replyWith(" and second.")[0]!,
      { waitFile: join(root, "done") },
      replyWith("")[1]!,
    ]]);
    try {
      const events: LiveMessage[] = [];
      const system: { kind: string; title: string; body: string }[] = [];
      t.engine.on("live", (event: LiveMessage) => events.push(event));
      t.engine.on("notify", (n: { kind: string; title: string; body: string }) => system.push(n));
      const detail = (): Promise<ChatDetail> => t.call("getChat");
      const sent = await t.call("sendChatMessage", { body: { text: "Say two things" } });

      const first: ChatDetail = await until(async () => {
        const snapshot: ChatDetail = await detail();
        return !!snapshot.streamingReply && snapshot;
      });
      expect(events.some(({ type }) => type === "chat.changed")).toBe(true);
      expect(first.streamingReply).toMatchObject({ role: "assistant", state: "running", text: "First", replyTo: sent.id });
      expect(first.messages.map(({ state }) => state)).toEqual(["running"]);

      await writeFile(join(t.root, "next"), "");
      await until(async () => (await detail()).streamingReply?.text === "First and second.");
      await writeFile(join(t.root, "done"), "");
      const completed: ChatDetail = await until(async () => {
        const snapshot: ChatDetail = await detail();
        return snapshot.messages.some(({ role }) => role === "assistant") && snapshot;
      });
      expect(completed.streamingReply).toBeNull();
      expect(completed.messages.filter(({ role }) => role === "assistant"))
        .toMatchObject([{ state: "completed", text: "First and second.", replyTo: sent.id }]);
      expect(completed.messages.find(({ role }) => role === "user")?.replyTo).toBeNull();
      expect(system).toEqual([{ kind: "assistant-replied", title: "Assistant replied", body: "First and second." }]);
      expect(events.some((event) => event.type === "notify")).toBe(false);
      expect((await t.call("listNotifications")).filter(({ kind }) => kind === "assistant-replied")).toEqual([]);
    } finally {
      await t.close();
    }
  });

  it("sends /compact to the resumed session on its own and stores no reply for it", async () => {
    const resumed = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, ...replyWith("Hello.")],
      [...init(), ...resumed, { expect: "session/prompt" }, { dump: join(root, "compact.json") }, ...replyWith("Summary of the chat")],
      [...init(), ...resumed, { expect: "session/prompt" }, { dump: join(root, "after.json") }, ...replyWith("Still here.")],
    ]);
    try {
      const detail = (): Promise<ChatDetail> => t.call("getChat");
      expect((await detail()).supportsImages).toBe(false);
      const settled = (count: number) => until(async () => {
        const snapshot: ChatDetail = await detail();
        return snapshot.messages.length === count && snapshot.messages.every(({ state }) => state === "completed") && snapshot;
      });
      await t.call("sendChatMessage", { body: { text: "Hi" } });
      await settled(2);
      await t.call("sendChatMessage", { body: { text: "/compact" } });
      const compacted: ChatDetail = await settled(3);
      expect(compacted.messages.map(({ role, text }) => [role, text])).toEqual([["user", "Hi"], ["assistant", "Hello."], ["user", "/compact"]]);
      expect(compacted.streamingReply).toBeNull();
      expect((JSON.parse(await readFile(join(t.root, "compact.json"), "utf8")) as { params: { prompt: unknown } }).params.prompt).toEqual([{ type: "text", text: "/compact" }]);

      await t.call("sendChatMessage", { body: { text: "Next order" } });
      await settled(5);
      const after: string = await readFile(join(t.root, "after.json"), "utf8");
      expect(after).toContain("Next order");
      expect(after).not.toContain("Earlier conversation");
    } finally {
      await t.close();
    }
  });

  it("clears the Assistant history and starts a fresh session on the next message", async () => {
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, ...replyWith("Before clear.")],
      [...init(), ...newSession, { expect: "session/prompt" }, { dump: join(root, "after-clear.json") }, ...replyWith("After clear.")],
    ]);
    try {
      await t.call("getChat");
      await t.call("sendChatMessage", { body: { text: "Previous conversation" } });
      await until(async () => (await t.call("getChat")).messages.length === 2);
      expect(await t.call("clearChat")).toEqual({ ok: true });
      expect(await t.call("getChat")).toMatchObject({ messages: [], streamingReply: null, unread: 0 });

      await t.call("sendChatMessage", { body: { text: "New conversation" } });
      await until(async () => (await t.call("getChat")).messages.length === 2);
      const prompt: string = await readFile(join(t.root, "after-clear.json"), "utf8");
      expect(prompt).toContain("New conversation");
      expect(prompt).not.toContain("Previous conversation");
    } finally {
      await t.close();
    }
  });

  it("compacts at once when the context passes the maximum threshold", async () => {
    const resumed = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, usage(256_000), ...replyWith("Long answer.")],
      [...init(), ...resumed, { expect: "session/prompt" }, { dump: join(root, "compact.json") }, usage(20_000), ...replyWith("")],
    ]);
    try {
      expect((await t.call("getChat")).supportsImages).toBe(false);
      await t.call("sendChatMessage", { body: { text: "Hi" } });
      const compacted: ChatDetail = await until(async () => {
        const snapshot: ChatDetail = await t.call("getChat");
        return snapshot.messages.length === 3 && snapshot.messages.every(({ state }) => state === "completed") && snapshot;
      });
      expect(compacted.messages.map(({ role, text }) => [role, text])).toEqual([["user", "Hi"], ["assistant", "Long answer."], ["user", "/compact"]]);
      expect((JSON.parse(await readFile(join(t.root, "compact.json"), "utf8")) as { params: { prompt: unknown } }).params.prompt).toEqual([{ type: "text", text: "/compact" }]);
    } finally {
      await t.close();
    }
  });

  it("compacts after the idle time only when the context passes the automatic threshold", async () => {
    const resumed = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, usage(127_999), ...replyWith("Short.")],
      [...init(), ...resumed, { expect: "session/prompt" }, usage(128_000), ...replyWith("Longer.")],
      [...init(), ...resumed, { expect: "session/prompt" }, { dump: join(root, "compact.json") }, ...replyWith("")],
    ]);
    try {
      t.engine.orchestrator.idleCompactionMs = 300;
      expect((await t.call("getChat")).supportsImages).toBe(false);
      const settled = (count: number) => until(async () => {
        const snapshot: ChatDetail = await t.call("getChat");
        return snapshot.messages.length === count && snapshot.messages.every(({ state }) => state === "completed") && snapshot;
      });
      await t.call("sendChatMessage", { body: { text: "Hi" } });
      await settled(2);
      await new Promise((r) => setTimeout(r, 600));
      expect((await t.call("getChat")).messages).toHaveLength(2);
      await t.call("sendChatMessage", { body: { text: "More" } });
      const started: number = Date.now();
      const compacted: ChatDetail = await settled(5);
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(compacted.messages.map(({ text }) => text)).toEqual(["Hi", "Short.", "More", "Longer.", "/compact"]);
      expect(existsSync(join(t.root, "compact.json"))).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("restarts the idle time when a message is sent, even if that message fails", async () => {
    const resumed = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
    const t = await setup(() => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, usage(200_000), ...replyWith("Long.")],
      [...init(), ...resumed, { expect: "session/prompt" }, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32603, message: "boom" } } }],
    ]);
    try {
      t.engine.orchestrator.idleCompactionMs = 800;
      expect((await t.call("getChat")).supportsImages).toBe(false);
      await t.call("sendChatMessage", { body: { text: "Hi" } });
      await until(async () => (await t.call("getChat")).messages.length === 2);
      await t.call("sendChatMessage", { body: { text: "Again" } });
      await until(async () => (await t.call("getChat")).messages.at(-1)?.state === "failed");
      await new Promise((r) => setTimeout(r, 1500));
      expect((await t.call("getChat")).messages.map(({ text }) => text)).toEqual(["Hi", "Long.", "Again"]);
    } finally {
      await t.close();
    }
  });

  it("checks the thresholds again at start, with the current settings", async () => {
    const resumed = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, usage(260_000), ...replyWith("Long.")],
      [...init(), ...resumed, { expect: "session/prompt" }, { dump: join(root, "compact.json") }, ...replyWith("")],
    ]);
    const settings: string = join(t.root, "home", "settings.json");
    await writeFile(settings, JSON.stringify({ assistant: { profile: "p1", compaction: { auto: 270_000, max: 280_000 } } }));
    await t.close();
    const first = await t.open();
    expect((await first.call("getChat")).supportsImages).toBe(false);
    await first.call("sendChatMessage", { body: { text: "Hi" } });
    await until(async () => (await first.call("getChat")).messages.length === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(join(t.root, "compact.json"))).toBe(false);
    await first.close();
    await writeFile(settings, JSON.stringify({ assistant: { profile: "p1" } }));
    const again = await t.open();
    try {
      await until(() => existsSync(join(t.root, "compact.json")));
      await until(async () => {
        const snapshot: ChatDetail = await again.call("getChat");
        return snapshot.messages.at(-1)?.text === "/compact" && snapshot.messages.at(-1)?.state === "completed";
      });
      expect(existsSync(join(t.root, "compact.json"))).toBe(true);
    } finally {
      await again.close();
    }
  });

  it("keeps the saved session when /compact cannot resume it, so the next order still resumes the conversation", async () => {
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, ...replyWith("Hello.")],
      [...init(), { expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32602, message: "no such session" } } },
        { expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S2" } } }],
      [...init(), { expect: "session/resume" }, { dump: join(root, "resume.json") }, { send: { jsonrpc: "2.0", id: "$id", result: {} } },
        { expect: "session/prompt" }, ...replyWith("Still here.")],
    ]);
    try {
      expect((await t.call("getChat")).supportsImages).toBe(false);
      const settled = (count: number) => until(async () => {
        const snapshot: ChatDetail = await t.call("getChat");
        return snapshot.messages.length === count && snapshot.messages.every(({ state }) => state === "completed") && snapshot;
      });
      await t.call("sendChatMessage", { body: { text: "Hi" } });
      await settled(2);
      await t.call("sendChatMessage", { body: { text: "/compact" } });
      await settled(3);
      await t.call("sendChatMessage", { body: { text: "Next order" } });
      await settled(5);
      expect((JSON.parse(await readFile(join(t.root, "resume.json"), "utf8")) as { params: { sessionId: string } }).params.sessionId).toBe("S1");
    } finally {
      await t.close();
    }
  });

  it("validates assistant project settings before creating local or remote projects", async () => {
    const t = await setup((root) => [[
      ...init(),
      { expect: "session/new" },
      { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } },
      { expect: "session/prompt" },
      { dump: join(root, "project-prompt.json") },
      { waitFile: join(root, "done") },
      ...replyWith("Project settings checked."),
    ]], { forge: true });
    const m = mcp(tokenFileOf("assistant"));
    try {
      await t.call("sendChatMessage", { body: { text: "progetto-test, repository su github, fai tu per il resto" } });
      await until(() => existsSync(join(t.root, "project-prompt.json")));
      expect(await readFile(join(t.root, "project-prompt.json"), "utf8")).toContain("Only the card's Confirm button authorizes creation.");
      await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      const options = await m.tool("project_creation_options", {});
      expect(options.result?.content?.[0]?.text).toContain('"defaultBaseBranch":"main"');
      expect(options.result?.content?.[0]?.text).toContain('"canCreateRepository":true');
      expect(options.result?.content?.[0]?.text).toContain(`"user":"${forgeAccount.user}"`);
      expect((await m.tool("read_artifact", { view: "log", jobId: "unknown" })).result?.content?.[0]?.text).toContain("nodeRunId");
      expect((await m.tool("create_jobs", { project: "demo", plan: [] })).result?.isError).toBe(true);
      const settings = { name: "Mock One", repository: { mode: "local" }, baseBranch: "develop", recipes: ["local-only"] };
      for (const invalid of [
        { name: "Mock One" },
        { ...settings, baseBranch: "bad..branch" },
        { ...settings, recipes: [] },
        { ...settings, recipes: ["local-only", "local-only"] },
        { ...settings, repository: { mode: "new", url: "https://github.com/acme/mock-one.git", account: "missing" } },
      ]) {
        expect((await m.tool("create_project", invalid)).result?.isError).toBe(true);
      }
      expect(existsSync(t.engine.projectDir("mock-one"))).toBe(false);
      const propose = async (input: unknown): Promise<string> => {
        const result: Rpc = await m.tool("create_project", input);
        expect(result.result).toEqual({ content: [{ type: "text", text: JSON.stringify({ state: "awaiting_confirmation" }) }] });
        const action = (await t.call("getChat")).actions.at(-1)!;
        expect(action.target).toMatchObject({ state: "awaiting_confirmation", settings: input });
        return action.id;
      };
      const answer = (id: string, decision: "approve" | "cancel") =>
        t.call("answerChatProjectCreation", { params: { id }, body: { decision } });
      const cancelled: string = await propose(settings);
      expect(existsSync(t.engine.projectDir("mock-one"))).toBe(false);
      await answer(cancelled, "cancel");
      await expect(answer(cancelled, "approve")).rejects.toThrow("no longer pending");
      expect(existsSync(t.engine.projectDir("mock-one"))).toBe(false);
      const approved: string = await propose(settings);
      expect((await t.call("getChat")).actions.at(-1)?.target).toMatchObject({
        rows: expect.arrayContaining([{ label: "Name", value: "Mock One" }, { label: "Base branch", value: "develop" }]),
      });
      const decisions = await Promise.allSettled([answer(approved, "approve"), answer(approved, "approve")]);
      expect(decisions.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
      expect((await t.call("getProject", { params: { id: "mock-one" } }))).toMatchObject({
        creating: null, errors: [], project: { name: "Mock One", repo: null, baseBranch: "develop", defaultRecipe: "local-only" },
      });
      expect(existsSync(t.engine.projectDir("mock-one-2"))).toBe(false);
      await answer(await propose(settings), "approve");
      expect(existsSync(t.engine.projectDir("mock-one-2"))).toBe(true);
      await t.forge!.createRepo("acme/existing");
      const existing = { mode: "existing", url: "https://github.com/acme/existing.git", account: forgeAccount.id };
      expect((await m.tool("create_project", { ...settings, name: "Existing", repository: existing })).result?.isError).toBe(true);
      expect(existsSync(t.engine.projectDir("existing"))).toBe(false);
      await answer(await propose({ ...settings, name: "Existing", repository: existing, baseBranch: "main", recipes: ["bugfix", "feature"] }), "approve");
      expect(t.engine.project("existing").ctx.project).toMatchObject({ defaultRecipe: "feature", baseBranch: "main", repo: { url: existing.url } });
      const remote = { mode: "new", url: "https://github.com/acme/fresh.git", account: forgeAccount.id };
      const fresh: string = await propose({ ...settings, name: "Fresh", repository: remote, recipes: ["bugfix"] });
      expect(existsSync(t.engine.projectDir("fresh"))).toBe(false);
      await writeFile(join(t.root, "done"), "");
      await until(async () => (await t.call("getChat")).messages.some(({ role, state, text }) =>
        role === "assistant" && state === "completed" && text === "Project settings checked."));
      await answer(fresh, "approve");
      expect((await t.call("getChat")).actions.at(-1)?.target).toMatchObject({ state: "approved", creating: true });
      expect(t.engine.project("fresh").ctx.project).toMatchObject({ createRepo: "github-create-repo", baseBranch: "develop", defaultRecipe: "bugfix" });
      const db = t.engine.project("fresh").ctx.db.db;
      expect(db.prepare("SELECT sha256 FROM confirmed_hashes WHERE path = ?").get("nodes/github-create-repo.json")).toBeDefined();
      expect(db.prepare("SELECT id FROM human_queue WHERE job_id = ? AND kind = 'engine-node'").get("project-setup")).toBeUndefined();
    } finally {
      m.close();
      await writeFile(join(t.root, "done"), "");
      await t.close();
    }
  }, 30_000);

  it("passes no token on the command line, binds create_jobs to the message order, stages recipe changes, caps read_artifact, and stores the reply", async () => {
    const t = await setup((root) => [[
      ...init(),
      { expect: "session/new" },
      { dump: join(root, "session-new.json") },
      { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } },
      { expect: "session/prompt" },
      { waitFile: join(root, "done") },
      ...replyWith("Two jobs created."),
    ]]);
    const { ctx } = t.engine.project("demo");
    const bigJob = await t.engine.createJob("demo", { title: "Big", recipe: "big", ticket: { text: "x" } });
    await until(() => ctx.db.db.prepare("SELECT state FROM jobs WHERE id = ? AND state = 'succeeded'").get(bigJob));
    const bigRun = (ctx.db.db.prepare("SELECT id FROM node_runs WHERE job_id = ?").get(bigJob) as { id: string }).id;

    const message = await t.call("sendChatMessage", { body: { text: "Add an API and a UI job to demo" } });
    await until(() => existsSync(join(t.root, "session-new.json")));
    const servers = (JSON.parse(await readFile(join(t.root, "session-new.json"), "utf8")) as { params: { mcpServers: { args: string[] }[] } }).params.mcpServers;
    expect(servers).toHaveLength(1);
    const tokenFile = servers[0]!.args.at(-1)!;
    expect(tokenFile).toBe(tokenFileOf("assistant"));
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    const credentials = JSON.parse(await readFile(tokenFile, "utf8")) as { url: string; token: string };
    expect(JSON.stringify(servers)).not.toContain(credentials.token);
    expect(credentials.token).not.toBe(t.api.token);
    const wrong = await fetch(credentials.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t.api.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(wrong.status).toBe(401);

    const m = mcp(tokenFile);
    expect((await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).result).toBeDefined();
    expect((await m.rpc("tools/list", {})).result!.tools!.map((x) => x.name)).toEqual(expect.arrayContaining(["create_jobs", "create_project", "list_projects", "read_artifact", "answer_question", "write_instance"]));
    const created = await m.tool("create_jobs", { project: "demo", plan });
    expect(created.error).toBeUndefined();
    expect(created.result!.isError).not.toBe(true);
    await m.tool("create_jobs", { project: "demo", plan: [{ key: "other", title: "Other", ticketText: "x", dependsOn: [] }] });
    expect(ctx.db.db.prepare("SELECT order_key FROM jobs WHERE order_id = ? ORDER BY order_key").all(message.id)).toEqual([{ order_key: "api" }, { order_key: "ui" }]);

    const log = await m.tool("read_artifact", { view: "log", jobId: bigJob, nodeRunId: bigRun });
    const logText = log.result!.content!.map((c) => c.text).join("");
    expect(logText).toContain("END");
    expect(logText).not.toContain("HEAD");
    expect(logText.length).toBeLessThan(210_000);

    const recipeFile = join(t.engine.projectDir("demo"), "recipes", "reviewed.json");
    const before = await readFile(recipeFile, "utf8");
    const changed = JSON.stringify({ ...reviewed, description: "changed by the orchestrator" }, null, 2) + "\n";
    const staged = await m.tool("write_instance", { path: "projects/demo/recipes/reviewed.json", content: changed });
    expect(staged.error).toBeUndefined();
    expect(await readFile(recipeFile, "utf8")).toBe(before);
    const item = await until(() => ctx.db.db.prepare("SELECT id, subject_hash, choices FROM human_queue WHERE kind = 'recipe-change' AND state = 'open'").get() as { id: string; subject_hash: string; choices: string } | undefined);
    m.close();
    const confirm = (JSON.parse(item.choices) as string[]).find((c) => c === "confirm") ?? "confirm";
    await t.call("answerQueue", { params: { id: item.id }, body: { choice: confirm, note: null, hash: item.subject_hash } });
    expect(JSON.parse(await readFile(recipeFile, "utf8"))).toMatchObject({ description: "changed by the orchestrator" });

    await writeFile(join(t.root, "done"), "");
    const detail = await until(async () => {
      const d = await t.call("getChat");
      return d.messages.some((x) => x.role === "assistant" && x.text.includes("Two jobs created.")) && d;
    });
    expect(detail.messages.find((x) => x.id === message.id)?.state).toBe("completed");
    await t.close();
  }, 60000);

  it("marks a turn cut by a restart interrupted, and Retry reruns it with the same order", async () => {
    const t = await setup((root) => [
      [...init(), ...newSession, { expect: "session/prompt" }, { dump: join(root, "first.json") }, { sleep: 60000 }],
      [...init(), { expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }, { expect: "session/prompt" }, { dump: join(root, "retried.json") }, { waitFile: join(root, "done") }, ...replyWith("Retried.")],
    ]);
    const message = await t.call("sendChatMessage", { body: { text: "Add an API and a UI job to demo" } });
    await until(() => existsSync(join(t.root, "first.json")));
    expect((await t.call("getChat")).messages.find((x) => x.id === message.id)?.state).toBe("running");
    await t.close();

    const again = await t.open();
    const interrupted = await again.call("getChat");
    expect(interrupted.messages.find((x) => x.id === message.id)?.state).toBe("interrupted");
    await again.call("retryChatMessage", { params: { id: message.id } });
    await until(() => existsSync(join(t.root, "retried.json")));
    const m = mcp(tokenFileOf("assistant"));
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect((await m.tool("create_jobs", { project: "demo", plan })).error).toBeUndefined();
    m.close();
    const { ctx } = again.engine.project("demo");
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM jobs WHERE order_id = ?").get(message.id)).toEqual({ n: 2 });
    await writeFile(join(t.root, "done"), "");
    await until(async () => (await again.call("getChat")).messages.some((x) => x.role === "assistant" && x.text.includes("Retried.")));
    await again.close();
  }, 60000);

  it("runs the Orchestrator on its own model with limited tools, and notifies the jobs it creates", async () => {
    const t = await setup(() => [init()], { source: true, orchestrator: (root) => [[...init(), ...newSession, { expect: "session/prompt" }, { dump: join(root, "intake.json") }, { waitFile: join(root, "done") }, ...replyWith("Planned.")]] });
    try {
      const system: { kind: string; title: string; body: string }[] = [];
      t.engine.on("notify", (n: { kind: string; title: string; body: string }) => system.push(n));
      const { ctx, executor } = t.engine.project("demo");
      const sourceItem = await until(() => ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = 'source-node'").get() as { id: string; subject_hash: string } | undefined);
      await executor.answer(sourceItem.id, "confirm", null, sourceItem.subject_hash);
      await until(() => existsSync(join(t.root, "intake.json")));
      const m = mcp(tokenFileOf(intakeChat(t)));
      await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect((await m.rpc("tools/list", {})).result!.tools!.map((x) => x.name).sort())
        .toEqual(["comment_ticket", "create_jobs", "job_status", "list_projects", "list_recipes", "read_artifact", "read_replies", "read_ticket"]);
      expect((await m.tool("write_instance", { path: "projects/demo/recipes/reviewed.json", content: "{}" })).result!.isError).toBe(true);
      expect((await m.tool("create_project", { id: "blocked", name: "Blocked" })).result?.isError).toBe(true);
      const fix = [{ key: "fix", title: "Fix login", ticketText: "fix the login button", dependsOn: [] }];
      expect((await m.tool("create_jobs", { project: "demo", plan: fix })).result!.isError).not.toBe(true);
      await m.tool("create_jobs", { project: "demo", plan: fix });
      m.close();
      const jobId: string = (ctx.db.db.prepare("SELECT id FROM jobs WHERE order_key = 'fix'").get() as { id: string }).id;
      const reports = (await t.call("listNotifications")).filter(({ kind }) => kind === "orchestrator");
      expect(reports).toMatchObject([{ title: "Demo, ticket 7", body: "The Orchestrator created the job Fix login.", target: { project: "demo", job: jobId, item: null }, seen: false }]);
      expect(system).toContainEqual({ kind: "orchestrator", title: "Demo, ticket 7", body: "The Orchestrator created the job Fix login." });
      expect((await t.call("getChat")).messages).toEqual([]);
      const open = (): number => (ctx.db.db.prepare("SELECT COUNT(*) AS n FROM human_queue WHERE state = 'open' AND kind != 'agent-question'").get() as { n: number }).n;
      await until(async () => (await t.call("listNotifications")).some(({ kind }) => kind === "needs-user") && open() > 0);
      expect((await t.call("getStatus")).notifications).toBeGreaterThan(open());
      await t.call("markNotificationsSeen");
      expect((await t.call("listNotifications")).every(({ seen }) => seen)).toBe(true);
      expect((await t.call("getStatus")).notifications).toBe(open());
      expect(await readFile(join(t.root, "intake.json"), "utf8")).toContain("PeCore's Orchestrator");
      await writeFile(join(t.root, "done"), "");
    } finally {
      await t.close();
    }
  }, 60000);

  it("compacts an Orchestrator chat with the Orchestrator's own thresholds", async () => {
    const resumed = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
    const t = await setup(() => [init()], {
      source: true,
      compaction: { auto: 500, max: 1000 },
      orchestrator: (root) => [
        [...init(), ...newSession, { expect: "session/prompt" }, usage(1000), ...replyWith("Planned.")],
        [...init(), ...resumed, { expect: "session/prompt" }, { dump: join(root, "compact.json") }, ...replyWith("")],
      ],
    });
    try {
      const { ctx, executor } = t.engine.project("demo");
      const sourceItem = await until(() => ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = 'source-node'").get() as { id: string; subject_hash: string } | undefined);
      await executor.answer(sourceItem.id, "confirm", null, sourceItem.subject_hash);
      await until(() => existsSync(join(t.root, "compact.json")));
      expect((JSON.parse(await readFile(join(t.root, "compact.json"), "utf8")) as { params: { prompt: unknown } }).params.prompt).toEqual([{ type: "text", text: "/compact" }]);
      expect(t.engine.global().settings.assistant.compaction.max).toBe(256_000);
    } finally {
      await t.close();
    }
  }, 60000);

  it("holds a question from the Orchestrator for the user's approval; the Assistant posts the user's order at once", async () => {
    const t = await setup((root) => [
      init(),
      [...init(), ...newSession, { expect: "session/prompt" }, { dump: join(root, "assistant.json") }, { waitFile: join(root, "assistant-done") }, ...replyWith("Posted.")],
    ], { source: true, orchestrator: (root) => [[...init(), ...newSession, { expect: "session/prompt" }, { dump: join(root, "intake.json") }, { waitFile: join(root, "done") }, ...replyWith("Asked.")]] });
    try {
      const comments = join(t.root, "comments");
      const posted = async (): Promise<number> => existsSync(comments) ? (await readFile(comments, "utf8")).trim().split("\n").length : 0;
      const { ctx, executor } = t.engine.project("demo");
      const sourceItem = await until(() => ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = 'source-node'").get() as { id: string; subject_hash: string } | undefined);
      await executor.answer(sourceItem.id, "confirm", null, sourceItem.subject_hash);
      await until(() => existsSync(join(t.root, "intake.json")));
      const m = mcp(tokenFileOf(intakeChat(t)));
      await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      const ask = async (text: string) => {
        const result = await m.tool("comment_ticket", { project: "demo", ticketId: "7", text });
        expect(result.result!.isError).not.toBe(true);
        return (JSON.parse(result.result!.content![0]!.text) as { itemId: string }).itemId;
      };
      const item = (id: string) => ctx.db.db.prepare("SELECT state, choice, subject, subject_hash FROM human_queue WHERE id = ?").get(id) as { state: string; choice: string | null; subject: string; subject_hash: string };
      const first: string = await ask("Which browser?");
      const second: string = await ask("Which browser and version?");
      expect(item(first).state).toBe("cancelled");
      expect(JSON.parse(item(second).subject)).toMatchObject({ ticketId: "7", text: "Which browser and version?" });
      await t.call("answerQueue", { params: { id: second }, body: { choice: "reject", note: null, hash: item(second).subject_hash } });
      expect(item(second)).toMatchObject({ state: "resolved", choice: "reject" });
      expect(await posted()).toBe(0);
      const third: string = await ask("Which page?");
      expect(await posted()).toBe(0);
      await t.call("answerQueue", { params: { id: third }, body: { choice: "post", note: null, hash: item(third).subject_hash } });
      expect(item(third)).toMatchObject({ state: "resolved", choice: "post" });
      expect(await posted()).toBe(1);
      const orderId = (ctx.db.db.prepare("SELECT order_id FROM tickets_seen WHERE ticket_id = '7'").get() as { order_id: string }).order_id;
      expect(ctx.db.orderEvents(orderId).filter(({ type }) => type === "order.asked")).toHaveLength(1);
      m.close();
      await writeFile(join(t.root, "done"), "");

      const reports = (await t.call("listNotifications")).filter(({ kind }) => kind === "orchestrator");
      expect(reports.map(({ body, target }) => [body, target?.item])).toEqual([third, second, first].map((id) => ["The Orchestrator wants to post a question on the ticket.", id]));
      expect((await t.call("getChat")).supportsImages).toBe(false);
      await t.call("sendChatMessage", { body: { text: "Ask on ticket 7 which page it is" } });
      await until(() => existsSync(join(t.root, "assistant.json")));
      const own = mcp(tokenFileOf("assistant"));
      await own.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
      expect((await own.tool("comment_ticket", { project: "demo", ticketId: "7", text: "Which page?" })).result!.isError).not.toBe(true);
      own.close();
      expect(await posted()).toBe(2);
      expect(ctx.db.db.prepare("SELECT count(*) AS n FROM human_queue WHERE kind = 'outbound' AND state = 'open'").get()).toEqual({ n: 0 });
      await writeFile(join(t.root, "assistant-done"), "");
    } finally {
      await t.close();
    }
  }, 60000);

  it("hands a trusted ticket to the project's intake chat as untrusted data; create_jobs uses the ticket order", async () => {
    const t = await setup((root) => [[...init(), ...newSession, { expect: "session/prompt" }, { dump: join(root, "prompt.json") }, { waitFile: join(root, "done") }, ...replyWith("Planned.")]], { source: true });
    const { ctx, executor } = t.engine.project("demo");
    const sourceItem = await until(() => ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = 'source-node'").get() as { id: string; subject_hash: string } | undefined);
    await executor.answer(sourceItem.id, "confirm", null, sourceItem.subject_hash);
    await until(() => existsSync(join(t.root, "prompt.json")));
    const promptText = JSON.stringify(JSON.parse(await readFile(join(t.root, "prompt.json"), "utf8")));
    expect(promptText).toContain("the login button does nothing");
    expect(promptText.toLowerCase()).toContain("untrusted");
    const orderId = (ctx.db.db.prepare("SELECT order_id FROM tickets_seen WHERE ticket_id = '7'").get() as { order_id: string }).order_id;
    const m = mcp(tokenFileOf(intakeChat(t)));
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect((await m.tool("create_jobs", { project: "demo", plan: [{ key: "fix", title: "Fix login", ticketText: "fix the login button", dependsOn: [] }] })).error).toBeUndefined();
    m.close();
    expect(ctx.db.db.prepare("SELECT order_key FROM jobs WHERE order_id = ?").all(orderId)).toEqual([{ order_key: "fix" }]);
    expect(ctx.db.db.prepare("SELECT state FROM tickets_seen WHERE order_id = ?").get(orderId)).toEqual({ state: "done" });
    await writeFile(join(t.root, "done"), "");
    await t.close();
  }, 60000);

  it("sends an image attachment as an ACP image block when the connector supports images", async () => {
    const t = await setup((root) => [
      [...init(true)],
      [...init(true), ...newSession, { expect: "session/prompt" }, { dump: join(root, "prompt.json") }, ...replyWith("Seen.")],
    ]);
    const attachment = await t.call("uploadChatAttachment", { body: { mime: "image/png", data: png } });
    await t.call("sendChatMessage", { body: { text: "This is the bug", attachmentIds: [attachment.id] } });
    await until(() => existsSync(join(t.root, "prompt.json")));
    const prompt = (JSON.parse(await readFile(join(t.root, "prompt.json"), "utf8")) as { params: { prompt: { type: string; mimeType?: string; data?: string }[] } }).params.prompt;
    expect(prompt).toContainEqual(expect.objectContaining({ type: "image", mimeType: "image/png", data: png }));
    await t.close();
  }, 60000);

  it("refuses an image when the connector does not support images", async () => {
    const t = await setup(() => [[...init(false)], [...init(false)], [...init(false)]]);
    const refused = async () => {
      const attachment = await t.call("uploadChatAttachment", { body: { mime: "image/png", data: png } });
      await t.call("sendChatMessage", { body: { text: "This is the bug", attachmentIds: [attachment.id] } });
    };
    await expect(refused()).rejects.toMatchObject({ status: expect.any(Number) });
    await t.close();
  }, 60000);
});
