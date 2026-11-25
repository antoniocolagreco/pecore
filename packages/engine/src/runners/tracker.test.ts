import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Node, Recipe } from "@pecore/schemas";
import type { TrackerNode } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { forgeAccount } from "../../test/fake-forge";
import { tempDir } from "../../test/tmp";
import { activeJiraAccount } from "../accounts/jira";
import { createJob } from "../jobs/create";
import { runTrackerNode } from "./tracker";

afterEach(() => vi.unstubAllEnvs());

async function installCli(name: string, script: string): Promise<void> {
  const bin: string = await tempDir();
  await writeFile(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o700 });
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
}

it("runs a job Tracker with the selected Git hosting account and blocks a missing account", async () => {
  await installCli("gh", 'test "$*" = "auth token --user tester --hostname github.com" && printf fixture-token');
  const { engine, close } = await apiProject();
  try {
    const { ctx, executor } = engine.project("demo");
    const tracker: TrackerNode = Node.parse({
      name: "read-ticket", description: "Read a GitHub ticket", kind: "tracker", provider: "github",
      account: forgeAccount.id, script: 'test "$GH_TOKEN" = fixture-token && test "$GH_HOST" = github.com',
      outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }],
    }) as TrackerNode;
    ctx.defs.nodes.set(tracker.name, tracker);
    const recipe: Recipe = Recipe.parse({ name: "tracker-fixture", description: "Read a ticket", start: "read",
      nodes: { read: { use: tracker.name } }, successOutcomes: ["read:done"] });
    ctx.defs.recipes.set(recipe.name, recipe);
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM tickets_seen").get()).toEqual({ n: 0 });
    await expect(createJob(ctx, { title: "Read", ticket: { text: "Read this" }, recipe: recipe.name })).rejects.toThrow(/choose a matching Git hosting account/i);
    expect(executor.jobs()).toEqual([]);
    ctx.forgeAccount = (id) => id === forgeAccount.id ? forgeAccount : undefined;
    const id: string = await engine.createJob("demo", { title: "Read", ticket: { text: "Read this" }, recipe: recipe.name });
    await expect.poll(() => executor.jobs().find((job) => job.id === id)?.state).toBe("succeeded");
  } finally {
    await close();
  }
});

it("checks the active Jira site and email before running under the app user", async () => {
  await installCli("acli", 'printf "Site: first.atlassian.net\\nEmail: alice@example.test\\n"');
  const active = await activeJiraAccount();
  expect(active).toMatchObject({ site: "first.atlassian.net", account: { service: "Jira", user: "alice@example.test" } });
  const { engine, close } = await apiProject();
  try {
    const { ctx } = engine.project("demo");
    const node: TrackerNode = Node.parse({
      name: "read-jira", description: "Read a Jira ticket", kind: "tracker", provider: "jira",
      account: active!.account.id, script: 'test "$PECORE_JIRA_SITE" = first.atlassian.net',
      outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }],
    }) as TrackerNode;
    const options = {
      params: {}, nodeDir: ctx.defs.nodeDir, user: "pecore-agent", workdir: ctx.dir, inputs: [],
      context: { ticketId: "TEST-1", project: { repoDir: join(ctx.dir, "repo.git"), repoUrl: null, baseBranch: "main" } },
    };
    expect(await runTrackerNode(ctx, node, options)).toMatchObject({ kind: "completed", outcome: "done" });
    await installCli("acli", 'printf "Site: second.atlassian.net\\nEmail: alice@example.test\\n"');
    await expect(runTrackerNode(ctx, node, options)).rejects.toThrow(/selected Jira login is unavailable/);
  } finally {
    await close();
  }
});
