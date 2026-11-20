import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import { describe, expect, it } from "vitest";
import { createProjectWithRecipes } from "../../test/project";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { Engine } from "../main";

const marker = (root: string) => join(root, "ran");

async function setup() {
  const root = await tempDir();
  const lib = join(root, "library");
  await cp(shippedLibrary, lib, { recursive: true });
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
  const engine = await Engine.start({ home, library: lib });
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
    const reopened: Engine = await Engine.start({ home, library: lib });
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
      await writeFile(join(p.ctx.dir, "nodes", "notify.sh"), `echo second >> ${marker(root)}\n`);
      const second: string = await engine.createJob("demo", { title: "Second", ticket: { text: "x" } });
      await until(() => p.executor.job(second).state === "succeeded");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("first\nsecond");
      expect(p.ctx.db.db.prepare("SELECT id FROM human_queue").all()).toEqual([]);
    } finally {
      await engine.shutdown();
    }
  });
});
