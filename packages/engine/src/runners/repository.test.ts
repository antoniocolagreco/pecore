import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Node, Recipe } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { forgeAccount } from "../../test/fake-forge";
import { tempDir } from "../../test/tmp";
import { jobDefinitions } from "../definitions/snapshot";
import { createJob } from "../jobs/create";

afterEach(() => vi.unstubAllEnvs());

it("requires a Repository account and passes its credentials only to the Repository step", async () => {
  const bin: string = await tempDir();
  await writeFile(join(bin, "gh"), '#!/bin/sh\ntest "$*" = "auth token --user tester --hostname github.com" && printf fixture-token\n', { mode: 0o700 });
  vi.stubEnv("PATH", bin + ":" + process.env.PATH);
  vi.stubEnv("GH_TOKEN", "ambient-token");
  vi.stubEnv("GITLAB_TOKEN", "ambient-token");
  vi.stubEnv("AWS_PROFILE", "ambient-profile");
  const { engine, close } = await apiProject();
  try {
    const { ctx, executor } = engine.project("demo");
    const publish: Node = Node.parse({
      name: "publish", kind: "repository", description: "Publish a branch", account: forgeAccount.id,
      script: 'test "$GH_TOKEN" = fixture-token && test "$GH_HOST" = github.com && test ! -e .git',
      outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }],
    });
    const check: Node = Node.parse({
      name: "check", kind: "command", description: "Check the worktree", timeoutSec: 30, changesFiles: false,
      command: ["/bin/sh", "-c", 'test -z "$GH_TOKEN$GITLAB_TOKEN$AWS_PROFILE$PECORE_JIRA_SITE" && test -e .git'],
      outcomes: ["passed"], outcomeRules: [{ exitCode: 0, outcome: "passed" }],
    });
    ctx.defs.nodes.set(publish.name, publish);
    ctx.defs.nodes.set(check.name, check);
    const recipe: Recipe = Recipe.parse({
      name: "publish-fixture", description: "Publish and check", start: "publish",
      nodes: { publish: { use: "publish" }, check: { use: "check" } },
      edges: [{ from: "publish", on: "done", to: "check" }], successOutcomes: ["check:passed"],
    });
    ctx.defs.recipes.set(recipe.name, recipe);
    await expect(createJob(ctx, { title: "Publish", request: "Publish this", recipe: recipe.name }))
      .rejects.toThrow(/choose a Git hosting account/i);
    expect(executor.jobs()).toEqual([]);

    ctx.forgeAccount = (id) => id === forgeAccount.id ? forgeAccount : undefined;
    await engine.pauseAll();
    const id: string = await engine.createJob("demo", { title: "Publish", request: "Publish this", recipe: recipe.name });
    expect(jobDefinitions(ctx.db, id)?.nodes.publish?.definition).toHaveProperty("account", forgeAccount.id);
    ctx.forgeAccount = () => undefined;
    await engine.playAll();
    await expect.poll(() => executor.job(id)).toMatchObject({ state: "queued", waiting_reason: "auth" });
    expect(ctx.db.events(id).some(({ type }) => type === "node_run.created")).toBe(false);

    ctx.forgeAccount = (id) => id === forgeAccount.id ? forgeAccount : undefined;
    await executor.tick(id);
    await expect.poll(() => executor.job(id).state).toBe("succeeded");
  } finally {
    await close();
  }
});
