import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { RecipeInput } from "@pecore/schemas";
import { Node, Recipe } from "@pecore/schemas";
import { forgeProject, until } from "../../test/forge-project";
import { Engine } from "../main";

let path: string | undefined;
let home: string | undefined;

beforeEach(() => { path = process.env.PATH; home = process.env.HOME; });
afterEach(() => { process.env.PATH = path; process.env.HOME = home; });

it("restarts a pending CI wait and runs a correction on the same pull request", async () => {
  const fixture = await forgeProject();
  let engine: Engine = fixture.engine;
  try {
    const { ctx } = engine.project("shop");
    const recipe: RecipeInput = {
      name: "with-ci", description: "Publish and wait for tests", start: "write",
      ci: { after: "pr", on: "success", checks: ["tests"], intervalSec: 1, timeoutSec: 30, maxCorrections: 1 },
      nodes: {
        write: { use: "write-spec" }, fix: { use: "fix-tests", reads: ["pr"] }, commit: { use: "git-commit" }, push: { use: "git-push" }, pr: { use: "github-pr", reads: ["write"] },
      },
      edges: [
        { from: "write", on: "done", to: "commit" }, { from: "commit", on: "success", to: "push" },
        { from: "push", on: "success", to: "pr" }, { from: "pr", on: "ci_failed", to: "fix" }, { from: "fix", on: "done", to: "commit" },
      ],
      successOutcomes: ["pr:ci_passed"],
    };
    engine.catalog.saveRecipe(Recipe.parse(recipe));
    engine.catalog.saveNode(Node.parse({
      name: "fix-tests", description: "Make a new commit", kind: "command",
      command: ["/bin/sh", "-c", "jq -ej '.log' > ci-log.txt && echo fixed >> hello.txt"], inputs: ["log"],
      changesFiles: true, outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }], timeoutSec: 10,
    }));
    ctx.db.definition.write({ ...ctx.project, recipes: ["with-ci"] });
    expect(await engine.reloadProject("shop")).toEqual([]);
    const job: string = await engine.createJob("shop", { title: "Exercise CI", request: "x" });
    const first: string = await until<string>(() => {
      const current = engine.project("shop").executor.job(job);
      return current.waiting_reason === "ci" ? fixture.forge.remoteHead("acme/shop", current.branch) ?? undefined : undefined;
    });
    await engine.shutdown();
    engine = await Engine.start({ home: fixture.home, templates: fixture.templates });
    const reopened = engine.project("shop");
    const branch: string = reopened.executor.job(job).branch;
    expect(reopened.executor.job(job).waiting_reason).toBe("ci");
    const foreign: string = fixture.forge.advance("acme/shop", branch, "foreign.txt");
    const item = await until(() => reopened.ctx.db.db.prepare("SELECT id, subject_hash, subject FROM human_queue WHERE job_id = ? AND kind = 'ci-head' AND state = 'open'").get(job) as
      { id: string; subject_hash: string; subject: string } | undefined);
    expect(JSON.parse(item.subject)).toMatchObject({ expected: first, actual: foreign });
    expect(reopened.executor.job(job).waiting_reason).toBe("ci_head");
    execFileSync("git", ["--git-dir", fixture.forge.remote("acme/shop"), "update-ref", `refs/heads/${branch}`, first, foreign]);
    await fixture.forge.set({ checks: { [first]: [{ name: "tests", bucket: "fail", link: "https://github.com/acme/shop/actions/runs/1", description: "unit tests failed" }] } });
    await reopened.executor.answer(item.id, "recheck", null, item.subject_hash);
    const second: string = await until<string>(() => {
      const next = fixture.forge.remoteHead("acme/shop", engine.project("shop").executor.job(job).branch);
      return next && next !== first ? next : undefined;
    });
    await fixture.forge.set({ checks: { [first]: [{ name: "tests", bucket: "pass", link: "" }] } });
    await until(() => engine.project("shop").executor.job(job).waiting_reason === "ci");
    await fixture.forge.set({ checks: { [first]: [{ name: "tests", bucket: "fail", link: "" }], [second]: [{ name: "tests", bucket: "pass", link: "" }] } });
    await until(() => engine.project("shop").executor.job(job).state === "succeeded");
    expect((await fixture.forge.state()).prs).toHaveLength(1);
    const project = engine.project("shop");
    const checks = project.ctx.db.events(job).filter((event) => event.type === "job.ci_check").map((event) => event.payload);
    expect(new Set(checks.map(({ deadline }) => deadline)).size).toBe(1);
    expect(checks.at(-1)).toMatchObject({ commit: second, corrections: 1, result: "ci_passed" });
    const failure = checks.find(({ result }) => result === "ci_failed");
    expect(project.ctx.db.requireArtifact(failure!.log!).toString("utf8")).toContain("unit tests failed");
    expect(execFileSync("git", ["--git-dir", fixture.forge.remote("acme/shop"), "show", `${second}:ci-log.txt`], { encoding: "utf8" })).toContain("unit tests failed");
  } finally {
    await engine.shutdown();
  }
}, 35000);
