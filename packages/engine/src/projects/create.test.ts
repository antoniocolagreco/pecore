import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoConfirm, forgeHome, forgeProject, until } from "../../test/forge-project";
import { ensureConfirmed } from "../definitions/confirm";
import { Engine } from "../main";
import { tempDir } from "../../test/tmp";
import { gitApp, gitAppIn } from "../workdir/git-as";
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
    await engine.createProject({ id: "fresh", name: "Fresh", repo: { url: "https://github.com/acme/fresh.git", account: "gh-test" }, createRepo: "github-create-repo" });
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
    await engine.createProject({ id: "dev", name: "Dev", repo: { url: "https://github.com/acme/dev.git", account: "gh-test" }, baseBranch: "develop", createRepo: "github-create-repo" });
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
      await engine.createProject({ id: "custom", name: "Custom", repo: { url: "https://github.com/acme/custom.git", account: "gh-test" }, createRepo: "github-create-repo" });
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
    await engine.createProject({ id: "fresh", name: "Fresh", repo: { url: "https://github.com/acme/fresh.git", account: "gh-test" }, createRepo: "github-create-repo" });
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
    await expect(engine.createProject({ id: "bad", name: "Bad", repo: { url: "https://gitlab.com/acme/x.git", account: "gh-test" } })).rejects.toThrow("step 1");
    expect(repoHost("git@github.com:acme/x.git")).toBe("github.com");
    await engine.shutdown();
  });

  it("creates a project with no recipes and no default recipe (decision 72)", async () => {
    const { home, library } = await forgeHome();
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "plain", name: "Plain", repo: null });
    const p = engine.project("plain");
    expect(p.ctx.defs.recipes.size).toBe(0);
    expect(p.ctx.project.defaultRecipe).toBeNull();
    await expect(engine.createJob("plain", { title: "Add a file", ticket: { text: "add a file" } })).rejects.toThrow("project plain has no default recipe; choose a recipe");
    await engine.shutdown();
  });
});

async function userRepo(folder: string, branch = "main"): Promise<string> {
  await mkdir(folder, { recursive: true });
  await gitAppIn(folder, ["init", "-q", "-b", branch]);
  await writeFile(join(folder, "readme.md"), "mine\n");
  await gitAppIn(folder, ["add", "readme.md"]);
  await gitAppIn(folder, ["commit", "-q", "-m", "Mine"]);
  return (await gitAppIn(folder, ["rev-parse", "HEAD"])).trim();
}

const folderHead = async (folder: string, branch: string) => (await gitAppIn(folder, ["rev-parse", `refs/heads/${branch}`])).trim();
const remotes = async (folder: string) => (await gitAppIn(folder, ["remote", "-v"])).trim();

describe("project folder (decision 75)", () => {
  it("a local-only project with a new folder gets a copy of its repository there, and the folder is repo.git's origin", async () => {
    const { home, library } = await forgeHome();
    const folder = join(await tempDir(), "code", "plain");
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "plain", name: "Plain", repo: null, folder });
    const repo = join(engine.project("plain").ctx.dir, "repo.git");
    expect(engine.project("plain").ctx.project.folder).toBe(folder);
    expect(await folderHead(folder, "main")).toBe(await branchHead(repo, "main"));
    expect(await remotes(folder)).toBe("");
    expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe(folder);
    await engine.shutdown();
  });

  it("a local-only project with an existing repository folder starts from its base branch", async () => {
    const { home, library } = await forgeHome();
    const folder = join(await tempDir(), "mine");
    const head = await userRepo(folder);
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "mine", name: "Mine", repo: null, folder: `${folder}/` });
    const repo = join(engine.project("mine").ctx.dir, "repo.git");
    expect(engine.project("mine").ctx.project.folder).toBe(folder);
    expect(await branchHead(repo, "main")).toBe(head);
    expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe(folder);
    await engine.shutdown();
  });

  it("expands ~ to the user's home", async () => {
    const { home, library } = await forgeHome();
    const user = await tempDir();
    const saved = process.env.HOME;
    process.env.HOME = user;
    try {
      const engine = await Engine.start({ home, library });
      await engine.createProject({ id: "tilde", name: "Tilde", repo: null, folder: "~/Projects/tilde" });
      expect(engine.project("tilde").ctx.project.folder).toBe(join(user, "Projects", "tilde"));
      expect(await exists(join(user, "Projects", "tilde", ".git"))).toBe(true);
      await engine.shutdown();
    } finally {
      process.env.HOME = saved;
    }
  });

  it("refuses a relative path, a file, a folder that is not a repository, and a repository without the base branch", async () => {
    const { home, library } = await forgeHome();
    const root = await tempDir();
    await writeFile(join(root, "file"), "x");
    await mkdir(join(root, "stuff"));
    await writeFile(join(root, "stuff", "notes.txt"), "x");
    await userRepo(join(root, "dev"), "dev");
    const engine = await Engine.start({ home, library });
    const create = (folder: string) => engine.createProject({ id: "bad", name: "Bad", repo: null, folder });
    await expect(create("code/bad")).rejects.toThrow("step 1: the folder code/bad is not an absolute path");
    await expect(create(join(root, "file"))).rejects.toThrow(`step 1: ${join(root, "file")} is not a folder`);
    await expect(create(join(root, "stuff"))).rejects.toThrow(`step 1: the folder ${join(root, "stuff")} is not empty and is not a Git repository`);
    await expect(create(join(root, "dev"))).rejects.toThrow(`step 1: the folder ${join(root, "dev")} has no branch main`);
    expect(engine.projects.has("bad")).toBe(false);
    await engine.shutdown();
  });

  it("an existing remote is cloned into an empty folder with the remote as its origin", async () => {
    const { forge, home, library } = await forgeHome();
    await forge.createRepo("acme/shop");
    const folder = join(await tempDir(), "shop");
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "shop", name: "Shop", repo: { url: "https://github.com/acme/shop.git", account: "gh-test" }, folder });
    expect(await folderHead(folder, "main")).toBe(forge.remoteHead("acme/shop", "main"));
    expect((await gitAppIn(folder, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/shop.git");
    const repo = join(engine.project("shop").ctx.dir, "repo.git");
    expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/shop.git");
    await engine.shutdown();
  });

  it("an existing remote leaves a folder that is already a clone untouched", async () => {
    const { forge, home, library } = await forgeHome();
    await forge.createRepo("acme/shop");
    const folder = join(await tempDir(), "shop");
    const head = await userRepo(folder, "work");
    await gitAppIn(folder, ["remote", "add", "origin", "git@github.com:acme/shop.git"]);
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "shop", name: "Shop", repo: { url: "https://github.com/acme/shop.git", account: "gh-test" }, folder });
    expect(await folderHead(folder, "work")).toBe(head);
    expect((await gitAppIn(folder, ["config", "remote.origin.url"])).trim()).toBe("git@github.com:acme/shop.git");
    await engine.shutdown();
  });

  it("a new remote gets the code of an existing repository folder, which gets the remote as origin", async () => {
    const { forge, home, library } = await forgeHome();
    const folder = join(await tempDir(), "fresh");
    const head = await userRepo(folder);
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "fresh", name: "Fresh", repo: { url: "https://github.com/acme/fresh.git", account: "gh-test" }, createRepo: "github-create-repo", folder });
    const p = engine.project("fresh");
    const stop = autoConfirm(engine, "fresh");
    await until(async () => !(await exists(join(p.ctx.dir, "creating.json"))));
    expect(forge.remoteHead("acme/fresh", "main")).toBe(head);
    expect((await gitAppIn(folder, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/fresh.git");
    expect((await gitApp(join(p.ctx.dir, "repo.git"), ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/fresh.git");
    stop();
    await engine.shutdown();
  });

  it("a new remote with a new folder: the folder gets the pushed base branch after the remote exists", async () => {
    const { forge, home, library } = await forgeHome();
    const folder = join(await tempDir(), "fresh");
    const engine = await Engine.start({ home, library });
    await engine.createProject({ id: "fresh", name: "Fresh", repo: { url: "https://github.com/acme/fresh.git", account: "gh-test" }, createRepo: "github-create-repo", folder });
    const p = engine.project("fresh");
    expect(await exists(folder)).toBe(false);
    const stop = autoConfirm(engine, "fresh");
    await until(async () => !(await exists(join(p.ctx.dir, "creating.json"))));
    expect(await folderHead(folder, "main")).toBe(forge.remoteHead("acme/fresh", "main"));
    expect((await gitAppIn(folder, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/fresh.git");
    stop();
    await engine.shutdown();
  });
});
