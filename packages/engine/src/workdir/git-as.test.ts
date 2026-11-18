import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { appUser } from "../runners/process";
import { gitApp, gitWork } from "./git-as";
import { createLocalRepo } from "./repo";
import { addWorktree } from "./worktrees";

const u = appUser;

async function setup() {
  const project = await tempDir();
  const repo = join(project, "repo.git");
  const base = await createLocalRepo(repo, "main");
  const wd = await addWorktree(u, project, "J1", base);
  const marker = join(await tempDir(), "ran");
  const evil = `#!/bin/sh\necho ran >> ${marker}\n`;
  return { project, repo, base, wd, marker, evil };
}

async function ran(marker: string): Promise<boolean> {
  return readFile(marker, "utf8").then(
    () => true,
    () => false,
  );
}

describe("git-as", () => {
  it("never runs repository hooks, in app-user or work-tree commands", async () => {
    const { repo, wd, marker, evil } = await setup();
    for (const hook of ["pre-commit", "post-commit", "reference-transaction", "post-checkout"]) {
      await writeFile(join(repo, "hooks", hook), evil);
      await chmod(join(repo, "hooks", hook), 0o755);
    }
    await writeFile(join(wd, "a.txt"), "a");
    await gitWork(u, wd, ["add", "-A"]);
    await gitWork(u, wd, ["commit", "-q", "-m", "x"]);
    await gitApp(repo, ["update-ref", "refs/heads/other", "refs/heads/main"]);
    expect(await ran(marker)).toBe(false);
  });

  it("ignores core.fsmonitor set in the repository config", async () => {
    const { repo, wd, marker, evil } = await setup();
    const fsmonitor = join(await tempDir(), "fsmonitor");
    await writeFile(fsmonitor, evil);
    await chmod(fsmonitor, 0o755);
    await gitApp(repo, ["config", "core.fsmonitor", fsmonitor]);
    await gitWork(u, wd, ["status", "--porcelain"]);
    await gitApp(repo, ["log", "-1"]);
    expect(await ran(marker)).toBe(false);
  });

  it("an app-user command reads repo.git, not a forged commondir of the worktree", async () => {
    const { repo, marker, evil } = await setup();
    const forged = await tempDir();
    await mkdir(join(forged, "hooks"));
    await writeFile(join(forged, "config"), `[core]\n\tsshCommand = ${marker}\n\tfsmonitor = ${marker}\n`);
    await writeFile(join(forged, "hooks", "reference-transaction"), evil);
    await writeFile(join(repo, "worktrees", "J1", "commondir"), forged + "\n");
    expect((await gitApp(repo, ["config", "--get", "core.sshCommand"]).catch(() => "")).trim()).toBe("");
    await gitApp(repo, ["update-ref", "refs/heads/x", "refs/heads/main"]);
    expect(await ran(marker)).toBe(false);
  });
});
