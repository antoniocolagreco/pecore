import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Node, Recipe } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { forgeAccount } from "../../test/fake-forge";
import { tempDir } from "../../test/tmp";
import { jobDefinitions } from "../definitions/snapshot";
import { createJob } from "../jobs/create";
import { gitApp } from "../workdir/git-as";
import { createLocalRepo } from "../workdir/repo";
import { outcomeOutputs, runCommandNode } from "./command";
import type { CommandRun } from "./command";
import { credentialHelper } from "./forge-env";
import { appUser } from "./process";
import { repositoryDefinition } from "./repository";

afterEach(() => vi.unstubAllEnvs());

it("verifies branch delivery against the actual remote job commit", async () => {
  const root: string = await tempDir();
  const repoDir: string = join(root, "repo.git");
  const remote: string = join(root, "remote.git");
  const commit: string = await createLocalRepo(repoDir, "main");
  const remoteCommit: string = await createLocalRepo(remote, "main");
  await gitApp(repoDir, ["remote", "add", "origin", remote]);
  const { engine, close } = await apiProject();
  try {
    const { ctx } = engine.project("demo");
    const template: Node | undefined = ctx.defs.nodes.get("open-pr");
    if (template?.kind !== "repository") throw new Error("Expected Open PR");
    const { definition, sidecars } = await repositoryDefinition(ctx, template, { ...forgeAccount, forge: "git", tool: "git", host: "git.example.com" });
    const run: CommandRun = {
      node: definition, outputs: outcomeOutputs(definition), inlineScript: definition.script, sidecars,
      nodeDir: ctx.defs.nodeDir, remote: true, user: appUser, workdir: root, params: {}, inputs: [],
      context: {
        job: { id: "job", title: "Change", request: "Make a change", branch: "factory/job", target: "main", base: commit, oldBase: commit, commit: "f".repeat(40) },
        project: { repoDir, repoUrl: remote, baseBranch: "main" }, ticketId: null,
      },
    };
    await expect(runCommandNode(run)).resolves.toMatchObject({ outcome: "failure" });
    await gitApp(remote, ["update-ref", "refs/heads/factory/job", remoteCommit]);
    await expect(runCommandNode(run)).resolves.toMatchObject({ outcome: "failure" });
    await expect(runCommandNode({ ...run, context: { ...run.context, job: { ...run.context.job!, commit: remoteCommit } } })).resolves.toMatchObject({ outcome: "success" });
  } finally {
    await close();
  }
});

it("passes the repository path to the CodeCommit credential helper", () => {
  expect(credentialHelper("!aws codecommit credential-helper $@")).toContain("credential.useHttpPath=true");
});

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
