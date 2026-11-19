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

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(() => {
  process.env.HOME = realHome;
});

describe("orchestrator chat with the MCP shim (section 6, Phase 6 decisions 1 and 4)", () => {
  it("passes no token on the command line, reads it from a 0600 file, binds create_jobs to the message order, and stores the reply", async () => {
    const root = await tempDir();
    process.env.HOME = join(root, "user");
    await mkdir(process.env.HOME);
    const home = join(root, "home");
    const library = join(root, "library");
    await cp(shippedLibrary, library, { recursive: true });
    await writeFile(join(library, "nodes", "write-hello.json"), JSON.stringify(writeHello));
    await writeFile(join(library, "recipes", "reviewed.json"), JSON.stringify(reviewed));
    const dump = join(root, "session-new.json");
    const done = join(root, "turn-done");
    const reply = { send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Two jobs created." } } } } };
    const script = [
      { expect: "initialize" },
      { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } } } } },
      { expect: "session/new" },
      { dump },
      { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } },
      { expect: "session/prompt" },
      { waitFile: done },
      reply,
      { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn" } } },
    ];
    const scriptFile = join(root, "script.jsonl");
    await writeFile(scriptFile, script.map((s) => JSON.stringify(s)).join("\n") + "\n");
    const connectors = join(root, "connectors");
    await mkdir(connectors);
    await writeFile(join(connectors, "fake.json"), JSON.stringify({ name: "fake", title: "Fake", kind: "native", harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" }, command: ["{harnessPath}", fakeAgent], env: { FAKE_AGENT_SCRIPT: scriptFile }, reader: "claude-code" }));
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" }] }));
    await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p1", account: "fake", model: "m1" }] }));
    await writeFile(join(home, "tiers.json"), JSON.stringify({ tiers: { strong: ["p1"] } }));
    await writeFile(join(home, "settings.json"), JSON.stringify({ orchestrator: { profile: "p1" } }));
    const engine = await Engine.start({ home, library, agents: { connectorsDir: connectors, adaptersDir: join(root, "adapters"), adapters: {} }, checkLogins: false });
    await engine.createProject({ id: "demo", name: "Demo", repo: null, defaultRecipe: "reviewed" }, ["reviewed"]);
    const api = await startApi(engine, { handlers: handlers("0.0.0-test"), validateResponses: true });
    const call = apiClient({ port: api.port, token: api.token });

    const chat = await call("createChat", { body: { title: "Orders" } });
    const message = await call("sendChatMessage", { params: { id: chat.id }, body: { text: "Add an API and a UI job to demo" } });
    await until(() => existsSync(dump));
    const servers = (JSON.parse(await readFile(dump, "utf8")) as { params: { mcpServers: { command: string; args: string[]; env: unknown[] }[] } }).params.mcpServers;
    expect(servers).toHaveLength(1);
    const tokenFile = servers[0]!.args.at(-1)!;
    expect(tokenFile).toBe(join(process.env.HOME, ".pecore-chats", chat.id, "mcp-token"));
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    const credentials = JSON.parse(await readFile(tokenFile, "utf8")) as { url: string; token: string };
    expect(JSON.stringify(servers)).not.toContain(credentials.token);
    expect(credentials.token).not.toBe(api.token);

    const wrong = await fetch(credentials.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${api.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(wrong.status).toBe(401);

    const child = spawn(process.execPath, [shim, tokenFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
    const rpc = async (id: number, method: string, params: unknown) => {
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return JSON.parse((await lines.next()).value as string) as { id: number; result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };
    };
    expect((await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } })).result).toBeDefined();
    const listed = await rpc(2, "tools/list", {});
    expect(listed.result!.tools!.map((t) => t.name)).toEqual(expect.arrayContaining(["create_jobs", "list_projects", "read_artifact", "answer_question"]));
    const plan = [
      { key: "api", title: "API", ticketText: "add the endpoint", dependsOn: [] },
      { key: "ui", title: "UI", ticketText: "add the screen", dependsOn: ["api"] },
    ];
    const created = await rpc(3, "tools/call", { name: "create_jobs", arguments: { project: "demo", plan } });
    expect(created.error).toBeUndefined();
    expect(created.result!.isError).not.toBe(true);
    await rpc(4, "tools/call", { name: "create_jobs", arguments: { project: "demo", plan: [{ key: "other", title: "Other", ticketText: "x", dependsOn: [] }] } });
    child.stdin!.end();
    const { ctx } = engine.project("demo");
    expect(ctx.db.db.prepare("SELECT order_key FROM jobs WHERE order_id = ? ORDER BY order_key").all(message.id)).toEqual([{ order_key: "api" }, { order_key: "ui" }]);

    await writeFile(done, "");
    const detail = await until(async () => {
      const d = await call("getChat", { params: { id: chat.id } });
      return d.messages.some((m) => m.role === "assistant" && m.text.includes("Two jobs created.")) && d;
    });
    expect(detail.messages.find((m) => m.id === message.id)?.state).toBe("completed");
    await api.close();
    await engine.shutdown();
  }, 40000);
});
