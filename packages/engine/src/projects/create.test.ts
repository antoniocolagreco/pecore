import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoConfirm, forgeHome, forgeProject, until } from "../../test/forge-project";
import { ensureConfirmed } from "../definitions/confirm";
import { Engine } from "../main";
import { gitApp } from "../workdir/git-as";
import { branchHead } from "../workdir/repo";
import { repoHost } from "./create";

const exists = (path: string) => stat(path).then(
  () => true,
  () => false,
);

describe("project creation with a remote (section Project creation, decision 13)", () => {
  it("clones an existing remote into repo.git with the PeCore config and origin", async () => {
    const { forge, engine, stopConfirm } = await forgeProject();
    const p = engine.project("shop");
    const repo = join(p.ctx.dir, "repo.git");
    expect(await branchHead(repo, "main")).toBe(forge.remoteHead("acme/shop", "main"));
    expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/shop.git");
    expect((await gitApp(repo, ["config", "core.sharedRepository"])).trim()).toBe("group");
    expect(await exists(join(p.ctx.dir, "creating.json"))).toBe(false);
    expect(await exists(join(p.ctx.dir, "nodes", "github-pr.json"))).toBe(true);
    stopConfirm();
    await engine.shutdown();
  });

  it("a new remote is created by the createRepo node in the project-setup job, then set as origin", async () => {
    const { forge, home, library } = await forgeHome();
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "fresh", name: "Fresh", repo: { url: "https://github.com/acme/fresh.git", account: "gh-test" }, createRepo: "github-create-repo", defaultRecipe: "deliver" }, ["deliver"]);
    const p = engine.project("fresh");
    expect(JSON.parse(await readFile(join(p.ctx.dir, "creating.json"), "utf8"))).toMatchObject({ step: 3 });
    const stop = autoConfirm(engine, "fresh");
    await until(async () => !(await exists(join(p.ctx.dir, "creating.json"))));
    const repo = join(p.ctx.dir, "repo.git");
    expect(forge.remoteHead("acme/fresh", "main")).toBe(await branchHead(repo, "main"));
    expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/fresh.git");
    expect(await branchHead(repo, "factory/project-setup")).toBeNull();
    expect(engine.creating.has("fresh")).toBe(false);
    stop();
    await engine.shutdown();
  });

  it("a new remote gets the project's base branch, not main", async () => {
    const { forge, home, library } = await forgeHome();
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "dev", name: "Dev", repo: { url: "https://github.com/acme/dev.git", account: "gh-test" }, baseBranch: "develop", createRepo: "github-create-repo", defaultRecipe: "deliver" }, ["deliver"]);
    const p = engine.project("dev");
    const stop = autoConfirm(engine, "dev");
    await until(async () => !(await exists(join(p.ctx.dir, "creating.json"))));
    expect(forge.remoteHead("acme/dev", "develop")).toBe(await branchHead(join(p.ctx.dir, "repo.git"), "develop"));
    expect(forge.remoteHead("acme/dev", "main")).toBeNull();
    stop();
    await engine.shutdown();
  });

  it("asks for confirmation when the repository setup script differs from the shipped script", async () => {
    const { forge, home, library } = await forgeHome();
    const engine = await Engine.start({ home, library });
    try {
      await appendFile(join(home, "library", "nodes", "github-create-repo.sh"), "\nprintf 'custom setup\\n'\n");
      await engine.createProject({ id: "custom", name: "Custom", repo: { url: "https://github.com/acme/custom.git", account: "gh-test" }, createRepo: "github-create-repo", defaultRecipe: "deliver" }, ["deliver"]);
      const { ctx } = engine.project("custom");
      const node = ctx.defs.nodes.get("github-create-repo")!;
      expect(await ensureConfirmed(ctx.db, "project-setup", join(ctx.dir, "nodes"), node)).toMatchObject({ confirmed: false });
      expect(ctx.db.db.prepare("SELECT sha256 FROM confirmed_hashes WHERE path = ?").get("nodes/github-create-repo.json")).toBeUndefined();
      expect((await forge.state()).repos).not.toContain("acme/custom");
    } finally {
      await engine.shutdown();
    }
  });

  it("cancel removes a project whose creation waits for the forge", async () => {
    const { forge, home, library } = await forgeHome();
    await forge.set({ offline: true });
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "fresh", name: "Fresh", repo: { url: "https://github.com/acme/fresh.git", account: "gh-test" }, createRepo: "github-create-repo", defaultRecipe: "deliver" }, ["deliver"]);
    const p = engine.project("fresh");
    const stop = autoConfirm(engine, "fresh");
    await until(() => p.executor.job("project-setup").waiting_reason === "network");
    stop();
    const dir = p.ctx.dir;
    await engine.cancelCreation("fresh");
    expect(await exists(dir)).toBe(false);
    expect(engine.projects.has("fresh")).toBe(false);
    await engine.shutdown();
  });

  it("refuses an account that does not match the repository host", async () => {
    const { home, library } = await forgeHome();
    const engine = await Engine.start({ home, library });
    await expect(engine.createProject({ id: "bad", name: "Bad", repo: { url: "https://gitlab.com/acme/x.git", account: "gh-test" }, defaultRecipe: "deliver" }, ["deliver"])).rejects.toThrow("step 1");
    expect(repoHost("git@github.com:acme/x.git")).toBe("github.com");
    await engine.shutdown();
  });
});
