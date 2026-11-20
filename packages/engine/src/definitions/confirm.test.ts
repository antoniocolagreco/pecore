import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectWithRecipes } from "../../test/project";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { definitionOperations } from "../api/routes/definitions";
import { Engine } from "../main";
import { canonical, subjectSha } from "./confirm";

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
  const engine = await Engine.start({ home: join(root, "home"), library: lib });
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["notify"]);
  return { root, engine, p: engine.project("demo") };
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

type Item = { id: string; subject_hash: string; subject: string; state: string };

describe("confirmation queue (section 8)", () => {
  it("treats a user's recipe import as approval of the matching library scripts", async () => {
    const { root, engine, p } = await setup();
    const definitions = definitionOperations(engine);
    const instantiate = (project: string) => definitions.handlers.instantiate({ params: undefined, query: undefined, body: { kind: "recipe", name: "notify", project } });
    try {
      await engine.createProject({ id: "fresh", name: "Fresh", repo: null });
      expect((await instantiate("fresh")).confirmItemIds).toEqual([]);
      expect(engine.project("fresh").ctx.db.db.prepare("SELECT 1 FROM human_queue WHERE kind = 'engine-node'").get()).toBeUndefined();

      await engine.createProject({ id: "staged", name: "Staged", repo: null });
      const staged = await definitions.stageInstantiation({ kind: "recipe", name: "notify", project: "staged" });
      expect(staged.confirmItemIds).toHaveLength(2);
      expect(engine.project("staged").ctx.db.db.prepare("SELECT 1 FROM confirmed_hashes WHERE path = 'nodes/notify.json'").get()).toBeUndefined();

      const first: string = await engine.createJob("demo", { title: "First", ticket: { text: "x" } });
      await until(() => p.executor.job(first).waiting_reason === "confirmation");
      const pending = p.ctx.db.db.prepare("SELECT id FROM human_queue WHERE kind = 'engine-node' AND state = 'open'").get() as { id: string };
      expect((await instantiate("demo")).confirmItemIds).toEqual([]);
      await until(() => p.executor.job(first).state === "succeeded");
      expect(p.ctx.db.db.prepare("SELECT state FROM human_queue WHERE id = ?").get(pending.id)).toEqual({ state: "resolved" });

      await writeFile(join(p.ctx.dir, "nodes", "notify.sh"), `echo changed >> ${marker(root)}\n`);
      const second: string = await engine.createJob("demo", { title: "Second", ticket: { text: "x" } });
      await until(() => p.executor.job(second).waiting_reason === "confirmation");
      await instantiate("demo");
      expect(p.executor.job(second).waiting_reason).toBe("confirmation");
      expect((await readFile(marker(root), "utf8")).trim()).toBe("first");
      await p.executor.stop(second);
    } finally {
      await engine.shutdown();
    }
  });

  it("a runsAs: engine node waits for confirmation, then runs the confirmed bytes", async () => {
    const { root, engine, p } = await setup();
    const id = await engine.createJob("demo", { title: "t", ticket: { text: "x" } });
    await until(() => p.executor.job(id).waiting_reason === "confirmation");
    const item = p.ctx.db.db.prepare("SELECT * FROM human_queue WHERE kind = 'engine-node'").get() as Item;
    expect(JSON.parse(item.subject).scripts["notify.sh"]).toContain("echo first");
    await p.executor.answer(item.id, "confirm", null, item.subject_hash);
    await until(() => p.executor.job(id).state === "succeeded");
    expect((await readFile(marker(root), "utf8")).trim()).toBe("first");
    await engine.shutdown();
  });

  it("a script edited after confirmation waits again and the old item is not reused", async () => {
    const { root, engine, p } = await setup();
    const first = await engine.createJob("demo", { title: "t", ticket: { text: "x" } });
    await until(() => p.executor.job(first).waiting_reason === "confirmation");
    const item = p.ctx.db.db.prepare("SELECT * FROM human_queue WHERE kind = 'engine-node'").get() as Item;
    await p.executor.answer(item.id, "confirm", null, item.subject_hash);
    await until(() => p.executor.job(first).state === "succeeded");
    await writeFile(join(p.ctx.dir, "nodes", "notify.sh"), `echo second >> ${marker(root)}\n`);
    const second = await engine.createJob("demo", { title: "t2", ticket: { text: "x" } });
    await until(() => p.executor.job(second).waiting_reason === "confirmation");
    expect((await readFile(marker(root), "utf8")).trim()).toBe("first");
    const open = p.ctx.db.db.prepare("SELECT * FROM human_queue WHERE kind = 'engine-node' AND state = 'open'").all() as Item[];
    expect(open).toHaveLength(1);
    expect(JSON.parse(open[0]!.subject).scripts["notify.sh"]).toContain("echo second");
    await expect(p.executor.answer(item.id, "confirm", null, item.subject_hash)).rejects.toThrow();
    await p.executor.stop(second);
    await engine.shutdown();
  });

  it("the hash covers the definition and every script it runs, independent of key order", () => {
    const a = subjectSha({ definition: { a: 1, b: [2, 3] }, scripts: { "x.sh": "echo" } });
    expect(subjectSha({ definition: { b: [2, 3], a: 1 }, scripts: { "x.sh": "echo" } })).toBe(a);
    expect(subjectSha({ definition: { a: 1, b: [2, 3] }, scripts: { "x.sh": "echo!" } })).not.toBe(a);
    expect(canonical({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });
});
