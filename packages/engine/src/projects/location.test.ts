import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { setTestConfiguration } from "../../test/configuration";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { Project } from "@pecore/schemas";
import type { Accounts } from "@pecore/schemas";
import { forgeAccount } from "../../test/fake-forge";
import { forgeHome } from "../../test/forge-project";
import { definitionOperations } from "../api/routes/definitions";
import { Engine } from "../main";
import { gitApp, gitAppIn, gitAppResult } from "../workdir/git-as";
import { branchHead, jobBranch } from "../workdir/repo";

const params = { path: "projects/demo/project.json" };

async function save(engine: Engine, changes: Partial<Project>): Promise<void> {
  const { getDefinition, saveDefinition } = definitionOperations(engine).handlers;
  const file = await getDefinition({ params, query: undefined, body: undefined });
  const content: string = JSON.stringify({ ...Project.parse(JSON.parse(file.content)), ...changes });
  await saveDefinition({ params, query: undefined, body: { content, baseSha256: file.sha256 } });
}

describe("project repository and checkout settings", () => {
  it("adds, switches and detaches a remote, while preserving the moved checkout and existing job refs", async () => {
    const { forge, home, templates } = await forgeHome();
    const accounts: Accounts = { accounts: [forgeAccount, {
      id: "private-git", kind: "forge", forge: "git", host: "git.example.test", tool: "git", user: "tester",
      author: { name: "Test", email: "test@example.com" },
    }] };
    await setTestConfiguration(home, "accounts", accounts);
    await appendFile(join(forge.dir, "home", ".gitconfig"), "\tinsteadOf = https://git.example.test/\n");
    await forge.createRepo("acme/first");
    await forge.createRepo("acme/second");
    const second: string = forge.advance("acme/second", "main", "second.txt");
    const folder: string = join(dirname(home), "checkout");
    const destination: string = join(dirname(home), "moved");
    const engine: Engine = await Engine.start({ home, templates });
    try {
      await engine.createProject({ id: "demo", name: "Demo", repo: null, folder });
      const repo: string = join(engine.projectDir("demo"), "repo.git");
      const local: string = (await gitApp(repo, ["rev-parse", "main"])).trim();
      await gitApp(repo, ["update-ref", `refs/heads/${jobBranch("history")}`, local]);
      await writeFile(join(folder, "untracked.txt"), "uncommitted change");
      await save(engine, { repo: { url: "https://github.com/acme/first.git", account: "gh-test" } });
      expect((await gitAppIn(folder, ["config", "remote.origin.url"])).trim()).toBe("https://github.com/acme/first.git");

      await mkdir(destination);
      await save(engine, { folder: destination, repo: { url: "https://git.example.test/acme/second.git", account: "private-git" } });
      expect(await branchHead(repo, "main")).toBe(second);
      expect(await branchHead(repo, jobBranch("history"))).toBe(local);
      expect(await readFile(join(destination, "untracked.txt"), "utf8")).toBe("uncommitted change");
      expect((await gitAppIn(destination, ["config", "remote.origin.url"])).trim()).toBe("https://git.example.test/acme/second.git");
      expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe("https://git.example.test/acme/second.git");
      await expect(readdir(folder)).rejects.toMatchObject({ code: "ENOENT" });

      await save(engine, { repo: null });
      expect(engine.project("demo").ctx.project).toMatchObject({ repo: null, folder: destination });
      expect((await gitApp(repo, ["config", "remote.origin.url"])).trim()).toBe(destination);
      expect((await gitAppIn(destination, ["remote"])).trim()).toBe("");
      expect(await branchHead(repo, "main")).toBe(local);
      expect(forge.remoteHead("acme/second", "main")).toBe(second);
    } finally {
      await engine.shutdown();
    }
  });

  it("keeps the original checkout and repository when a save fails", async () => {
    const { forge, home, templates } = await forgeHome();
    await forge.createRepo("acme/first");
    const folder: string = join(dirname(home), "checkout");
    const destination: string = join(dirname(home), "destination");
    const engine: Engine = await Engine.start({ home, templates });
    try {
      await engine.createProject({ id: "demo", name: "Demo", repo: null, folder });
      const repo: string = join(engine.projectDir("demo"), "repo.git");
      await writeFile(join(folder, "keep.txt"), "keep this file");
      await mkdir(destination);
      await writeFile(join(destination, "existing.txt"), "do not overwrite");
      await expect(save(engine, { folder: destination })).rejects.toThrow("Choose an empty destination folder");
      await rm(join(destination, "existing.txt"));

      const { db } = engine.project("demo").ctx;
      const before = db.definition.read();
      const head: string | null = await branchHead(repo, "main");
      db.db.exec(`CREATE TRIGGER fail_project_write BEFORE INSERT ON project_definition
        BEGIN SELECT RAISE(ABORT, 'could not save project'); END`);
      await expect(save(engine, { folder: destination, repo: { url: "https://github.com/acme/first.git", account: "gh-test" } })).rejects.toThrow("could not save project");
      expect(db.definition.read()).toEqual(before);
      expect(await branchHead(repo, "main")).toBe(head);
      expect((await gitAppResult(repo, ["config", "remote.origin.url"])).stdout.trim()).toBe(folder);
      expect((await gitAppIn(folder, ["remote"])).trim()).toBe("");
      expect(await readFile(join(folder, "keep.txt"), "utf8")).toBe("keep this file");
      expect(await readdir(destination)).toEqual([]);
    } finally {
      await engine.shutdown();
    }
  });
});
