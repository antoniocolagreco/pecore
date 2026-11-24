import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import { describe, expect, it } from "vitest";
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
      description: "an engine node",
      kind: "command",
      runsAs: "engine",
      script: "notify.sh",
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
  await writeFile(join(lib, "nodes", "notify.sh"), `echo first >> ${marker(root)}\n`);
  await writeFile(join(lib, "recipes", "notify.json"), JSON.stringify({ name: "notify", description: "one engine node", start: "n", successOutcomes: ["n:done"], nodes: { n: { use: "notify" } } }));
  const home: string = join(root, "home");
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

describe("engine nodes", () => {
  it("closes obsolete approval items on restart without starting a queued draft", async () => {
    const { home, lib, engine, p } = await setup();
    const ulid = monotonicFactory();
    const itemId: string = ulid();
    const jobId: string = ulid();
    try {
      const recipe = p.ctx.defs.recipes.get("notify")!;
      p.ctx.db.append([
        { jobId: null, type: "queue.added", payload: { itemId, kind: "recipe-change", subject: {}, subjectHash: "a".repeat(64), choices: ["confirm", "reject"] } },
        { jobId, type: "job.created", payload: { title: "Legacy draft", recipe, ticket: null, parentJobId: null, baseBranch: "main", base: "a".repeat(40), target: "main", branch: `factory/${jobId}`, recipeConfirmationId: itemId } },
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
      const first: string = await engine.createJob("demo", { title: "First", ticket: { text: "x" } });
      await until(() => p.executor.job(first).state === "succeeded");
      await writeFile(join(p.ctx.defs.nodeDir, "notify.sh"), `echo second >> ${marker(root)}\n`);
      const second: string = await engine.createJob("demo", { title: "Second", ticket: { text: "x" } });
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
      first = await engine.createJob("demo", { title: "First", ticket: { text: "x" } });
      expect(p.executor.job(first).state).toBe("queued");
      await writeFile(join(p.ctx.defs.nodeDir, "notify.sh"), `echo second >> ${marker(root)}\n`);
    } finally {
      await engine.shutdown();
    }
    const reopened: Engine = await Engine.start({ home, templates: lib });
    try {
      const project = reopened.project("demo");
      await until(() => project.executor.job(first).state === "succeeded");
      const second: string = await reopened.createJob("demo", { title: "Second", ticket: { text: "x" } });
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

  it("moves a legacy project with a custom script into Templates without overwriting the shared node", async () => {
    const { root, home, lib, engine, p } = await setup();
    const dir: string = p.ctx.dir;
    try {
      const legacy = { ...p.ctx.project };
      delete legacy.recipes;
      await mkdir(join(dir, "nodes"));
      await mkdir(join(dir, "recipes"));
      await cp(join(p.ctx.defs.nodeDir, "notify.json"), join(dir, "nodes", "notify.json"));
      await cp(join(p.ctx.templates, "recipes", "notify.json"), join(dir, "recipes", "notify.json"));
      await writeFile(join(dir, "nodes", "notify.sh"), `echo migrated >> ${marker(root)}\n`);
      await writeFile(join(dir, "project.json"), JSON.stringify(legacy));
    } finally {
      await engine.shutdown();
    }
    const reopened: Engine = await Engine.start({ home, templates: lib });
    try {
      const project = reopened.project("demo");
      expect(project.ctx.project.recipes).toEqual(["notify-demo"]);
      expect(project.ctx.defs.recipes.get("notify-demo")?.nodes.n?.use).toBe("notify-demo");
      await expect(stat(join(dir, "nodes"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(dir, "recipes"))).rejects.toMatchObject({ code: "ENOENT" });
      const job: string = await reopened.createJob("demo", { title: "Legacy", ticket: { text: "x" } });
      await until(() => project.executor.job(job).state === "succeeded");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("migrated");
      expect(await readFile(join(project.ctx.defs.nodeDir, "notify.sh"), "utf8")).toContain("echo first");
    } finally {
      await reopened.shutdown();
    }
  });

  it("follows a Decision's selected branch without treating it as a Review", async () => {
    const { root, engine, p } = await setup();
    try {
      await writeFile(join(p.ctx.defs.nodeDir, "pick.json"), JSON.stringify({
        name: "pick", description: "Choose a branch", kind: "human", interface: "decision",
        outcomes: ["approve", "b", "c"],
      }));
      await writeFile(join(p.ctx.templates, "recipes", "pick.json"), JSON.stringify({
        name: "pick", description: "Route a decision", start: "pick",
        nodes: { pick: { use: "pick", params: { question: "Which branch should run?" } }, gated: { use: "notify", requires: ["pick"] }, free: { use: "notify" } },
        edges: [{ from: "pick", on: "approve", to: "gated" }, { from: "pick", on: "b", to: "free" }],
        successOutcomes: ["pick:c", "gated:done", "free:done"],
      }));
      const project = { ...p.ctx.project, recipes: ["notify", "pick"] };
      await writeFile(join(p.ctx.dir, "project.json"), JSON.stringify(project));
      expect(await engine.reloadProject("demo")).toEqual([]);
      const decide = async (choice: string): Promise<string> => {
        const id: string = await engine.createJob("demo", { title: choice, recipe: "pick", ticket: { text: "x" } });
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
