import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { instantiateRecipe } from "../definitions/instantiate";
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
    const project = await tempDir();
    expect((await instantiateRecipe(shippedTemplates, project, "feature-to-pr", d.rename)).errors).toEqual([]);
    const feature = JSON.parse(await readFile(join(project, "recipes", "feature-to-pr.json"), "utf8"));
    expect(feature.nodes.pr.use).toBe("git-delivery");
  });

  it("instantiating a recipe with the rename map writes the GitLab node and recipe", async () => {
    const project = await tempDir();
    const d = await projectDefaults(shippedTemplates, repo, "gitlab");
    const r = await instantiateRecipe(shippedTemplates, project, "bugfix-to-pr", d.rename);
    expect(r.errors).toEqual([]);
    const recipe = JSON.parse(await readFile(join(project, "recipes", "bugfix-to-pr.json"), "utf8"));
    expect(recipe.nodes.pr.use).toBe("gitlab-mr");
    expect(recipe.nodes.comment.use).toBe("gitlab-issue-comment");
    expect(r.written).toContain(join(project, "nodes", "gitlab-mr.json"));
    expect(r.written.some((f) => f.includes("github-"))).toBe(false);
  });
});
