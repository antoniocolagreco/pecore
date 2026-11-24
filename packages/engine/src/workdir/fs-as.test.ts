import { mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandNode } from "@pecore/schemas";
import { tempDir } from "../../test/tmp";
import { outcomeOutputs, runCommandNode } from "../runners/command";
import { appUser } from "../runners/process";
import { contentState, deleteScratch } from "./content-state";
import { FsAsError, readFileAs, removeFilesAs, writeFileAs } from "./fs-as";
import { createLocalRepo } from "./repo";
import { addWorktree } from "./worktrees";

const u = appUser;

async function setup() {
  const project = await tempDir();
  const base = await createLocalRepo(join(project, "repo.git"), "main");
  const wd = await addWorktree(u, project, "J1", base);
  const secretDir = await tempDir();
  const secret = join(secretDir, "token");
  await writeFile(secret, "token");
  return { project, base, wd, secretDir, secret };
}

describe("fs-as: symlinks at every engine file path", () => {
  it("refuses to read or write through a symlink at the path or in a parent, and paths outside the root", async () => {
    const { wd, secret, secretDir } = await setup();
    await symlink(secret, join(wd, "out.json"));
    await expect(readFileAs(u, wd, "out.json")).rejects.toBeInstanceOf(FsAsError);
    await expect(writeFileAs(u, wd, "out.json", "x")).rejects.toMatchObject({ reason: "symlink" });
    await symlink(secretDir, join(wd, ".pecore"));
    await expect(writeFileAs(u, wd, ".pecore/output.schema.json", "x")).rejects.toMatchObject({ reason: "symlink" });
    await expect(readFileAs(u, wd, "../token")).rejects.toMatchObject({ reason: "outside" });
    expect(await readFile(secret, "utf8")).toBe("token");
  });

  it("command stdin leaves a planted .pecore/inputs symlink and its target alone", async () => {
    const { wd, base, project, secret } = await setup();
    await mkdir(join(wd, ".pecore"));
    const link: string = join(wd, ".pecore", "inputs");
    await symlink(secret, link);
    const node = CommandNode.parse({ name: "c", description: "c", kind: "command", command: ["cat"], inputs: ["text"], outcomes: ["passed"], changesFiles: false, outcomeRules: [{ exitCode: 0, outcome: "passed" }], timeoutSec: 10 });
    await expect(
      runCommandNode({
        node,
        outputs: outcomeOutputs(node),
        nodeDir: project,
        params: {},
        user: u,
        workdir: wd,
        context: { job: { id: "J1", title: "t", branch: "factory/J1", base, oldBase: base, target: "main", commit: null }, ticketId: null, project: { repoDir: join(project, "repo.git"), repoUrl: null, baseBranch: "main" } },
        inputs: [{ type: "text", content: "input" }],
        cleanTree: null,
      }),
    ).resolves.toMatchObject({ kind: "completed", log: expect.stringContaining('{"text":"input"}') });
    expect(await readlink(link)).toBe(secret);
    expect(await readFile(secret, "utf8")).toBe("token");
  });

  it("output read: outputRules.file through a symlink fails the node", async () => {
    const { wd, base, project, secret } = await setup();
    await symlink(secret, join(wd, "result.json"));
    const node = CommandNode.parse({ name: "c", description: "c", kind: "command", command: ["true"], outputs: { passed: "findings" }, outputRules: { passed: { file: "result.json" } }, outcomes: ["passed"], changesFiles: false, outcomeRules: [{ exitCode: 0, outcome: "passed" }], timeoutSec: 10 });
    const r = await runCommandNode({
      node,
      outputs: outcomeOutputs(node),
      nodeDir: project,
      params: {},
      user: u,
      workdir: wd,
      context: { job: { id: "J1", title: "t", branch: "factory/J1", base, oldBase: base, target: "main", commit: null }, ticketId: null, project: { repoDir: join(project, "repo.git"), repoUrl: null, baseBranch: "main" } },
      inputs: [],
      cleanTree: null,
    });
    expect(r).toMatchObject({ kind: "failed", reason: "HARNESS_ERROR" });
    expect(r.log).not.toContain("token");
  });

  it("scratch delete: removes a planted symlink, never its target", async () => {
    const { wd, secret } = await setup();
    const before = await contentState(u, wd);
    await symlink(secret, join(wd, "x.tmp"));
    expect(await deleteScratch(u, wd, ["*.tmp"], before)).toEqual(["x.tmp"]);
    expect(await readFile(secret, "utf8")).toBe("token");
  });

  it("removeFilesAs does not follow a symlinked directory", async () => {
    const { wd, secretDir, secret } = await setup();
    await symlink(secretDir, join(wd, "dir"));
    await expect(removeFilesAs(u, wd, ["dir/token"])).rejects.toBeInstanceOf(FsAsError);
    expect(await readFile(secret, "utf8")).toBe("token");
  });

  it("writes and reads files under the root", async () => {
    const { wd } = await setup();
    await writeFileAs(u, wd, ".pecore/output.json", '{"a":1}');
    expect(await readFileAs(u, wd, ".pecore/output.json")).toBe('{"a":1}');
    await expect(readFileAs(u, wd, "missing.json")).rejects.toMatchObject({ reason: "missing" });
  });
});
