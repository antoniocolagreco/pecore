import { chmod, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Node, Recipe } from "@pecore/schemas";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { seedTemplates, templatesFormat } from "../definitions/seed";
import { Catalog } from "../store/catalog";
import { ChatsDb } from "../store/chats-db";
import { homePaths, initHome, syncAdapters } from "./layout";

describe("PECORE_HOME layout", () => {
  it("initialises a private home without generated definitions, schemas or repository files", async () => {
    const home: string = join(await tempDir(), "home");
    await initHome(home);
    const p: ReturnType<typeof homePaths> = homePaths(home);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(p.run)).mode & 0o777).toBe(0o700);
    expect((await readdir(home)).sort()).toEqual(["projects", "run"]);
  });

  it("seeds a catalog once and only replaces shipped rows when the format changes", async () => {
    const db: ChatsDb = new ChatsDb(join(await tempDir(), "chats.db"));
    const catalog: Catalog = new Catalog(db.db);
    try {
      await seedTemplates(catalog, shippedTemplates);
      expect(catalog.node("git-commit")).toMatchObject({ kind: "command", script: "git-commit.sh" });
      expect(catalog.content("git-commit.sh")).toContain("git commit");
      expect(catalog.recipe("feature-to-pr")).toMatchObject({ name: "feature-to-pr", start: "spec", nodes: { spec: { reads: [] } } });
      const node: Node = Node.parse({ name: "builder", kind: "human", interface: "decision", description: "Mine", outcomes: ["accept"] });
      catalog.saveNode(node);
      catalog.saveContent("custom.md", "My context");
      catalog.saveRecipe(Recipe.parse({ name: "old-shipped", description: "Retired" }), true);
      catalog.saveRecipe(Recipe.parse({ name: "my-recipe", description: "Kept" }));
      await seedTemplates(catalog, shippedTemplates);
      expect(catalog.recipe("old-shipped")).not.toBeNull();

      db.db.prepare("UPDATE catalog_version SET format = ?").run("old");
      await seedTemplates(catalog, shippedTemplates);

      expect(catalog.node("builder")).toMatchObject(node);
      expect(catalog.content("custom.md")).toBe("My context");
      expect(catalog.recipe("old-shipped")).toBeNull();
      expect(catalog.recipe("my-recipe")).toMatchObject({ description: "Kept" });
      expect(catalog.content("spec-writer.md")).toContain("Open relevant attachments");
      expect(db.db.prepare("SELECT format FROM catalog_version").pluck().get()).toBe(templatesFormat);
    } finally {
      db.close();
    }
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

  it("copies a newly pinned adapter without an app version change", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const source = join(root, "adapters");
    await mkdir(join(source, "a@1"), { recursive: true });
    await mkdir(join(source, "b@2"), { recursive: true });
    await mkdir(join(source, "node", "bin"), { recursive: true });
    await writeFile(join(source, "node", "bin", "node"), "", { mode: 0o755 });
    expect(await syncAdapters(home, { source, appVersion: "1.0.0", pinned: ["a@1"] })).toBe(true);
    expect(await syncAdapters(home, { source, appVersion: "1.0.0", pinned: ["a@1"] })).toBe(false);
    expect(await syncAdapters(home, { source, appVersion: "1.0.0", pinned: ["a@1", "b@2"] })).toBe(true);
    expect((await readdir(join(home, "adapters"))).sort()).toEqual(["a@1", "b@2", "node", "version"]);
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
