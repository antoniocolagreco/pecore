import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { atlassianAccount, linearAccount } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { tempDir } from "../../test/tmp";
import { callProjectTracker, NodeProposal, runApprovedNode } from "./node-tools";
import type { Engine } from "../main";

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

async function serviceAccount(engine: Engine): Promise<void> {
  const accounts = engine.global().accounts.accounts;
  engine.configuration.write({ accounts: { accounts: [...accounts, atlassianAccount] } });
  await engine.reloadGlobal();
}

it("uses Jira from chat, confirms writes and rejects an approval after the account changes", async () => {
  const bridge = await fakeBridge();
  const { engine, close } = await apiProject();
  try {
    await serviceAccount(engine);
    const { ctx } = engine.project("demo");
    ctx.project = { ...ctx.project, tracker: { provider: "jira", account: atlassianAccount.id } };
    const input = { ticketId: "TST-7", site: "site-two" };
    await expect(callProjectTracker(engine, "demo", "read_ticket", input)).rejects.toThrow("Sign in to Atlassian");
    await writeFile(bridge.expired, "yes");
    expect(await engine.startAccountLogin("atlassian")).toBe("tool:atlassian");
    await expect.poll(() => engine.recheckAccount("atlassian")).toBe("logged_in");
    expect((await callProjectTracker(engine, "demo", "read_ticket", input)).value).toEqual({ untrusted: true, ticket: { site: "site-two", key: "TST-7" } });
    const snapshot = engine.global();
    vi.spyOn(engine, "global").mockReturnValue({ ...snapshot, settings: { ...snapshot.settings, protectedMode: true } });
    try {
      const before: string = await readFile(bridge.calls, "utf8");
      const proposed = await callProjectTracker(engine, "demo", "comment_ticket", { ...input, text: "Ship it" });
      expect(proposed.value).toEqual({ state: "awaiting_answer" });
      expect(await readFile(bridge.calls, "utf8")).toBe(before);
      const approval = NodeProposal.parse("nodeProposal" in proposed.target ? proposed.target.nodeProposal : null);
      await runApprovedNode(engine, approval);
      expect(await readFile(bridge.calls, "utf8")).toContain('"commentBody":"Ship it"');
      ctx.serviceAccount = (id) => id === linearAccount.id ? linearAccount : undefined;
      ctx.project = { ...ctx.project, tracker: { provider: "linear", account: linearAccount.id } };
      await expect(runApprovedNode(engine, approval)).rejects.toThrow("account or ticket target changed");
      await callProjectTracker(engine, "demo", "search_tickets", { query: "login" });
      expect(await readFile(bridge.calls, "utf8")).toContain('"name":"list_issues","arguments":{"query":"login","limit":30}');
    } finally {
      vi.restoreAllMocks();
    }
  } finally {
    await close();
  }
});
