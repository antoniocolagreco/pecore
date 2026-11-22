import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forgeHome } from "../../test/forge-project";
import { Engine } from "../main";
import { definitionOperations } from "../api/routes/definitions";

const projectFile = (engine: Engine, id: string) => join(engine.projectDir(id), "project.json");

describe("Project Manager names and colours per project", () => {
  it("gives each new project the first free Project Manager, keeps a chosen one and refuses one already in use", async () => {
    const { home, library } = await forgeHome();
    const engine = await Engine.start({ home, library });
    try {
      await engine.createProject({ id: "one", name: "One", repo: null });
      await engine.createProject({ id: "two", name: "Two", repo: null, pm: { name: "Kim", color: "#123456" } });
      await engine.createProject({ id: "three", name: "Three", repo: null });
      expect(engine.project("one").ctx.project.pm).toEqual({ name: "Eva", color: "#FFDE38" });
      expect(engine.project("two").ctx.project.pm).toEqual({ name: "Kim", color: "#123456" });
      expect(engine.project("three").ctx.project.pm).toEqual({ name: "Viola", color: "#9D57FF" });
      expect(JSON.parse(await readFile(projectFile(engine, "one"), "utf8"))).toMatchObject({ pm: { name: "Eva", color: "#FFDE38" } });
      await expect(engine.createProject({ id: "four", name: "Four", repo: null, pm: { name: "kim", color: "#654321" } })).rejects.toThrow("already uses this name");
      await expect(engine.createProject({ id: "four", name: "Four", repo: null, pm: { name: "Lee", color: "#FFDE38" } })).rejects.toThrow("already uses this colour");
      expect(engine.projects.has("four")).toBe(false);

      const path = "projects/three/project.json";
      const definitions = definitionOperations(engine).handlers;
      const file = await definitions.getDefinition({ params: { path }, query: undefined, body: undefined });
      const content = (pm: object) => JSON.stringify({ ...JSON.parse(file.content) as object, pm }, null, 2) + "\n";
      await expect(definitions.saveDefinition({ params: { path }, query: undefined, body: { content: content({ name: "Eva", color: "#000000" }), baseSha256: file.sha256 } })).rejects.toThrow("already uses this name");
      await definitions.saveDefinition({ params: { path }, query: undefined, body: { content: content({ name: "Viola", color: "#000000" }), baseSha256: file.sha256 } });
      expect(engine.project("three").ctx.project.pm).toEqual({ name: "Viola", color: "#000000" });
    } finally {
      await engine.shutdown();
    }
  });

  it("assigns free Project Managers at start to projects that have none or share one, in project order", async () => {
    const { home, library } = await forgeHome();
    const first = await Engine.start({ home, library });
    await first.createProject({ id: "alpha", name: "Alpha", repo: null });
    await first.createProject({ id: "beta", name: "Beta", repo: null });
    await first.createProject({ id: "gamma", name: "Gamma", repo: null });
    await first.shutdown();
    const strip = async (id: string, pm: unknown): Promise<void> => {
      const path = join(home, "projects", id, "project.json");
      await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")) as object, pm }, null, 2) + "\n");
    };
    await strip("alpha", null);
    await strip("beta", { name: "Viola", color: "#9D57FF" });
    await strip("gamma", { name: "Viola", color: "#9D57FF" });

    const engine = await Engine.start({ home, library });
    try {
      expect(engine.project("alpha").ctx.project.pm).toEqual({ name: "Eva", color: "#FFDE38" });
      expect(engine.project("beta").ctx.project.pm).toEqual({ name: "Viola", color: "#9D57FF" });
      expect(engine.project("gamma").ctx.project.pm).toEqual({ name: "Mara", color: "#2F8E76" });
      expect(JSON.parse(await readFile(join(home, "projects", "gamma", "project.json"), "utf8"))).toMatchObject({ pm: { name: "Mara" } });
    } finally {
      await engine.shutdown();
    }
  });
});
