import { cp, mkdir, writeFile } from "node:fs/promises";
import { setTestConfiguration } from "../configuration";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/main";
import { createProjectWithRecipes } from "../project";
import { shippedTemplates, tempDir } from "../tmp";

const real = process.env.PECORE_REAL === "1";
const agentsRoot = fileURLToPath(new URL("../../../agents/", import.meta.url));
const connectorsDir = fileURLToPath(new URL("../../../app/resources/connectors/", import.meta.url));
const accounts = [{ id: "pi", kind: "model", provider: "pi", connector: "pi", login: "subscription" }];

async function adapters() {
  return (await import(join(agentsRoot, "adapters.json"), { with: { type: "json" } })).default as { adapters: Record<string, { version: string; entry: string }> };
}

async function start() {
  const home = join(await tempDir(), "home");
  await mkdir(home, { recursive: true });
  await setTestConfiguration(home, "accounts", { accounts });
  return Engine.start({ home, templates: shippedTemplates, agents: { connectorsDir, adaptersDir: join(agentsRoot, "out", "adapters"), adapters: (await adapters()).adapters }, checkLogins: false });
}

describe.skipIf(!real)("pi connector with the user's existing login", () => {
  it("checks the login and lists the models and efforts of the session", async () => {
    const engine = await start();
    const login = (await engine.loginViews()).find((view) => view.connector === "pi")!;
    expect(await engine.recheckLogin(login.id)).toMatchObject({ state: "logged_in", email: null });
    const options = await engine.accountOptions("pi");
    expect(options?.models.length).toBeGreaterThan(0);
    expect(options?.efforts.length).toBeGreaterThan(0);
    await engine.shutdown();
  }, 300_000);

  it("runs one agent node through pi to its outcome", async () => {
    const root = await tempDir();
    const templates = join(root, "templates");
    await cp(shippedTemplates, templates, { recursive: true });
    await writeFile(join(templates, "nodes", "agent-x.json"), JSON.stringify({
      name: "agent-x",
      description: "writes done.txt",
      kind: "agent",
      prompt: "agent-x.md",
      agent: { profiles: ["p"] },
      outcomes: ["done"],
      changesFiles: true,
      timeoutSec: 600,
    }));
    await writeFile(join(templates, "nodes", "agent-x.md"), "Create the file done.txt containing the single word ok. Do nothing else.\n");
    await writeFile(join(templates, "recipes", "one-agent.json"), JSON.stringify({ name: "one-agent", description: "one agent", start: "x", successOutcomes: ["x:done"], nodes: { x: { use: "agent-x" } }, edges: [] }));
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    await setTestConfiguration(home, "accounts", { accounts });
    const probe = await start();
    const login = (await probe.loginViews()).find((view) => view.connector === "pi")!;
    await probe.recheckLogin(login.id);
    const options = await probe.accountOptions("pi");
    await probe.shutdown();
    if (!options?.models.length) throw new Error("pi listed no models");
    const model: string = options.models.find((id) => /flash|free|mini/.test(id)) ?? options.models[0]!;
    const effort: string | null = options.efforts.includes("low") ? "low" : null;
    await setTestConfiguration(home, "profiles", { profiles: [{ id: "p", account: "pi", model, ...(effort ? { effort } : {}) }] });
    await setTestConfiguration(home, "tiers", { tiers: { frontier: ["p"], strong: ["p"], standard: ["p"], cheap: ["p"] } });
    const engine = await Engine.start({ home, templates, agents: { connectorsDir, adaptersDir: join(agentsRoot, "out", "adapters"), adapters: (await adapters()).adapters }, checkLogins: false });
    await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["one-agent"]);
    const p = engine.project("demo");
    const id = await engine.createJob("demo", { title: "Write done", request: "write done.txt" });
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const j = p.executor.job(id);
      if (["succeeded", "failed", "not_delivered", "stopped"].includes(j.state) || (j.state === "waiting" && j.waiting_reason !== "concurrency")) break;
    }
    const j = p.executor.job(id);
    console.log("pi", model, effort, j.state, j.failure_reason, j.waiting_reason, JSON.stringify(engine.why(id)));
    expect(j.state).toBe("succeeded");
    const run = p.ctx.db.db.prepare("SELECT files_hash_before, files_hash_after FROM node_runs WHERE job_id = ?").get(id) as { files_hash_before: string; files_hash_after: string };
    expect(run.files_hash_after).not.toBe(run.files_hash_before);
    await engine.shutdown();
  }, 900_000);
});
