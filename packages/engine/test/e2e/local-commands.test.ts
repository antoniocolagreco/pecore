import { cp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitApp, gitAppIn } from "../../src/workdir/git-as";
import { Engine } from "../../src/main";
import { createProjectWithRecipes } from "../project";
import { shippedTemplates, tempDir } from "../tmp";

const nodes: Record<string, object> = {
  "touch-file": {
    name: "touch-file",
    description: "writes hello.txt",
    kind: "command",
    command: ["/bin/sh", "-c", "echo hello > hello.txt"],
    outcomes: ["done"],
    changesFiles: true,
    outcomeRules: [{ exitCode: 0, outcome: "done" }],
    timeoutSec: 30,
  },
  "has-file": {
    name: "has-file",
    description: "checks hello.txt",
    kind: "command",
    command: ["test", "-f", "hello.txt"],
    outcomes: ["passed", "failed"],
    failOutcomes: ["failed"],
    changesFiles: false,
    outcomeRules: [
      { exitCode: 0, outcome: "passed" },
      { exitCode: "other", outcome: "failed" },
    ],
    timeoutSec: 30,
  },
  "sneaky-check": {
    name: "sneaky-check",
    description: "a check that edits a file",
    kind: "command",
    command: ["/bin/sh", "-c", "echo changed > hello.txt"],
    outcomes: ["passed"],
    changesFiles: false,
    outcomeRules: [{ exitCode: 0, outcome: "passed" }],
    timeoutSec: 30,
  },
  slow: {
    name: "slow",
    description: "sleeps",
    kind: "command",
    command: ["sleep", "30"],
    outcomes: ["done"],
    changesFiles: false,
    outcomeRules: [{ exitCode: 0, outcome: "done" }],
    timeoutSec: 60,
  },
};

const recipes: Record<string, object> = {
  "cmd-only": {
    name: "cmd-only",
    description: "write, check, review, commit",
    start: "write",
    successOutcomes: ["commit:done"],
    nodes: { write: { use: "touch-file" }, check: { use: "has-file" }, human: { use: "human-review" }, commit: { use: "git-commit", requires: ["check", "human"] } },
    edges: [
      { from: "write", on: "done", to: "check" },
      { from: "check", on: "passed", to: "human" },
      { from: "human", on: "approve", to: "commit" },
      { from: "human", on: "changes", to: "write" },
      { from: "commit", on: "stale", to: "check" },
    ],
  },
  "write-commit": {
    name: "write-commit",
    description: "write and commit",
    start: "write",
    successOutcomes: ["commit:done"],
    nodes: { write: { use: "touch-file" }, commit: { use: "git-commit" } },
    edges: [{ from: "write", on: "done", to: "commit" }],
  },
  sneaky: {
    name: "sneaky",
    description: "a read-only check that edits",
    start: "write",
    successOutcomes: ["check:passed"],
    nodes: { write: { use: "touch-file" }, check: { use: "sneaky-check" } },
    edges: [{ from: "write", on: "done", to: "check" }],
  },
  slow: {
    name: "slow",
    description: "one slow node",
    start: "slow",
    successOutcomes: ["slow:done"],
    nodes: { slow: { use: "slow" } },
  },
};

async function templates(): Promise<string> {
  const dir = join(await tempDir(), "templates");
  await cp(shippedTemplates, dir, { recursive: true });
  for (const [name, n] of Object.entries(nodes)) await writeFile(join(dir, "nodes", `${name}.json`), JSON.stringify(n));
  for (const [name, r] of Object.entries(recipes)) await writeFile(join(dir, "recipes", `${name}.json`), JSON.stringify(r));
  return dir;
}

async function until<T>(fn: () => T | undefined | false, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function setup(recipe: string) {
  const home = join(await tempDir(), "home");
  const lib = await templates();
  const engine = await Engine.start({ home, templates: lib });
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, [recipe]);
  return { home, lib, engine, project: engine.project("demo") };
}

describe("phase 2 gate: command-only recipe on a local-only project, app user as project user", () => {
  it("runs write, check, human review and commit to the end", async () => {
    const { engine, project } = await setup("cmd-only");
    const id = await engine.createJob("demo", { title: "Add hello", ticket: { text: "Please add hello.txt" } });
    await until(() => project.executor.job(id).state === "waiting");
    expect(project.executor.job(id).waiting_reason).toBe("human");
    const item = project.ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open'").get() as { id: string; subject_hash: string };
    await project.executor.answer(item.id, "approve", "looks good", item.subject_hash);
    await until(() => project.executor.job(id).state === "succeeded");
    const repo = join(project.ctx.dir, "repo.git");
    expect((await gitApp(repo, ["show", `factory/${id}:hello.txt`])).trim()).toBe("hello");
    expect((await gitApp(repo, ["log", "-1", "--format=%s", `factory/${id}`])).trim()).toBe("Add hello");
    expect(await readdir(join(project.ctx.dir, "work"))).toEqual([]);
    const runs = project.ctx.db.db.prepare("SELECT node, state, outcome FROM node_runs ORDER BY rowid").all();
    expect(runs).toEqual([
      { node: "write", state: "completed", outcome: "done" },
      { node: "check", state: "completed", outcome: "passed" },
      { node: "human", state: "completed", outcome: "approve" },
      { node: "commit", state: "completed", outcome: "done" },
    ]);
    const types = project.executor.artifacts(id).map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["document", "diff", "text", "reference"]));
    await engine.shutdown();
  });

  it("restores the workdir and fails the job when a read-only node changes files", async () => {
    const { engine, project } = await setup("sneaky");
    const id = await engine.createJob("demo", { title: "Sneaky", ticket: { text: "x" } });
    await until(() => project.executor.job(id).state === "failed");
    expect(project.executor.job(id).failure_reason).toBe("READ_ONLY_VIOLATION");
    const wd = join(project.ctx.dir, "work", id);
    const { readFile } = await import("node:fs/promises");
    expect((await readFile(join(wd, "hello.txt"), "utf8")).trim()).toBe("hello");
    await engine.shutdown();
  });

  it("stops a running job and its process group", async () => {
    const { engine, project } = await setup("slow");
    const id = await engine.createJob("demo", { title: "Slow", ticket: { text: "x" } });
    await until(() => (project.ctx.db.db.prepare("SELECT pgid FROM node_runs WHERE pgid IS NOT NULL").get() as { pgid: number } | undefined)?.pgid);
    await project.executor.stop(id);
    expect(project.executor.job(id).state).toBe("stopped");
    expect(project.ctx.db.db.prepare("SELECT state FROM node_runs").get()).toEqual({ state: "interrupted" });
    await engine.shutdown();
  }, 30000);

  it("pauses running jobs with reason quit after a restart, and play continues them", async () => {
    const { home, lib, engine, project } = await setup("slow");
    const id = await engine.createJob("demo", { title: "Slow", ticket: { text: "x" } });
    await until(() => (project.ctx.db.db.prepare("SELECT pgid FROM node_runs WHERE pgid IS NOT NULL").get() as { pgid: number } | undefined)?.pgid);
    await engine.shutdown();
    const again = await Engine.start({ home, templates: lib });
    const p = again.project("demo");
    expect(p.executor.job(id)).toMatchObject({ state: "paused", waiting_reason: "quit" });
    expect(p.ctx.db.db.prepare("SELECT state FROM node_runs").get()).toEqual({ state: "interrupted" });
    await p.executor.play(id);
    await until(() => (p.ctx.db.db.prepare("SELECT count(*) AS n FROM node_runs").get() as { n: number }).n === 2);
    expect(p.executor.job(id).state).toBe("running");
    await p.executor.stop(id);
    await again.shutdown();
  }, 40000);
});

describe("project folder (decision 75)", () => {
  async function withFolder() {
    const home = join(await tempDir(), "home");
    const folder = join(await tempDir(), "demo");
    const engine = await Engine.start({ home, templates: await templates() });
    await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null, folder }, ["write-commit"]);
    return { engine, folder, project: engine.project("demo") };
  }

  it("a job starts from the folder's base branch and its branch is copied to the folder", async () => {
    const { engine, folder, project } = await withFolder();
    await writeFile(join(folder, "mine.txt"), "mine\n");
    await gitAppIn(folder, ["add", "mine.txt"]);
    await gitAppIn(folder, ["commit", "-q", "-m", "Mine"]);
    const mine = (await gitAppIn(folder, ["rev-parse", "HEAD"])).trim();
    const id = await engine.createJob("demo", { title: "Add hello", ticket: { text: "add hello" } });
    expect(project.executor.job(id).base).toBe(mine);
    await until(() => project.executor.job(id).state === "succeeded");
    expect((await gitAppIn(folder, ["show", `factory/${id}:hello.txt`])).trim()).toBe("hello");
    expect((await gitAppIn(folder, ["show", `factory/${id}:mine.txt`])).trim()).toBe("mine");
    await engine.shutdown();
  });

  it("a job still runs when the folder is gone, and a notification says its branch was not copied", async () => {
    const { engine, folder, project } = await withFolder();
    await rm(folder, { recursive: true, force: true });
    const id = await engine.createJob("demo", { title: "Add hello", ticket: { text: "add hello" } });
    await until(() => project.executor.job(id).state === "succeeded");
    expect((await gitApp(join(project.ctx.dir, "repo.git"), ["show", `factory/${id}:hello.txt`])).trim()).toBe("hello");
    expect(engine.notifications()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "folder", title: "Add hello", body: expect.stringContaining(`factory/${id} was not copied to ${folder}`) })]));
    await engine.shutdown();
  });
});
