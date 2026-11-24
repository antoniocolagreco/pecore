import { describe, expect, it } from "vitest";
import { Accounts } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { shippedTemplates } from "../../test/tmp";
import { loadForgeDefaults, projectDefaults } from "./defaults";

const repo = { url: "https://gitlab.example.com/acme/shop.git", account: "work-gitlab" };

describe("project defaults (decision 8)", () => {
  it("a local project has no forge and no renames", async () => {
    const d = await projectDefaults(shippedTemplates, null, null);
    expect(d.forge).toBeNull();
    expect(d.rename).toEqual({});
  });

  it("a GitLab project maps every GitHub template to its GitLab one", async () => {
    const d = await projectDefaults(shippedTemplates, repo, "gitlab");
    expect(d.rename).toMatchObject({
      "github-pr": "gitlab-mr",
      "github-issue-comment": "gitlab-issue-comment",
      "github-create-repo": "gitlab-create-repo",
      "github-issues": "gitlab-issues",
      "gitlab-mr": "gitlab-mr",
    });
  });

  it("a repository project needs a forge, and the forge file must match its name", async () => {
    await expect(projectDefaults(shippedTemplates, repo, null)).rejects.toThrow("needs a forge");
    await expect(loadForgeDefaults(shippedTemplates, "bitbucket")).rejects.toThrow();
    expect((await loadForgeDefaults(shippedTemplates, "github")).credentialHelper).toBe("!gh auth git-credential");
  });

  it("a private Git server project delivers the pushed branch, skips the ticket comment, and has no repo creation or ticket source", async () => {
    const forge = await loadForgeDefaults(shippedTemplates, "git");
    expect(forge).toEqual({ forge: "git", tool: "git", credentialHelper: null, delivery: "git-delivery", comment: null, createRepo: null, source: null });
    const d = await projectDefaults(shippedTemplates, { url: "git@git.example.com:team/app.git", account: "git-dev" }, "git");
    expect(d.rename).toMatchObject({ "github-pr": "git-delivery", "gitlab-mr": "git-delivery" });
    expect(d.rename).not.toHaveProperty("github-issue-comment");
    expect(d.rename).not.toHaveProperty("github-create-repo");
    expect(d.rename).not.toHaveProperty("github-issues");
  });

  it("instantiates GitLab nodes and a GitLab recipe in the project database", async () => {
    const { engine, call, close } = await apiProject();
    try {
      engine.configuration.write({ accounts: Accounts.parse({ accounts: [{
        id: repo.account, kind: "forge", forge: "gitlab", host: "gitlab.example.com", tool: "glab",
        user: "dev", author: { name: "Developer", email: "dev@example.com" },
      }] }) });
      await engine.reloadGlobal();
      const { ctx } = engine.project("demo");
      ctx.db.definition.write({ ...ctx.project, repo, recipes: undefined });
      await engine.reloadProject("demo");
      const r = await call("instantiate", { body: { kind: "recipe", name: "bugfix-to-pr", project: "demo" } });
      expect(ctx.db.catalog.recipe("bugfix-to-pr")?.nodes.pr?.use).toBe("gitlab-mr");
      expect(ctx.db.catalog.recipe("bugfix-to-pr")?.nodes.comment?.use).toBe("gitlab-issue-comment");
      expect(r.created).toContain("projects/demo/nodes/gitlab-mr.json");
      expect(r.created.some((path) => path.includes("github-"))).toBe(false);
    } finally {
      await close();
    }
  });
});
