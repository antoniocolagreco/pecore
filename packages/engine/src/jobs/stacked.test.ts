import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectWithRecipes } from "../../test/project";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { Engine } from "../main";
import { gitApp } from "../workdir/git-as";
import { branchHead } from "../workdir/repo";
import { jobCommit } from "./stacked";

const nodes = (marker: string): Record<string, object> => ({
  "write-own": {
    name: "write-own",
    description: "writes a file named after the job",
    kind: "command",
    command: ["/bin/sh", "-c", 'echo "$PECORE_JOB_TITLE" > "$PECORE_JOB_TITLE.txt"'],
    outcomes: ["done"],
    changesFiles: true,
    outcomeRules: [{ exitCode: 0, outcome: "done" }],
    timeoutSec: 30,
  },
  deliver: {
    name: "deliver",
    description: "pretends to open a pull request",
    kind: "command",
    runsAs: "engine",
    command: ["/bin/sh", "-c", 'echo "https://forge.example.com/pr/$PECORE_JOB_ID"'],
    probe: ["/bin/sh", "-c", "exit 0"],
    mergedCheck: ["/bin/sh", "-c", `test -f ${marker} && echo MERGED || true`],
    outcomes: ["opened"],
    outputs: { opened: "reference" },
    changesFiles: false,
    outcomeRules: [{ exitCode: 0, outcome: "opened" }],
    outputRules: { opened: { stdoutLastLine: "url" } },
    timeoutSec: 30,
  },
});

const recipes: Record<string, object> = {
  plain: {
    name: "plain",
    description: "write and commit; rebase on a base change",
    start: "write",
    onBaseChanged: "rebase",
    successOutcomes: ["commit:done"],
    nodes: { write: { use: "write-own" }, commit: { use: "git-commit" }, rebase: { use: "git-rebase" } },
    edges: [
      { from: "write", on: "done", to: "commit" },
      { from: "rebase", on: "clean", to: "commit" },
    ],
  },
  reviewed: {
    name: "reviewed",
    description: "write, human review, commit; rebase on a base change",
    start: "write",
    onBaseChanged: "rebase",
    successOutcomes: ["commit:done"],
    nodes: { write: { use: "write-own" }, human: { use: "human-review" }, commit: { use: "git-commit" }, rebase: { use: "git-rebase" } },
    edges: [
      { from: "write", on: "done", to: "human" },
      { from: "human", on: "approve", to: "commit" },
      { from: "rebase", on: "clean", to: "commit" },
    ],
  },
  delivered: {
    name: "delivered",
    description: "write, commit, deliver",
    start: "write",
    successOutcomes: ["deliver:opened"],
    nodes: { write: { use: "write-own" }, commit: { use: "git-commit" }, deliver: { use: "deliver" } },
    edges: [
      { from: "write", on: "done", to: "commit" },
      { from: "commit", on: "done", to: "deliver" },
    ],
  },
  "no-commit": {
    name: "no-commit",
    description: "only writes",
    start: "write",
    successOutcomes: ["write:done"],
    nodes: { write: { use: "write-own" } },
  },
};

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function setup() {
  const root = await tempDir();
  const marker = join(root, "merged");
  const lib = join(root, "templates");
  await cp(shippedTemplates, lib, { recursive: true });
  for (const [name, n] of Object.entries(nodes(marker))) await writeFile(join(lib, "nodes", `${name}.json`), JSON.stringify(n));
  for (const [name, r] of Object.entries(recipes)) await writeFile(join(lib, "recipes", `${name}.json`), JSON.stringify(r));
  const engine = await Engine.start({ home: join(root, "home"), templates: lib });
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, Object.keys(recipes));
  const p = engine.project("demo");
  const repo = join(p.ctx.dir, "repo.git");
  const job = (id: string) => p.executor.job(id);
  const files = async (id: string) => (await gitApp(repo, ["ls-tree", "--name-only", `refs/heads/factory/${id}`])).trim().split("\n").sort();
  const sha = async (id: string) => (await jobCommit(p.ctx.dir, p.ctx.db.events(id)))!;
  const openItem = (jobId: string | null, kind = "human-node") =>
    p.ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE (? IS NULL OR job_id = ?) AND kind = ? AND state = 'open'").get(jobId, jobId, kind) as { id: string; subject_hash: string } | undefined;
  return { root, marker, engine, p, repo, job, files, sha, openItem };
}

describe("stacked jobs (4.6, decision 10)", () => {
  it("a child waits for its parent, then starts from the parent's commit and targets the parent's branch", async () => {
    const { engine, p, job, files, sha, openItem } = await setup();
    const parent = await engine.createJob("demo", { title: "parent", ticket: { text: "x" }, recipe: "reviewed" });
    const child = await engine.createJob("demo", { title: "child", ticket: { text: "y" }, recipe: "plain", parentJobId: parent });
    expect(job(child)).toMatchObject({ state: "queued", waiting_reason: "parent_job", parent_job_id: parent, target: `factory/${parent}` });
    await until(() => openItem(parent));
    expect(job(child).state).toBe("queued");
    const item = openItem(parent)!;
    await p.executor.answer(item.id, "approve", null, item.subject_hash);
    await until(() => job(child).state === "succeeded");
    expect(job(child).base).toBe(await sha(parent));
    expect(await files(child)).toEqual(["child.txt", "parent.txt"]);
    await engine.shutdown();
  });

  it("a child of a stopped parent shows parent_failed, and a parent with live children cannot be deleted", async () => {
    const { engine, p, job, openItem } = await setup();
    const parent = await engine.createJob("demo", { title: "parent", ticket: { text: "x" }, recipe: "reviewed" });
    const child = await engine.createJob("demo", { title: "child", ticket: { text: "y" }, recipe: "plain", parentJobId: parent });
    await until(() => openItem(parent));
    await p.executor.stop(parent);
    expect(job(child)).toMatchObject({ state: "queued", waiting_reason: "parent_failed" });
    await expect(p.executor.remove(parent)).rejects.toThrow("children");
    await p.executor.stop(child);
    await p.executor.remove(parent);
    await engine.shutdown();
  });

  it("refuses a parent whose recipe has no commit node", async () => {
    const { engine } = await setup();
    const parent = await engine.createJob("demo", { title: "parent", ticket: { text: "x" }, recipe: "no-commit" });
    await expect(engine.createJob("demo", { title: "child", ticket: { text: "y" }, recipe: "plain", parentJobId: parent })).rejects.toThrow("no commit node");
    await engine.shutdown();
  });

  async function moveMain(repo: string): Promise<string> {
    const main = (await branchHead(repo, "main"))!;
    const blob = (await gitApp(repo, ["hash-object", "-w", "--stdin"], { input: "m\n" })).trim();
    const tree = (await gitApp(repo, ["mktree"], { input: `100644 blob ${blob}\tmain.txt\n` })).trim();
    const moved = (await gitApp(repo, ["commit-tree", tree, "-p", main, "-m", "main moved"])).trim();
    await gitApp(repo, ["update-ref", "refs/heads/main", moved]);
    return moved;
  }

  it("a new parent commit waits while the child works, then rebases the child when it ends (decision 15)", async () => {
    const { engine, p, repo, job, files, sha, openItem } = await setup();
    const parent = await engine.createJob("demo", { title: "parent", ticket: { text: "x" }, recipe: "plain" });
    const child = await engine.createJob("demo", { title: "child", ticket: { text: "y" }, recipe: "reviewed", parentJobId: parent });
    const review = await until(() => openItem(child));
    const first = await sha(parent);
    await moveMain(repo);
    await p.executor.requestBaseChange(parent, "realign", "main");
    await until(async () => job(parent).state === "succeeded" && (await sha(parent)) !== first);
    const second = await sha(parent);
    expect(job(child)).toMatchObject({ state: "waiting", waiting_reason: "human", base: first });
    expect(openItem(child)).toEqual(review);
    await p.executor.answer(review.id, "approve", null, review.subject_hash);
    await until(() => job(child).state === "succeeded" && job(child).base === second);
    expect(job(child).old_base).toBe(first);
    expect(await files(child)).toEqual(["child.txt", "main.txt", "parent.txt"]);
    await engine.shutdown();
  });

  it("the user can realign only a job that is not working; a stopped job re-enters at onBaseChanged", async () => {
    const { engine, p, repo, job, files, openItem } = await setup();
    const id = await engine.createJob("demo", { title: "solo", ticket: { text: "x" }, recipe: "reviewed" });
    await until(() => openItem(id));
    await moveMain(repo);
    await expect(p.executor.requestBaseChange(id, "realign", "main")).rejects.toThrow("only when it is stopped or finished");
    await p.executor.stop(id);
    await p.executor.requestBaseChange(id, "realign", "main");
    await until(() => job(id).state === "succeeded");
    expect(job(id).base).toBe(await branchHead(repo, "main"));
    expect(await files(id)).toEqual(["main.txt", "solo.txt"]);
    await engine.shutdown();
  });

  it("merge detection moves the children to the parent's target with base at its head (decision 10)", async () => {
    const { marker, engine, p, repo, job, openItem } = await setup();
    const parent = await engine.createJob("demo", { title: "parent", ticket: { text: "x" }, recipe: "delivered" });
    await until(() => job(parent).state === "succeeded");
    const child = await engine.createJob("demo", { title: "child", ticket: { text: "y" }, recipe: "reviewed", parentJobId: parent });
    await until(() => openItem(child));
    expect(await p.executor.checkMerge(parent)).toBe(false);
    expect(job(parent).merged_at).toBeNull();
    await writeFile(marker, "");
    await p.executor.checkMerges();
    expect(job(parent).merged_at).not.toBeNull();
    expect(job(child)).toMatchObject({ state: "waiting", target: `factory/${parent}` });
    const review = openItem(child)!;
    await p.executor.answer(review.id, "approve", null, review.subject_hash);
    await until(() => job(child).state === "succeeded" && job(child).target === "main");
    expect(job(child).base).toBe(await branchHead(repo, "main"));
    await engine.shutdown();
  });
});
