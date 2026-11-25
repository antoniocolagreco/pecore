import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atlassianAccount, Node, Recipe } from "@pecore/schemas";
import type { McpTrackerNode, Node as NodeType } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { tempDir } from "../../test/tmp";
import { callNodeTool, listNodeTools, NodeProposal, runApprovedNode } from "../chat/node-tools";
import type { Engine } from "../main";
import { appUser } from "./process";
import { trackerMcpArguments } from "./tracker-mcp";

afterEach(() => vi.unstubAllEnvs());

async function fakeBridge() {
  const bin: string = await tempDir();
  const calls: string = join(bin, "calls");
  const authorized: string = join(bin, "authorized");
  const expired: string = join(bin, "expired");
  const script: string = [
    "#!/usr/bin/env node",
    'const { appendFileSync, existsSync, rmSync, writeFileSync } = require("node:fs");',
    'const { createInterface } = require("node:readline");',
    "const calls = " + JSON.stringify(calls) + ";",
    "const authorized = " + JSON.stringify(authorized) + ";",
    "const expired = " + JSON.stringify(expired) + ";",
    'const interactive = process.argv.includes("180");',
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    "  const req = JSON.parse(line);",
    "  if (req.id === undefined) return;",
    "  let result;",
    '  if (req.method === "initialize") {',
    '    if (!existsSync(authorized) && interactive) writeFileSync(authorized, "yes");',
    '    if (!existsSync(authorized)) { console.error("Please authorize this client by visiting:"); return; }',
    '    result = { protocolVersion: "2025-11-25" };',
    "  } else {",
    '    appendFileSync(calls, JSON.stringify(req.params) + "\\n");',
    '    if (interactive) rmSync(expired, { force: true });',
    '    result = existsSync(expired) ? { isError: true, content: [{ type: "text", text: "401 Unauthorized" }] } : req.params.name === "forbidden" ? { isError: true, content: [{ type: "text", text: "Permission denied" }] }',
    '      : { structuredContent: { site: req.params.arguments.cloudId ?? null, key: req.params.arguments.issueIdOrKey ?? null } };',
    "  }",
    '  console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));',
    "});",
  ].join("\n");
  await writeFile(join(bin, "mcp-remote"), script, { mode: 0o700 });
  vi.stubEnv("PATH", bin + ":" + process.env.PATH);
  return { calls, authorized, expired };
}

function fixture(): McpTrackerNode {
  const node: NodeType = Node.parse({
    kind: "tracker", mode: "mcp", provider: "jira", name: "read-jira-mcp", description: "Read Jira", account: "atlassian",
    server: "atlassian", tool: "getJiraIssue", arguments: { cloudId: "{params.site}", issueIdOrKey: "{ticket.id}" }, readOnly: true,
    params: { type: "object", properties: { site: { type: "string", default: "site-one" } } }, outcomes: ["done"],
    outcomeRules: [{ exitCode: 0, outcome: "done" }], outputs: { done: "document" },
  });
  if (node.kind !== "tracker" || node.mode !== "mcp") throw new Error("Expected an MCP Tracker");
  return node;
}

async function serviceAccount(engine: Engine): Promise<void> {
  const accounts = engine.global().accounts.accounts;
  engine.configuration.write({ accounts: { accounts: [...accounts, atlassianAccount] } });
  await engine.reloadGlobal();
}

it("expands arguments from inputs without converting their types", () => {
  const node: McpTrackerNode = { ...fixture(), arguments: { fields: ["{inputs.document.body}", "{params.count}"], ticket: "{ticket.id}" } };
  expect(trackerMcpArguments(node, {
    params: { count: 12 }, inputs: [{ type: "document", content: '{"body":"with quotes"}' }],
    context: { ticketId: "https://site.atlassian.net/browse/TST-1", project: { repoDir: "", repoUrl: null, baseBranch: "main" } },
  })).toEqual({ fields: ["with quotes", 12], ticket: "TST-1" });
});

it("waits on expired OAuth, releases the job after login, and maps the tool output", async () => {
  const bridge = await fakeBridge();
  const { engine, close } = await apiProject();
  try {
    await serviceAccount(engine);
    await writeFile(bridge.authorized, "yes");
    await writeFile(bridge.expired, "yes");
    const { ctx, executor } = engine.project("demo");
    const node: McpTrackerNode = fixture();
    const recipe: Recipe = Recipe.parse({
      name: "jira-read", description: "Read the ticket", start: "read",
      nodes: { read: { use: node.name } }, successOutcomes: ["read:done"],
    });
    ctx.defs.nodes.set(node.name, node);
    ctx.defs.recipes.set(recipe.name, recipe);
    const job: string = await engine.createJob("demo", { title: "Read", ticket: { text: "Read", id: "TST-42" }, recipe: recipe.name });
    await expect.poll(() => executor.job(job).waiting_reason).toBe("auth");
    expect(ctx.db.events(job).some((event) => event.type === "node_run.state_changed" &&
      "auth" in event.payload && event.payload.auth?.account === "atlassian" && event.payload.auth.osUser === appUser)).toBe(true);
    expect(engine.notifications().some((notification) => notification.kind === "login")).toBe(true);
    expect((await readFile(bridge.calls, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(await engine.startAccountLogin("atlassian")).toBe("tool:atlassian");
    await expect.poll(() => executor.job(job).state).toBe("succeeded");
    const artifact = executor.artifacts(job).find(({ type, name }) => type === "document" && name !== "ticket.json")!;
    expect(JSON.parse(ctx.db.requireArtifact(artifact).toString())).toMatchObject({ body: '{"site":"site-one","key":"TST-42"}' });
    expect(await engine.recheckAccount("atlassian")).toBe("logged_in");
  } finally {
    await close();
  }
});

it("uses MCP from chat, binds writes to confirmation and invalidates authorization on argument changes", async () => {
  const bridge = await fakeBridge();
  const { engine, close } = await apiProject();
  try {
    await serviceAccount(engine);
    const node: McpTrackerNode = fixture();
    const params = { ticketId: "TST-7", params: { site: "site-two" } };
    engine.catalog.saveNode(node);
    await expect(callNodeTool(engine, "demo", node.name, params)).rejects.toThrow("Sign in to Atlassian");
    await writeFile(bridge.authorized, "yes");
    expect((await callNodeTool(engine, "demo", node.name, params)).value).toEqual([
      { type: "document", content: { title: node.name, body: '{"site":"site-two","key":"TST-7"}' } },
    ]);
    const snapshot = engine.global();
    vi.spyOn(engine, "global").mockReturnValue({ ...snapshot, settings: { ...snapshot.settings, protectedMode: true } });
    try {
      const tools = () => listNodeTools(engine, "demo").map(({ name }) => name);
      expect(tools()).not.toContain("node_" + node.name);
      expect(engine.catalog.approveChatNode(node.name, engine.catalog.chatNode(node.name)!.hash)).toBe(true);
      expect(tools()).toContain("node_" + node.name);
      const changed: McpTrackerNode = { ...node, arguments: { ...node.arguments, commentBody: "Ship it" } };
      engine.catalog.saveNode(changed);
      await expect(callNodeTool(engine, "demo", node.name, params)).rejects.toThrow("needs approval");
      engine.catalog.saveNode({ ...changed, readOnly: undefined });
      expect(engine.catalog.approveChatNode(node.name, engine.catalog.chatNode(node.name)!.hash)).toBe(true);
      const before: string = await readFile(bridge.calls, "utf8");
      const proposed = await callNodeTool(engine, "demo", node.name, params);
      expect(proposed.value).toEqual({ state: "awaiting_answer" });
      expect(await readFile(bridge.calls, "utf8")).toBe(before);
      const approval = NodeProposal.parse("nodeProposal" in proposed.target ? proposed.target.nodeProposal : null);
      await runApprovedNode(engine, approval);
      expect(await readFile(bridge.calls, "utf8")).toContain('"commentBody":"Ship it"');
      engine.catalog.saveNode({ ...node, readOnly: true, tool: "forbidden" });
      await expect(runApprovedNode(engine, approval)).rejects.toThrow("needs approval");
      expect(engine.catalog.approveChatNode(node.name, engine.catalog.chatNode(node.name)!.hash)).toBe(true);
      await expect(callNodeTool(engine, "demo", node.name, params)).rejects.toThrow("could not run");
    } finally {
      vi.restoreAllMocks();
    }
  } finally {
    await close();
  }
});
