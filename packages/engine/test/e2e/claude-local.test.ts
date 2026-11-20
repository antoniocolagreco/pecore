import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gitApp } from "../../src/workdir/git-as";
import { Engine } from "../../src/main";
import { createProjectWithRecipes } from "../project";
import { shippedLibrary, tempDir } from "../tmp";

const real = process.env.PECORE_REAL === "1";
const agentsRoot = fileURLToPath(new URL("../../../agents/", import.meta.url));
const connectorsDir = fileURLToPath(new URL("../../../app/resources/connectors/", import.meta.url));

describe.skipIf(!real)("phase 3 gate: local-only job with Claude Code, normal mode, existing login", () => {
  it("runs to its commit", async () => {
    const home = join(await tempDir(), "home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ id: "claude", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" }] }));
    await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "sonnet", account: "claude", model: "sonnet", effort: "medium" }] }));
    await writeFile(join(home, "tiers.json"), JSON.stringify({ tiers: { frontier: ["sonnet"], strong: ["sonnet"], standard: ["sonnet"], cheap: ["sonnet"] } }));
    const adapters = (await import(join(agentsRoot, "adapters.json"), { with: { type: "json" } })).default as { adapters: Record<string, { version: string; entry: string }> };
    const engine = await Engine.start({ home, library: shippedLibrary, agents: { connectorsDir, adaptersDir: join(agentsRoot, "out", "adapters"), adapters: adapters.adapters } });
    engine.on("job", ({ jobId }) => {
      const j = engine.project("demo").executor.job(jobId);
      const run = engine.project("demo").ctx.db.db.prepare("SELECT node, state, outcome, failure_reason FROM node_runs ORDER BY rowid DESC LIMIT 1").get();
      console.log(new Date().toISOString(), j.state, j.waiting_reason ?? "", JSON.stringify(run));
    });
    await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["local-only"]);
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
      if (["succeeded", "failed", "not_delivered", "stopped"].includes(j.state) || (j.state === "waiting" && j.waiting_reason !== "human" && j.waiting_reason !== "concurrency")) break;
    }
    const j = p.executor.job(id);
    console.log("FINAL", j.state, j.failure_reason, j.waiting_reason);
    console.log(p.ctx.db.db.prepare("SELECT n.node, n.outcome, n.failure_reason, a.profile, a.model, a.tokens_in, a.tokens_out, a.cache_read, a.cache_write, a.cost FROM node_runs n LEFT JOIN attempts a ON a.node_run_id = n.id ORDER BY n.rowid").all());
    expect(j.state).toBe("succeeded");
    const files = await gitApp(join(p.ctx.dir, "repo.git"), ["ls-tree", "-r", "--name-only", `factory/${id}`]);
    console.log(files);
    expect(files).toContain("src/math.ts");
    await engine.shutdown();
  }, 3_600_000);
});
