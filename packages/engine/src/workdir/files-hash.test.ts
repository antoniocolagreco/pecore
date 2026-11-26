import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { appUser } from "../runners/process";
import { filesHash, deleteScratch, recordGit, restoreState, undoInterrupted } from "./files-hash";
import { gitWork } from "./git-as";
import { branchHead, createLocalRepo } from "./repo";
import { addWorktree, removeWorktree } from "./worktrees";

const u = appUser;

async function setup() {
  const project = await tempDir();
  const repo = join(project, "repo.git");
  const base = await createLocalRepo(repo, "main");
  const wd = await addWorktree(u, project, "J1", base);
  return { project, repo, base, wd };
}

describe("repo.git", () => {
  it("starts with one empty commit on the base branch and excludes .pecore/", async () => {
    const { repo, base } = await setup();
    expect(await branchHead(repo, "main")).toBe(base);
    expect(await readFile(join(repo, "info", "exclude"), "utf8")).toContain(".pecore/\n");
    expect(await branchHead(repo, "factory/J1")).toBe(base);
  });
});

describe("content state", () => {
  it("covers tracked and untracked files, not ignored files or .pecore/", async () => {
    const { wd } = await setup();
    const empty = await filesHash(u, wd);
    expect(empty).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    await writeFile(join(wd, ".gitignore"), "node_modules/\n");
    await writeFile(join(wd, "a.txt"), "a");
    const s1 = await filesHash(u, wd);
    await mkdir(join(wd, "node_modules"));
    await writeFile(join(wd, "node_modules", "x.js"), "x");
    await mkdir(join(wd, ".pecore"));
    await writeFile(join(wd, ".pecore", "output.json"), "{}");
    expect(await filesHash(u, wd)).toBe(s1);
    await writeFile(join(wd, "a.txt"), "b");
    expect(await filesHash(u, wd)).not.toBe(s1);
  });

  it("does not touch the worktree index", async () => {
    const { wd } = await setup();
    await writeFile(join(wd, "a.txt"), "a");
    await filesHash(u, wd);
    expect((await gitWork(u, wd, ["status", "--porcelain"])).trim()).toBe("?? a.txt");
  });

  it("restores a previous state: changed, added and deleted files", async () => {
    const { wd } = await setup();
    await writeFile(join(wd, "keep.txt"), "1");
    await writeFile(join(wd, "gone.txt"), "1");
    const before = await filesHash(u, wd);
    await writeFile(join(wd, "keep.txt"), "2");
    await writeFile(join(wd, "new.txt"), "x");
    await gitWork(u, wd, ["rm", "-q", "--cached", "--ignore-unmatch", "gone.txt"]);
    await writeFile(join(wd, "gone.txt"), "changed");
    await restoreState(u, wd, before);
    expect(await filesHash(u, wd)).toBe(before);
    expect((await readdir(wd)).filter((f) => f !== ".git").sort()).toEqual(["gone.txt", "keep.txt"]);
    expect(await readFile(join(wd, "keep.txt"), "utf8")).toBe("1");
  });

  it("deletes only new files that match scratchPaths", async () => {
    const { wd } = await setup();
    await mkdir(join(wd, "coverage"));
    await writeFile(join(wd, "coverage", "old.json"), "");
    const before = await filesHash(u, wd);
    await writeFile(join(wd, "coverage", "new.json"), "");
    await writeFile(join(wd, "x.tmp"), "");
    await writeFile(join(wd, "src.ts"), "");
    const deleted = await deleteScratch(u, wd, ["coverage/**", "**/*.tmp"], before);
    expect(deleted.sort()).toEqual(["coverage/new.json", "x.tmp"]);
    expect((await readdir(join(wd, "coverage")))).toEqual(["old.json"]);
  });

  it("undoes a commit made by an interrupted run", async () => {
    const { wd } = await setup();
    await writeFile(join(wd, "a.txt"), "a");
    const rec = await recordGit(u, wd, "J1");
    const before = await filesHash(u, wd);
    await gitWork(u, wd, ["add", "-A"]);
    await gitWork(u, wd, ["commit", "-q", "-m", "x"]);
    await writeFile(join(wd, "b.txt"), "b");
    await undoInterrupted(u, wd, "J1", rec, before);
    expect(await recordGit(u, wd, "J1")).toEqual(rec);
    expect(await filesHash(u, wd)).toBe(before);
  });

  it("removes a worktree", async () => {
    const { project, wd } = await setup();
    await removeWorktree(u, project, wd);
    await expect(readdir(wd)).rejects.toThrow();
  });
});
