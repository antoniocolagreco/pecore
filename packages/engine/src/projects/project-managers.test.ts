import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forgeHome } from "../../test/forge-project";
import { Engine } from "../main";
import { definitionOperations } from "../api/routes/definitions";
import { globalFileHandlers } from "../api/routes/settings";
import { seedProjectManagers } from "../../test/project";

const projectFile = (engine: Engine, id: string) => join(engine.projectDir(id), "project.json");

describe("Project Manager names and colours per project", () => {
  it("requires a Project Manager and assigns each one to at most one project", async () => {
    const { home, templates } = await forgeHome({ managers: false });
    const engine = await Engine.start({ home, templates });
    try {
      await expect(engine.createProject({ id: "one", name: "One", repo: null })).rejects.toThrow("Choose an available Project Manager");
      await seedProjectManagers(home);
      expect(await engine.reloadGlobal()).toEqual([]);
      const eva = { agentId: "eva", name: "Eva", color: "#FFDE38" };
      const results = await Promise.allSettled([
        engine.createProject({ id: "one", name: "One", repo: null, pm: eva }),
        engine.createProject({ id: "two", name: "Two", repo: null, pm: eva }),
      ]);
      expect(results.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
      expect(JSON.parse(await readFile(projectFile(engine, "one"), "utf8"))).toMatchObject({ pm: eva });
      expect(engine.availableProjectManagers().map(({ agentId }) => agentId)).not.toContain("eva");
      await engine.createProject({ id: "three", name: "Three", repo: null });
      const path = "projects/three/project.json";
      const definitions = definitionOperations(engine).handlers;
      const file = await definitions.getDefinition({ params: { path }, query: undefined, body: undefined });
      const content: string = JSON.stringify({ ...JSON.parse(file.content) as object, pm: eva });
      await expect(definitions.saveDefinition({ params: { path }, query: undefined, body: { content, baseSha256: file.sha256 } })).rejects.toThrow("Choose an available Project Manager");
      const agents = globalFileHandlers(engine);
      const fileContent = await agents.getAgents();
      const value = { ...fileContent.value, agents: fileContent.value.agents.filter(({ id }) => id !== "eva") };
      await expect(agents.putAgents({ params: undefined, query: undefined, body: { value, baseSha256: fileContent.sha256 } })).rejects.toThrow("Reassign the project");
    } finally {
      await engine.shutdown();
    }
  });

  it("assigns free Project Managers at start to projects that have none or share one, in project order", async () => {
    const { home, templates } = await forgeHome();
    const first = await Engine.start({ home, templates });
    await first.createProject({ id: "alpha", name: "Alpha", repo: null });
    await first.createProject({ id: "beta", name: "Beta", repo: null });
    await first.createProject({ id: "gamma", name: "Gamma", repo: null });
    await first.shutdown();
    await rm(join(home, "agents.json"));
    const strip = async (id: string, pm: unknown): Promise<void> => {
      const path = join(home, "projects", id, "project.json");
      await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")) as object, pm }, null, 2) + "\n");
    };
    await strip("alpha", null);
    await strip("beta", { name: "Viola", color: "#9D57FF" });
    await strip("gamma", { name: "Viola", color: "#9D57FF" });

    const engine = await Engine.start({ home, templates });
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
