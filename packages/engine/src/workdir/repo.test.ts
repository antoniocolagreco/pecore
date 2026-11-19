import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { gitApp } from "./git-as";
import { branchHead, cloneRepo, createLocalRepo, fetchBranch } from "./repo";

async function commitOn(repo: string, branch: string, parent: string, message: string): Promise<string> {
  const tree = (await gitApp(repo, ["mktree"], { input: "" })).trim();
  const commit = (await gitApp(repo, ["commit-tree", tree, "-p", parent, "-m", message])).trim();
  await gitApp(repo, ["update-ref", `refs/heads/${branch}`, commit]);
  return commit;
}

describe("clone and fetch", () => {
  it("clones bare with the PeCore config and a remote-tracking refspec", async () => {
    const origin = join(await tempDir(), "origin.git");
    const base = await createLocalRepo(origin, "main");
    const repo = join(await tempDir(), "p", "repo.git");
    await cloneRepo(repo, origin, null, {});
    expect(await branchHead(repo, "main")).toBe(base);
    expect((await gitApp(repo, ["config", "remote.origin.fetch"])).trim()).toBe("+refs/heads/*:refs/remotes/origin/*");
    expect((await gitApp(repo, ["config", "gc.auto"])).trim()).toBe("0");
    expect((await gitApp(repo, ["config", "core.sharedRepository"])).trim()).toBe("group");
  });

  it("fetchBranch force-updates the local branch to the remote one", async () => {
    const origin = join(await tempDir(), "origin.git");
    const base = await createLocalRepo(origin, "main");
    const repo = join(await tempDir(), "repo.git");
    await cloneRepo(repo, origin, null, {});
    const next = await commitOn(origin, "main", base, "next");
    await commitOn(repo, "main", base, "local");
    await fetchBranch(repo, "main", null, {});
    expect(await branchHead(repo, "main")).toBe(next);
  });

  it("fetchBranch rejects invalid branch names", async () => {
    const origin = join(await tempDir(), "origin.git");
    await createLocalRepo(origin, "main");
    const repo = join(await tempDir(), "repo.git");
    await cloneRepo(repo, origin, null, {});
    await expect(fetchBranch(repo, "bad..name", null, {})).rejects.toThrow();
  });
});
