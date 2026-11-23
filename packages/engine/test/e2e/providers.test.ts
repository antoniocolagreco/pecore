import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/main";
import { gitApp } from "../../src/workdir/git-as";
import { createProjectWithRecipes } from "../project";
import { shippedTemplates, tempDir } from "../tmp";

const real = process.env.PECORE_REAL === "1";
const agentsRoot = fileURLToPath(new URL("../../../agents/", import.meta.url));
const connectorsDir = fileURLToPath(new URL("../../../app/resources/connectors/", import.meta.url));
const accounts = [
  { id: "codex", kind: "model", provider: "openai", connector: "codex", login: "subscription" },
  { id: "opencode", kind: "model", provider: "deepseek", connector: "opencode", login: "subscription" },
];

async function start() {
  const home = join(await tempDir(), "home");
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts }));
  const adapters = (await import(join(agentsRoot, "adapters.json"), { with: { type: "json" } })).default as { adapters: Record<string, { version: string; entry: string }> };
  return Engine.start({ home, templates: shippedTemplates, agents: { connectorsDir, adaptersDir: join(agentsRoot, "out", "adapters"), adapters: adapters.adapters }, checkLogins: false });
}

describe.skipIf(!real)("phase 6 gate: Codex and opencode connectors with the user's existing logins", () => {
  it("checks both logins and lists their models", async () => {
    const engine = await start();
    for (const view of await engine.loginViews()) await engine.recheckLogin(view.id);
    const views = await engine.loginViews();
    console.log(JSON.stringify(views.map((v) => ({ account: v.account, state: v.state, plan: v.plan, hasEmail: v.email !== null }))));
    expect(views.find((v) => v.account === "codex")).toMatchObject({ state: "logged_in", email: expect.any(String) });
    expect(views.find((v) => v.account === "opencode")).toMatchObject({ state: "logged_in", email: null });
    expect((await engine.accountOptions("codex"))?.models).toContain("gpt-6.2-sol");
    expect((await engine.accountOptions("opencode"))?.models).toContain("opencode/deepseek-v4.1-flash-free");
    await engine.shutdown();
  }, 300_000);

  for (const [account, model, effort] of [["codex", "gpt-6.2-sol", "low"], ["opencode", "opencode/deepseek-v4.1-flash-free", null]] as const) {
    it(`runs one agent node through ${account} to its outcome, with tokens recorded`, async () => {
      const root = await tempDir();
      const templates = join(root, "templates");
      await cp(shippedTemplates, templates, { recursive: true });
      await writeFile(join(templates, "nodes", "agent-x.json"), JSON.stringify({
        name: "agent-x",
        description: "writes done.txt",
        kind: "agent",
        prompt: "agent-x.md",
        agent: { profiles: ["p"] },
        inputs: ["ticket"],
        outcomes: ["done"],
        changesFiles: true,
        timeoutSec: 600,
        outputSchema: { type: "object", required: ["outcome"], properties: { outcome: { enum: ["done"] } } },
      }));
      await writeFile(join(templates, "nodes", "agent-x.md"), "Create the file done.txt containing the single word ok. Do nothing else.\n");
      await writeFile(join(templates, "recipes", "one-agent.json"), JSON.stringify({ name: "one-agent", description: "one agent", start: "x", successOutcomes: ["x:done"], nodes: { x: { use: "agent-x" } }, edges: [] }));
      const home = join(root, "home");
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts }));
      await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p", account, model, ...(effort ? { effort } : {}) }] }));
      const adapters = (await import(join(agentsRoot, "adapters.json"), { with: { type: "json" } })).default as { adapters: Record<string, { version: string; entry: string }> };
      const engine = await Engine.start({ home, templates, agents: { connectorsDir, adaptersDir: join(agentsRoot, "out", "adapters"), adapters: adapters.adapters }, checkLogins: false });
      await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["one-agent"]);
      const p = engine.project("demo");
      const id = await engine.createJob("demo", { title: "Write done", ticket: { text: "write done.txt" } });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = p.executor.job(id);
        if (["succeeded", "failed", "not_delivered", "stopped"].includes(j.state) || (j.state === "waiting" && j.waiting_reason !== "concurrency")) break;
      }
      const j = p.executor.job(id);
      const attempt = p.ctx.db.db.prepare("SELECT model, tokens_in, tokens_out, cache_read, cost, end_reason FROM attempts").get() as { model: string | null; tokens_in: number; tokens_out: number };
      console.log(account, j.state, j.failure_reason, j.waiting_reason, JSON.stringify(attempt));
      expect(j.state).toBe("succeeded");
      expect(attempt.tokens_out).toBeGreaterThan(0);
      const run = p.ctx.db.db.prepare("SELECT content_before, content_after FROM node_runs WHERE job_id = ?").get(id) as { content_before: string; content_after: string };
      expect(run.content_after).not.toBe(run.content_before);
      await engine.shutdown();
    }, 900_000);
  }

  for (const [account, model, effort] of [["codex", "gpt-6.2-sol", "medium"], ["opencode", "openrouter/deepseek/deepseek-v4.1-flash", null]] as const) {
    it(`runs the local-only recipe (spec, tests, code, checks, review, approval, commit) with every agent node on ${account}`, async () => {
      const home = join(await tempDir(), "home");
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts }));
      await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p", account, model, ...(effort ? { effort } : {}) }] }));
      await writeFile(join(home, "tiers.json"), JSON.stringify({ tiers: { frontier: ["p"], strong: ["p"], standard: ["p"], cheap: ["p"] } }));
      const adapters = (await import(join(agentsRoot, "adapters.json"), { with: { type: "json" } })).default as { adapters: Record<string, { version: string; entry: string }> };
      const engine = await Engine.start({ home, templates: shippedTemplates, agents: { connectorsDir, adaptersDir: join(agentsRoot, "out", "adapters"), adapters: adapters.adapters }, checkLogins: false });
      await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["feature-to-local-commit"]);
      const p = engine.project("demo");
      const id = await engine.createJob("demo", {
        title: "Add a sum function",
        ticket: { text: "Create src/math.ts exporting `sum(a: number, b: number): number` that returns a + b. Add Vitest tests for it. The repository is empty: set up a minimal TypeScript project." },
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = p.executor.job(id);
        if (j.state === "waiting" && j.waiting_reason === "human") {
          const item = p.ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = 'human-node'").get() as { id: string; subject_hash: string };
          await p.executor.answer(item.id, "approve", null, item.subject_hash);
          continue;
        }
        if (["succeeded", "failed", "not_delivered", "stopped"].includes(j.state) || (j.state === "waiting" && j.waiting_reason !== "concurrency")) break;
      }
      const j = p.executor.job(id);
      console.log(account, "FINAL", j.state, j.failure_reason, j.waiting_reason);
      console.log(p.ctx.db.db.prepare("SELECT n.node, n.outcome, n.failure_reason, a.model, a.tokens_in, a.tokens_out FROM node_runs n LEFT JOIN attempts a ON a.node_run_id = n.id ORDER BY n.rowid").all());
      expect(j.state).toBe("succeeded");
      const agents = p.ctx.db.db.prepare("SELECT DISTINCT n.node FROM node_runs n JOIN attempts a ON a.node_run_id = n.id WHERE a.tokens_out > 0").pluck().all();
      expect(agents).toEqual(expect.arrayContaining(["spec", "tests", "code", "review", "approve"]));
      expect(await gitApp(join(p.ctx.dir, "repo.git"), ["ls-tree", "-r", "--name-only", `factory/${id}`])).toContain("src/math.ts");
      await engine.shutdown();
    }, 3_600_000);
  }
});
