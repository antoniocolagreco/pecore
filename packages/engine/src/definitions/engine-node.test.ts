import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import { describe, expect, it } from "vitest";
import { Node, Recipe } from "@pecore/schemas";
import { setTestConfiguration } from "../../test/configuration";
import { createProjectWithRecipes } from "../../test/project";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { Engine } from "../main";
import { jobDefinitions } from "./snapshot";

const marker = (root: string) => join(root, "ran");

async function setup() {
  const root = await tempDir();
  const lib = join(root, "templates");
  await cp(shippedTemplates, lib, { recursive: true });
  await writeFile(
    join(lib, "nodes", "notify.json"),
    JSON.stringify({
      name: "notify",
      description: "a repository node",
      kind: "repository",
      account: "git-fixture",
      script: `echo first >> ${marker(root)}`,
      probe: ["/bin/sh", "-c", "exit 0"],
      outcomes: ["done", "failed"],
      failOutcomes: ["failed"],
      changesFiles: false,
      outcomeRules: [
        { exitCode: 0, outcome: "done" },
        { exitCode: "other", outcome: "failed" },
      ],
      timeoutSec: 30,
    }),
  );
  await writeFile(join(lib, "recipes", "notify.json"), JSON.stringify({ name: "notify", description: "one repository node", start: "n", successOutcomes: ["n:done"], nodes: { n: { use: "notify" } } }));
  const home: string = join(root, "home");
  await setTestConfiguration(home, "accounts", { accounts: [{ id: "git-fixture", kind: "forge", forge: "git", tool: "git", host: "forge.example.com", user: "", author: { name: "", email: "" } }] });
  const engine = await Engine.start({ home, templates: lib });
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["notify"]);
  return { root, home, lib, engine, p: engine.project("demo") };
}

async function until<T>(fn: () => T | undefined | false, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("repository nodes", () => {
  it("closes obsolete approval items on restart without starting a queued draft", async () => {
    const { home, lib, engine, p } = await setup();
    const ulid = monotonicFactory();
    const itemId: string = ulid();
    const jobId: string = ulid();
    try {
      const recipe = p.ctx.defs.recipes.get("notify")!;
      p.ctx.db.append([
        { jobId: null, type: "queue.added", payload: { itemId, kind: "recipe-change", subject: {}, subjectHash: "a".repeat(64), choices: ["confirm", "reject"] } },
        { jobId, type: "job.created", payload: { title: "Legacy draft", recipe, request: "", parentJobId: null, baseBranch: "main", base: "a".repeat(40), target: "main", branch: `factory/${jobId}`, recipeConfirmationId: itemId } },
        { jobId, type: "job.state_changed", payload: { state: "queued", reason: "confirmation" } },
      ]);
    } finally {
      await engine.shutdown();
    }
    const reopened: Engine = await Engine.start({ home, templates: lib });
    try {
      const project = reopened.project("demo");
      expect(project.ctx.db.db.prepare("SELECT state FROM human_queue WHERE id = ?").get(itemId)).toEqual({ state: "cancelled" });
      expect(project.executor.job(jobId)).toMatchObject({ state: "stopped", waiting_reason: null });
    } finally {
      await reopened.shutdown();
    }
  });

  it("runs an imported recipe and later edits to its script without queue items", async () => {
    const { root, engine, p } = await setup();
    try {
      const first: string = await engine.createJob("demo", { title: "First", request: "x" });
      await until(() => p.executor.job(first).state === "succeeded");
      engine.catalog.saveNode(Node.parse({ ...engine.catalog.node("notify"), script: `echo second >> ${marker(root)}` }));
      await engine.reloadProject("demo");
      const second: string = await engine.createJob("demo", { title: "Second", request: "x" });
      await until(() => p.executor.job(second).state === "succeeded");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("first\nsecond");
      expect(p.ctx.db.db.prepare("SELECT id FROM human_queue").all()).toEqual([]);
    } finally {
      await engine.shutdown();
    }
  });

  it("runs a queued job with its original definitions after a restart", async () => {
    const { root, home, lib, engine, p } = await setup();
    let first: string;
    try {
      await engine.pauseAll();
      first = await engine.createJob("demo", { title: "First", request: "x" });
      expect(p.executor.job(first).state).toBe("queued");
      engine.catalog.saveNode(Node.parse({ ...engine.catalog.node("notify"), script: `echo second >> ${marker(root)}` }));
    } finally {
      await engine.shutdown();
    }
    const reopened: Engine = await Engine.start({ home, templates: lib });
    try {
      const project = reopened.project("demo");
      await until(() => project.executor.job(first).state === "succeeded");
      const second: string = await reopened.createJob("demo", { title: "Second", request: "x" });
      await until(() => project.executor.job(second).state === "succeeded");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("first\nsecond");
      const firstSnapshot = jobDefinitions(project.ctx.db, first);
      const secondSnapshot = jobDefinitions(project.ctx.db, second);
      expect(firstSnapshot?.recipeHash).toBe(secondSnapshot?.recipeHash);
      expect(firstSnapshot?.nodes.notify?.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(firstSnapshot?.nodes.notify?.hash).not.toBe(secondSnapshot?.nodes.notify?.hash);
    } finally {
      await reopened.shutdown();
    }
  });

  it("ignores legacy project files and keeps the selected recipe in the database across restarts", async () => {
    const { root, home, lib, engine, p } = await setup();
    const dir: string = p.ctx.dir;
    try {
      const legacy = { ...p.ctx.project };
      delete legacy.recipes;
      await mkdir(join(dir, "nodes"));
      await mkdir(join(dir, "recipes"));
      await writeFile(join(dir, "nodes", "notify.json"), JSON.stringify({ ...engine.catalog.node("notify"), kind: "command", account: undefined,
        runsAs: "engine", credentials: ["git-fixture"], script: "notify.sh" }));
      await cp(join(p.ctx.templates, "recipes", "notify.json"), join(dir, "recipes", "notify.json"));
      await writeFile(join(dir, "nodes", "notify.sh"), `echo migrated >> ${marker(root)}\n`);
      await writeFile(join(dir, "project.json"), JSON.stringify(legacy));
    } finally {
      await engine.shutdown();
    }
    const reopened: Engine = await Engine.start({ home, templates: lib });
    try {
      const project = reopened.project("demo");
      expect(project.ctx.project.recipes).toEqual(["notify"]);
      expect(project.ctx.defs.recipes.get("notify")?.nodes.n?.use).toBe("notify");
      expect((await stat(join(dir, "nodes"))).isDirectory()).toBe(true);
      expect((await stat(join(dir, "recipes"))).isDirectory()).toBe(true);
      const job: string = await reopened.createJob("demo", { title: "Legacy", request: "x" });
      await until(() => project.executor.job(job).state === "succeeded");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("first");
      expect(reopened.catalog.node("notify")).toHaveProperty("script", `echo first >> ${marker(root)}`);
    } finally {
      await reopened.shutdown();
    }
  });

  it("follows a Decision's selected branch without treating it as a Review", async () => {
    const { root, engine, p } = await setup();
    try {
      engine.catalog.saveNode(Node.parse({
        name: "pick", description: "Choose a branch", kind: "human", interface: "decision",
        outcomes: ["approve", "b", "c"],
      }));
      engine.catalog.saveRecipe(Recipe.parse({
        name: "pick", description: "Route a decision", start: "pick",
        nodes: { pick: { use: "pick", params: { question: "Which branch should run?" } }, gated: { use: "notify", requires: ["pick"] }, free: { use: "notify" } },
        edges: [{ from: "pick", on: "approve", to: "gated" }, { from: "pick", on: "b", to: "free" }],
        successOutcomes: ["pick:c", "gated:done", "free:done"],
      }));
      const project = { ...p.ctx.project, recipes: ["notify", "pick"] };
      p.ctx.db.definition.write(project);
      expect(await engine.reloadProject("demo")).toEqual([]);
      const decide = async (choice: string): Promise<string> => {
        const id: string = await engine.createJob("demo", { title: choice, recipe: "pick", request: "x" });
        const item = await until(() => p.ctx.db.db.prepare("SELECT id, subject_hash, subject FROM human_queue WHERE job_id = ? AND state = 'open'").get(id) as { id: string; subject_hash: string; subject: string } | undefined);
        expect(JSON.parse(item.subject)).toMatchObject({ interface: "decision", description: "Which branch should run?" });
        await p.executor.answer(item.id, choice, null, item.subject_hash);
        return id;
      };
      const gated: string = await decide("approve");
      await until(() => p.executor.job(gated).state === "failed");
      expect(p.executor.job(gated).failure_reason).toBe("gated:stale");
      const free: string = await decide("b");
      await until(() => p.executor.job(free).state === "succeeded");
      const direct: string = await decide("c");
      await until(() => p.executor.job(direct).state === "succeeded");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("first");
    } finally {
      await engine.shutdown();
    }
  });
});
