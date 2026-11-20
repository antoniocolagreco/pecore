import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { commitDefinition, commitMessage, git } from "./git-commit";
import { homePaths, initHome, syncAdapters } from "./layout";

describe("PECORE_HOME layout", () => {
  it("initialises a new home: git repo, run/ 0700, schemas, library, one commit", async () => {
    const home = join(await tempDir(), "home");
    expect(await initHome(home, { library: shippedLibrary })).toEqual({ created: true });
    const p = homePaths(home);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(p.run)).mode & 0o777).toBe(0o700);
    expect((await readdir(p.schemas)).sort()).toContain("node.json");
    expect(await readdir(p.libraryNodes)).toContain("git-commit.json");
    expect((await git(home, ["log", "--format=%s"])).trim()).toBe("home: created");
    expect(await git(home, ["status", "--porcelain"])).toBe("");
    expect(await readFile(join(home, ".gitignore"), "utf8")).toContain("projects/*/work/");
  });

  it("does not commit again on a second start and rewrites the schemas", async () => {
    const home = join(await tempDir(), "home");
    await initHome(home, { library: shippedLibrary });
    await writeFile(join(homePaths(home).schemas, "node.json"), "{}");
    expect(await initHome(home, { library: shippedLibrary })).toEqual({ created: false });
    expect((await git(home, ["log", "--format=%s"])).trim().split("\n")).toHaveLength(1);
    expect(await readFile(join(homePaths(home).schemas, "node.json"), "utf8")).not.toBe("{}");
  });

  it("adds library files a newer app ships to an existing home in one commit, without touching files the user changed", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const shipped = join(root, "shipped");
    await mkdir(join(shipped, "nodes"), { recursive: true });
    await mkdir(join(shipped, "forges"), { recursive: true });
    await writeFile(join(shipped, "nodes", "a.json"), "shipped a\n");
    await initHome(home, { library: shipped });
    await writeFile(join(homePaths(home).library, "nodes", "a.json"), "edited a\n");
    await git(home, ["commit", "-q", "-am", "node a: edited"]);
    await writeFile(join(shipped, "nodes", "a.json"), "shipped a v2\n");
    await writeFile(join(shipped, "nodes", "b.sh"), "echo b\n");
    await writeFile(join(shipped, "forges", "git.json"), "{}\n");
    expect(await initHome(home, { library: shipped })).toEqual({ created: false });
    expect(await readFile(join(homePaths(home).library, "nodes", "a.json"), "utf8")).toBe("edited a\n");
    expect(await readFile(join(homePaths(home).library, "nodes", "b.sh"), "utf8")).toBe("echo b\n");
    expect(await readFile(join(homePaths(home).library, "forges", "git.json"), "utf8")).toBe("{}\n");
    expect((await git(home, ["log", "--format=%s"])).trim().split("\n")).toEqual(["library: add 2 shipped files", "node a: edited", "home: created"]);
    expect(await git(home, ["status", "--porcelain"])).toBe("");
    await initHome(home, { library: shipped });
    expect((await git(home, ["log", "--format=%s"])).trim().split("\n")).toHaveLength(3);
  });

  it("ignores databases and work directories in git", async () => {
    const home = join(await tempDir(), "home");
    await initHome(home, { library: shippedLibrary });
    const project = join(home, "projects", "demo");
    await mkdir(join(project, "work", "job"), { recursive: true });
    await writeFile(join(project, "pecore.db"), "");
    await writeFile(join(project, "work", "job", "a.txt"), "");
    await writeFile(join(project, "project.json"), "{}");
    expect((await git(home, ["status", "--porcelain", "--untracked-files=all"])).trim()).toBe("?? projects/demo/project.json");
  });

  it("commits one definition change with the design message", async () => {
    const home = join(await tempDir(), "home");
    await initHome(home, { library: shippedLibrary });
    const file = join(homePaths(home).libraryNodes, "typecheck.json");
    await writeFile(file, (await readFile(file, "utf8")).replace("600", "900"));
    expect(await commitDefinition(home, [file], commitMessage("node", "typecheck", "edited"))).toBe(true);
    expect((await git(home, ["log", "-1", "--format=%s"])).trim()).toBe("node typecheck: edited");
    expect(await commitDefinition(home, [file], commitMessage("node", "typecheck", "edited"))).toBe(false);
  });

  it("copies adapters when the app version changes and removes unpinned ones", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const source = join(root, "adapters");
    await mkdir(join(source, "a@1"), { recursive: true });
    await mkdir(join(source, "node", "bin"), { recursive: true });
    await writeFile(join(source, "node", "bin", "node"), "", { mode: 0o755 });
    await mkdir(join(home, "adapters", "a@0"), { recursive: true });
    expect(await syncAdapters(home, { source, appVersion: "1.0.0", pinned: ["a@1"] })).toBe(true);
    expect((await readdir(join(home, "adapters"))).sort()).toEqual(["a@1", "node", "version"]);
    expect((await stat(join(home, "adapters", "node", "bin", "node"))).mode & 0o777).toBe(0o755);
    expect(await syncAdapters(home, { source, appVersion: "1.0.0", pinned: ["a@1"] })).toBe(false);
  });

  it("makes the copied adapters readable by every user even when the app's own copy is private, keeping executables executable", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const source = join(root, "adapters");
    await mkdir(join(source, "a@1", "dist"), { recursive: true, mode: 0o700 });
    await mkdir(join(source, "node", "bin"), { recursive: true, mode: 0o700 });
    await writeFile(join(source, "a@1", "dist", "index.js"), "x", { mode: 0o600 });
    await writeFile(join(source, "node", "bin", "node"), "x", { mode: 0o700 });
    for (const d of ["a@1", "a@1/dist", "node", "node/bin"]) await chmod(join(source, d), 0o700);
    await syncAdapters(home, { source, appVersion: "1.0.0", pinned: ["a@1"] });
    const mode = async (p: string) => (await stat(join(home, "adapters", p))).mode & 0o777;
    expect(await mode(".")).toBe(0o755);
    expect(await mode("a@1")).toBe(0o755);
    expect(await mode("a@1/dist")).toBe(0o755);
    expect(await mode("a@1/dist/index.js")).toBe(0o644);
    expect(await mode("node/bin")).toBe(0o755);
    expect(await mode("node/bin/node")).toBe(0o755);
  });

  it("keeps scoped adapters that are pinned and removes their old versions", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const source = join(root, "adapters");
    await mkdir(join(source, "@scope", "b@2"), { recursive: true });
    await mkdir(join(home, "adapters", "@scope", "b@1"), { recursive: true });
    await mkdir(join(home, "adapters", "@old", "c@1"), { recursive: true });
    await syncAdapters(home, { source, appVersion: "2.0.0", pinned: ["@scope/b@2"] });
    expect((await readdir(join(home, "adapters"))).sort()).toEqual(["@scope", "version"]);
    expect(await readdir(join(home, "adapters", "@scope"))).toEqual(["b@2"]);
  });
});
