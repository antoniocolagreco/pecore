import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { apiClient } from "@pecore/schemas";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";

const fakeAgent = fileURLToPath(new URL("../../../agents/test/fake-agent/agent.mjs", import.meta.url));
const shim = fileURLToPath(new URL("../../../agents/scripts/orchestrator-mcp.mjs", import.meta.url));
const realHome = process.env.HOME;
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

type Rpc = { id: number; result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function setup(build: (root: string) => object[][], extra: { source?: boolean } = {}) {
  const root = await tempDir();
  const scripts: object[][] = build(root);
  process.env.HOME = join(root, "user");
  await mkdir(process.env.HOME);
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
  await writeFile(join(connectors, "fake.json"), JSON.stringify({ name: "fake", title: "Fake", kind: "native", harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" }, command: ["{harnessPath}", fakeAgent], env: { FAKE_AGENT_SCRIPT: files.join(",") }, reader: "claude-code" }));
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" }] }));
  await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p1", account: "fake", model: "m1" }] }));
  await writeFile(join(home, "tiers.json"), JSON.stringify({ tiers: { strong: ["p1"] } }));
  await writeFile(join(home, "settings.json"), JSON.stringify({ orchestrator: { profile: "p1" } }));
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
    await writeFile(join(dir, "nodes", "fake-source.json"), JSON.stringify(fakeSource));
    const project = JSON.parse(await readFile(join(dir, "project.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(dir, "project.json"), JSON.stringify({ ...project, source: { node: "fake-source", params: { trusted: ["alice"] } } }));
    expect(await first.engine.reloadProject("demo")).toEqual([]);
  }
  return { root, open, ...first };
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
const plan = [
  { key: "api", title: "API", ticketText: "add the endpoint", dependsOn: [] },
  { key: "ui", title: "UI", ticketText: "add the screen", dependsOn: ["api"] },
];

afterEach(() => {
  process.env.HOME = realHome;
});

describe("orchestrator chat with the MCP shim (section 6, Phase 6 decisions 1, 3 and 4)", () => {
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

    const chat = await t.call("createChat", { body: { title: "Orders" } });
    const message = await t.call("sendChatMessage", { params: { id: chat.id }, body: { text: "Add an API and a UI job to demo" } });
    await until(() => existsSync(join(t.root, "session-new.json")));
    const servers = (JSON.parse(await readFile(join(t.root, "session-new.json"), "utf8")) as { params: { mcpServers: { args: string[] }[] } }).params.mcpServers;
    expect(servers).toHaveLength(1);
    const tokenFile = servers[0]!.args.at(-1)!;
    expect(tokenFile).toBe(tokenFileOf(chat.id));
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    const credentials = JSON.parse(await readFile(tokenFile, "utf8")) as { url: string; token: string };
    expect(JSON.stringify(servers)).not.toContain(credentials.token);
    expect(credentials.token).not.toBe(t.api.token);
    const wrong = await fetch(credentials.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t.api.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(wrong.status).toBe(401);

    const m = mcp(tokenFile);
    expect((await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).result).toBeDefined();
    expect((await m.rpc("tools/list", {})).result!.tools!.map((x) => x.name)).toEqual(expect.arrayContaining(["create_jobs", "list_projects", "read_artifact", "answer_question", "write_instance"]));
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
      const d = await t.call("getChat", { params: { id: chat.id } });
      return d.messages.some((x) => x.role === "assistant" && x.text.includes("Two jobs created.")) && d;
    });
    expect(detail.messages.find((x) => x.id === message.id)?.state).toBe("completed");
    await t.close();
  }, 60000);

  it("marks a turn cut by a restart interrupted, and Retry reruns it with the same order", async () => {
    const t = await setup((root) => [
      [...init(), ...newSession, { expect: "session/prompt" }, { sleep: 60000 }],
      [...init(), { expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }, { expect: "session/prompt" }, { dump: join(root, "retried.json") }, { waitFile: join(root, "done") }, ...replyWith("Retried.")],
    ]);
    const chat = await t.call("createChat", { body: { title: "Orders" } });
    const message = await t.call("sendChatMessage", { params: { id: chat.id }, body: { text: "Add an API and a UI job to demo" } });
    await until(async () => (await t.call("getChat", { params: { id: chat.id } })).messages.find((x) => x.id === message.id)?.state === "running");
    await t.close();

    const again = await t.open();
    const interrupted = await again.call("getChat", { params: { id: chat.id } });
    expect(interrupted.messages.find((x) => x.id === message.id)?.state).toBe("interrupted");
    await again.call("retryChatMessage", { params: { id: chat.id, messageId: message.id } });
    await until(() => existsSync(join(t.root, "retried.json")));
    const m = mcp(tokenFileOf(chat.id));
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect((await m.tool("create_jobs", { project: "demo", plan })).error).toBeUndefined();
    m.close();
    const { ctx } = again.engine.project("demo");
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM jobs WHERE order_id = ?").get(message.id)).toEqual({ n: 2 });
    await writeFile(join(t.root, "done"), "");
    await until(async () => (await again.call("getChat", { params: { id: chat.id } })).messages.some((x) => x.role === "assistant" && x.text.includes("Retried.")));
    await again.close();
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
    const chats = await t.call("listChats");
    const intake = chats.find((c) => existsSync(tokenFileOf(c.id)))!;
    const m = mcp(tokenFileOf(intake.id));
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
    const chat = await t.call("createChat", { body: { title: "Bug" } });
    const attachment = await t.call("uploadChatAttachment", { params: { id: chat.id }, body: { mime: "image/png", data: png } });
    await t.call("sendChatMessage", { params: { id: chat.id }, body: { text: "This is the bug", attachmentIds: [attachment.id] } });
    await until(() => existsSync(join(t.root, "prompt.json")));
    const prompt = (JSON.parse(await readFile(join(t.root, "prompt.json"), "utf8")) as { params: { prompt: { type: string; mimeType?: string; data?: string }[] } }).params.prompt;
    expect(prompt).toContainEqual(expect.objectContaining({ type: "image", mimeType: "image/png", data: png }));
    await t.close();
  }, 60000);

  it("refuses an image when the connector does not support images", async () => {
    const t = await setup(() => [[...init(false)], [...init(false)], [...init(false)]]);
    const chat = await t.call("createChat", { body: { title: "Bug" } });
    const refused = async () => {
      const attachment = await t.call("uploadChatAttachment", { params: { id: chat.id }, body: { mime: "image/png", data: png } });
      await t.call("sendChatMessage", { params: { id: chat.id }, body: { text: "This is the bug", attachmentIds: [attachment.id] } });
    };
    await expect(refused()).rejects.toMatchObject({ status: expect.any(Number) });
    await t.close();
  }, 60000);
});
