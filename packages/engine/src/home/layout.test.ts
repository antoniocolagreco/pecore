import { chmod, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { homePaths, initHome, syncAdapters } from "./layout";

describe("PECORE_HOME layout", () => {
  it("initialises a new home without git: run/ 0700, schemas, templates", async () => {
    const home = join(await tempDir(), "home");
    expect(await initHome(home, { templates: shippedTemplates })).toEqual({ created: true });
    const p = homePaths(home);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(p.run)).mode & 0o777).toBe(0o700);
    expect((await readdir(p.schemas)).sort()).toContain("node.json");
    expect(await readdir(p.templateNodes)).toContain("git-commit.json");
    expect(await readdir(home)).not.toContain(".git");
    expect(await readdir(home)).not.toContain(".gitignore");
  });

  it("rewrites the schemas on a second start", async () => {
    const home = join(await tempDir(), "home");
    await initHome(home, { templates: shippedTemplates });
    await writeFile(join(homePaths(home).schemas, "node.json"), "{}");
    expect(await initHome(home, { templates: shippedTemplates })).toEqual({ created: false });
    expect(await readFile(join(homePaths(home).schemas, "node.json"), "utf8")).not.toBe("{}");
  });

  it("adds templates files a newer app ships to an existing home, without touching files the user changed", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const shipped = join(root, "shipped");
    await mkdir(join(shipped, "nodes"), { recursive: true });
    await mkdir(join(shipped, "forges"), { recursive: true });
    await writeFile(join(shipped, "nodes", "a.json"), "shipped a\n");
    await initHome(home, { templates: shipped });
    await writeFile(join(homePaths(home).templates, "nodes", "a.json"), "edited a\n");
    await writeFile(join(shipped, "nodes", "a.json"), "shipped a v2\n");
    await writeFile(join(shipped, "nodes", "b.sh"), "echo b\n");
    await writeFile(join(shipped, "forges", "git.json"), "{}\n");
    expect(await initHome(home, { templates: shipped })).toEqual({ created: false });
    expect(await readFile(join(homePaths(home).templates, "nodes", "a.json"), "utf8")).toBe("edited a\n");
    expect(await readFile(join(homePaths(home).templates, "nodes", "b.sh"), "utf8")).toBe("echo b\n");
    expect(await readFile(join(homePaths(home).templates, "forges", "git.json"), "utf8")).toBe("{}\n");
  });

  it("removes template files the app no longer ships when the user did not change them", async () => {
    const home = join(await tempDir(), "home");
    await initHome(home, { templates: shippedTemplates });
    const templates: string = homePaths(home).templates;
    const empty = '{\n  "$schema": "../../schemas/recipe.json",\n  "name": "empty",\n  "description": "A recipe with no nodes: the job ends at once as succeeded. Start here to build a recipe in the graph editor"\n}\n';
    await writeFile(join(templates, "recipes", "empty.json"), empty);
    await writeFile(join(templates, "icons", "recipe-empty.svg"), "<svg>mine</svg>\n");
    await initHome(home, { templates: shippedTemplates });
    expect(await readdir(join(templates, "recipes"))).not.toContain("empty.json");
    expect(await readFile(join(templates, "icons", "recipe-empty.svg"), "utf8")).toBe("<svg>mine</svg>\n");
  });

  it("renames the library folder of an older home to templates, keeping the user's changes", async () => {
    const home = join(await tempDir(), "home");
    await initHome(home, { templates: shippedTemplates });
    await rename(join(home, "templates"), join(home, "library"));
    await writeFile(join(home, "library", "nodes", "typecheck.json"), "edited\n");
    expect(await initHome(home, { templates: shippedTemplates })).toEqual({ created: false });
    expect(await readdir(home)).not.toContain("library");
    expect(await readFile(join(homePaths(home).templateNodes, "typecheck.json"), "utf8")).toBe("edited\n");
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
