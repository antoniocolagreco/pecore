import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forgeHome } from "../../test/forge-project";
import { Engine } from "../main";
import { globalFileHandlers } from "../api/routes/settings";

describe("Project Manager names and colours per project", () => {
  it("uses the default for new projects and keeps project overrides out of the agent catalog", async () => {
    const { home, templates } = await forgeHome();
    await writeFile(join(home, "agents.json"), JSON.stringify({ agents: [
      { id: "developer", name: "Developer", kind: "worker", model: null, compaction: { auto: 131072, max: 262144 } },
    ] }));
    const engine = await Engine.start({ home, templates });
    try {
      const agents = globalFileHandlers(engine);
      const save = async (query: { role: "pm"; project?: string }, name: string, compaction: { auto: number; max: number }): Promise<void> => {
        const file = await agents.getChatAgentSettings({ query, params: undefined, body: undefined });
        await agents.putChatAgentSettings({ query, params: undefined, body: { value: { ...file.value, name, compaction }, baseSha256: file.sha256 } });
      };
      await engine.createProject({ id: "one", name: "One", repo: null });
      await engine.createProject({ id: "two", name: "Two", repo: null });
      expect(engine.projectManagerIdentity("one")).toMatchObject({ name: "Eva" });
      expect(engine.projectManagerIdentity("two")).toMatchObject({ name: "Viola" });
      await save({ role: "pm" }, "Project Manager Default", { auto: 65536, max: 131072 });
      expect(engine.chatAgent("one")?.compaction).toEqual({ auto: 65536, max: 131072 });
      expect(engine.chatAgent("two")?.compaction).toEqual({ auto: 65536, max: 131072 });
      await save({ role: "pm", project: "one" }, "Evelyn", { auto: 262144, max: 524288 });
      expect(engine.chatAgent("one")).toMatchObject({ name: "Evelyn", compaction: { auto: 262144, max: 524288 } });
      expect(engine.chatAgent("two")).toMatchObject({ name: "Viola", compaction: { auto: 65536, max: 131072 } });
      await expect(save({ role: "pm", project: "one" }, "Viola", { auto: 65536, max: 131072 })).rejects.toThrow("already uses this name");
      const catalog = await agents.getAgents();
      expect(catalog.value.agents.map(({ name, kind }) => ({ name, kind }))).toEqual([{ name: "Developer", kind: "agent" }]);
      await agents.putAgents({ params: undefined, query: undefined, body: { value: { agents: [] }, baseSha256: catalog.sha256 } });
      expect(engine.chatAgent("one")?.name).toBe("Evelyn");
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
    const strip = async (id: string, pm: unknown): Promise<void> => {
      const path = join(home, "projects", id, "project.json");
      await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, "utf8")) as object, pm }, null, 2) + "\n");
    };
    await strip("alpha", null);
    await strip("beta", { name: "Viola", color: "#9D57FF" });
    await strip("gamma", { name: "Viola", color: "#9D57FF" });

    const engine = await Engine.start({ home, templates });
    try {
      expect(engine.project("alpha").ctx.project.pm).toMatchObject({ name: "Eva", color: "#FFDE38" });
      expect(engine.project("beta").ctx.project.pm).toEqual({ name: "Viola", color: "#9D57FF" });
      expect(engine.project("gamma").ctx.project.pm).toMatchObject({ name: "Mara", color: "#2F8E76" });
      expect(JSON.parse(await readFile(join(home, "projects", "gamma", "project.json"), "utf8"))).toMatchObject({ pm: { name: "Mara" } });
    } finally {
      await engine.shutdown();
    }
  });
});
