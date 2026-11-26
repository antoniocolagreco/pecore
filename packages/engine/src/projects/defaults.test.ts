import { describe, expect, it } from "vitest";
import { Accounts } from "@pecore/schemas";
import type { ForgeAccount } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { shippedTemplates } from "../../test/tmp";
import { listNodeTools } from "../chat/node-tools";
import { loadTemplates } from "../definitions/load";
import { prepareJob } from "../jobs/create";
import { repositoryDefinition } from "../runners/repository";
import { loadForgeDefaults } from "./defaults";

const cases = [
  { forge: "github", host: "github.com", tool: "gh", executable: "gh pr list", pullRequest: true, create: "gh repo view" },
  { forge: "gitlab", host: "gitlab.example.com", tool: "glab", executable: "glab mr list", pullRequest: true, create: "glab repo view" },
  { forge: "git", host: "git.example.com", tool: "git", executable: "PECORE_JOB_BRANCH", pullRequest: false, create: null },
  { forge: "codecommit", host: "git-codecommit.eu-south-1.amazonaws.com", tool: "aws", executable: "PECORE_JOB_BRANCH", pullRequest: false, create: null },
] as const;

describe("forge operations", () => {
  it.each(cases)("resolves the same recipe for $forge when creating a job", async ({ forge, host, tool, executable, pullRequest, create }) => {
    const { engine, close } = await apiProject();
    try {
      const account: ForgeAccount = { id: "remote", kind: "forge", forge, host, tool, user: "dev", author: { name: "Developer", email: "dev@example.com" } };
      engine.configuration.write({ accounts: Accounts.parse({ accounts: [account] }) });
      await engine.reloadGlobal();
      const { ctx } = engine.project("demo");
      ctx.db.definition.write({ ...ctx.project, repo: { url: `https://${host}/team/shop.git`, account: account.id }, recipes: ["feature-to-pr", "bugfix-to-pr"] });
      expect(await engine.reloadProject("demo")).toEqual([]);
      for (const name of ["feature-to-pr", "bugfix-to-pr"]) {
        const { recipe, definitions } = await prepareJob(ctx, name);
        expect(recipe.nodes.pr?.use).toBe("open-pr");
        expect(recipe.edges).toContainEqual(expect.objectContaining({ from: "push", on: "success", to: pullRequest ? "write-pr" : "pr" }));
        expect(recipe.nodes.pr?.reads).toEqual(pullRequest ? ["write-pr"] : []);
        expect(Boolean(recipe.nodes["write-pr"])).toBe(pullRequest);
        expect(ctx.defs.recipes.get(name)?.nodes["write-pr"]).toBeDefined();
        expect(definitions.nodes["open-pr"]!.definition).toMatchObject({
          name: "open-pr", account: account.id, script: expect.stringContaining(executable), mergedCheck: expect.anything(),
          outputs: pullRequest ? { success: "pull_request" } : {},
        });
        expect(Object.keys(definitions.nodes["open-pr"]!.sidecars)).not.toHaveLength(0);
      }
      const node = ctx.defs.nodes.get("create-repo");
      if (node?.kind !== "repository") throw new Error("Expected Create Repo");
      const setup = repositoryDefinition(ctx, node, account);
      if (create) await expect(setup).resolves.toMatchObject({ definition: { name: "create-repo", script: expect.stringContaining(create) } });
      else await expect(setup).rejects.toThrow("requires an existing repository");
      const tools = await listNodeTools(engine, "demo");
      const delivery = tools.find(({ name }) => name === "node_open-pr");
      expect(delivery?.inputSchema.required).toEqual(pullRequest ? ["inputs"] : []);
      expect(tools.some(({ name }) => name === "node_create-repo")).toBe(Boolean(create));
      expect(tools.some(({ name }) => ["node_github-pr", "node_gitlab-mr", "node_git-delivery"].includes(name))).toBe(false);
    } finally {
      await close();
    }
  });

  it("keeps the provider definitions outside the template library", async () => {
    const { nodes, errors } = await loadTemplates(shippedTemplates);
    expect(errors).toEqual([]);
    expect([...nodes.keys()].filter((name) => /^(?:github|gitlab)-|^git-delivery$/.test(name))).toEqual([]);
    expect(nodes.get("open-pr")).toMatchObject({ kind: "repository", script: "", account: "project.account" });
    expect(nodes.get("create-repo")).toMatchObject({ kind: "repository", script: "", account: "project.account" });
    await expect(loadForgeDefaults(shippedTemplates, "bitbucket")).rejects.toThrow();
    expect((await loadForgeDefaults(shippedTemplates, "github")).credentialHelper).toBe("!gh auth git-credential");
  });

  it("installs the portable definition instead of the GitLab implementation", async () => {
    const { engine, call, close } = await apiProject();
    try {
      const account: ForgeAccount = {
        id: "work-gitlab", kind: "forge", forge: "gitlab", host: "gitlab.example.com", tool: "glab",
        user: "dev", author: { name: "Developer", email: "dev@example.com" },
      };
      engine.configuration.write({ accounts: Accounts.parse({ accounts: [account] }) });
      await engine.reloadGlobal();
      const { ctx } = engine.project("demo");
      ctx.db.definition.write({ ...ctx.project, repo: { url: "https://gitlab.example.com/team/shop.git", account: account.id }, recipes: undefined });
      await engine.reloadProject("demo");
      const result = await call("instantiate", { body: { kind: "recipe", name: "bugfix-to-pr", project: "demo" } });
      expect(ctx.db.catalog.recipe("bugfix-to-pr")?.nodes.pr?.use).toBe("open-pr");
      expect(ctx.db.catalog.recipe("bugfix-to-pr")?.nodes.comment?.use).toBe("post-delivery-to-ticket");
      expect(result.created).toContain("projects/demo/nodes/open-pr.json");
      expect(result.created.some((path) => /github-|gitlab-/.test(path))).toBe(false);
    } finally {
      await close();
    }
  });
});
