import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { instantiateRecipe } from "../definitions/instantiate";
import { loadForgeDefaults, projectDefaults } from "./defaults";

const repo = { url: "https://gitlab.example.com/acme/shop.git", account: "work-gitlab" };

describe("project defaults (decision 8)", () => {
  it("a local project gets only local-only and no forge", async () => {
    const d = await projectDefaults(shippedLibrary, null, null);
    expect(d.recipes).toEqual(["local-only"]);
    expect(d.forge).toBeNull();
    expect(d.rename).toEqual({});
  });

  it("a GitLab project maps every GitHub template to its GitLab one", async () => {
    const d = await projectDefaults(shippedLibrary, repo, "gitlab");
    expect(d.recipes).toEqual(["feature", "bugfix", "local-only"]);
    expect(d.rename).toMatchObject({
      "github-pr": "gitlab-mr",
      "github-issue-comment": "gitlab-issue-comment",
      "github-create-repo": "gitlab-create-repo",
      "github-issues": "gitlab-issues",
      "gitlab-mr": "gitlab-mr",
    });
    expect(d.nodes).toEqual(expect.arrayContaining(["gitlab-mr", "gitlab-issue-comment", "gitlab-create-repo", "gitlab-issues", "git-push"]));
    expect(d.nodes.filter((n) => n.startsWith("github-"))).toEqual([]);
  });

  it("only the selected recipes are kept", async () => {
    const d = await projectDefaults(shippedLibrary, repo, "github", ["bugfix"]);
    expect(d.recipes).toEqual(["bugfix"]);
    expect(d.nodes).toContain("github-issue-comment");
  });

  it("a repository project needs a forge, and the forge file must match its name", async () => {
    await expect(projectDefaults(shippedLibrary, repo, null)).rejects.toThrow("needs a forge");
    await expect(loadForgeDefaults(shippedLibrary, "bitbucket")).rejects.toThrow();
    expect((await loadForgeDefaults(shippedLibrary, "github")).credentialHelper).toBe("!gh auth git-credential");
  });

  it("a private Git server project delivers the pushed branch, skips the ticket comment, and has no repo creation or ticket source", async () => {
    const forge = await loadForgeDefaults(shippedLibrary, "git");
    expect(forge).toEqual({ forge: "git", tool: "git", credentialHelper: null, delivery: "git-delivery", comment: "git-no-comment", createRepo: null, source: null });
    const d = await projectDefaults(shippedLibrary, { url: "git@git.example.com:team/app.git", account: "git-dev" }, "git");
    expect(d.rename).toMatchObject({ "github-pr": "git-delivery", "gitlab-mr": "git-delivery", "github-issue-comment": "git-no-comment", "gitlab-issue-comment": "git-no-comment" });
    expect(d.rename).not.toHaveProperty("github-create-repo");
    expect(d.rename).not.toHaveProperty("github-issues");
    expect(d.nodes).toEqual(expect.arrayContaining(["git-delivery", "git-no-comment", "git-push"]));
    expect(d.nodes.filter((n) => n.startsWith("github-") || n.startsWith("gitlab-"))).toEqual([]);
    const project = await tempDir();
    for (const name of ["feature", "bugfix"]) expect((await instantiateRecipe(shippedLibrary, project, name, d.rename)).errors).toEqual([]);
    const bugfix = JSON.parse(await readFile(join(project, "recipes", "bugfix.json"), "utf8"));
    expect(bugfix.nodes.pr.use).toBe("git-delivery");
    expect(bugfix.nodes.comment.use).toBe("git-no-comment");
  });

  it("instantiating a recipe with the rename map writes the GitLab node and recipe", async () => {
    const project = await tempDir();
    const d = await projectDefaults(shippedLibrary, repo, "gitlab");
    const r = await instantiateRecipe(shippedLibrary, project, "bugfix", d.rename);
    expect(r.errors).toEqual([]);
    const recipe = JSON.parse(await readFile(join(project, "recipes", "bugfix.json"), "utf8"));
    expect(recipe.nodes.pr.use).toBe("gitlab-mr");
    expect(recipe.nodes.comment.use).toBe("gitlab-issue-comment");
    expect(r.written).toContain(join(project, "nodes", "gitlab-mr.json"));
    expect(r.written.some((f) => f.includes("github-"))).toBe(false);
  });
});
