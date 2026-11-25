import type { NodeAgent, Project } from "@pecore/schemas";
import { ProjectDb } from "../store/project-db";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forgeHome } from "../../test/forge-project";
import { setTestConfiguration } from "../../test/configuration";
import { Engine } from "../main";
import { globalFileHandlers } from "../api/routes/settings";

describe("Project Manager names and colours per project", () => {
  it("saves a separate card per Project Manager and falls back to Default when a card is deleted", async () => {
    const { home, templates } = await forgeHome();
    await setTestConfiguration(home, "accounts", { accounts: [
      { id: "codex", kind: "model", provider: "openai", connector: "codex", login: "subscription" },
    ] });
    let engine: Engine = await Engine.start({ home, templates });
    try {
      const handlers = globalFileHandlers(engine);
      const catalog = await handlers.getAgents();
      const reviewer: NodeAgent = { id: "reviewer", kind: "agent", name: "Reviewer", color: "#FFFFFF",
        model: { account: "codex", model: "review-model", effort: "high" }, compaction: { auto: 65_536, max: 131_072 } };
      const builder: NodeAgent = { id: "builder", kind: "agent", name: "Builder", color: "#123456",
        model: { account: "codex", model: "build-model", effort: "low" }, compaction: { auto: 262_144, max: 524_288 } };
      const value = { agents: [...catalog.value.agents, reviewer, builder] };
      await handlers.putAgents({ params: undefined, query: undefined, body: { value, baseSha256: catalog.sha256 } });
      await engine.createProject({ id: "one", name: "One", repo: null });
      await engine.createProject({ id: "two", name: "Two", repo: null });
      expect(engine.chatAgent("one")).toMatchObject({ name: "Chris", cardId: "agent-default" });
      expect(engine.chatAgent("two")).toMatchObject({ name: "Amber", cardId: "agent-default" });
      const assign = async (project: string, cardId: string): Promise<void> => {
        const file = await handlers.getChatAgentSettings({ query: { role: "pm", project }, params: undefined, body: undefined });
        if (file.value.kind !== "pm") throw new Error("Missing Project Manager.");
        const { id, name, color } = file.value;
        await handlers.putChatAgentSettings({ query: { project }, params: undefined, body: {
          value: { id, kind: "pm", name, color, cardId }, baseSha256: file.sha256,
        } });
      };
      await expect(assign("one", "assistant")).rejects.toThrow("Choose an agent card");
      await expect(assign("one", "missing")).rejects.toThrow("Choose an agent card");
      await assign("one", reviewer.id);
      await assign("two", builder.id);
      await engine.shutdown();
      engine = await Engine.start({ home, templates });
      expect(engine.chatAgent("one")).toMatchObject({ name: "Chris", color: "#DC2626", cardId: reviewer.id, model: reviewer.model, compaction: reviewer.compaction });
      expect(engine.chatAgent("two")).toMatchObject({ name: "Amber", cardId: builder.id, model: builder.model, compaction: builder.compaction });
      const reopened = globalFileHandlers(engine);
      const saved = await reopened.getAgents();
      await reopened.putAgents({ params: undefined, query: undefined, body: {
        value: { agents: saved.value.agents.filter(({ id }) => id !== reviewer.id) }, baseSha256: saved.sha256,
      } });
      expect(engine.chatAgent("one")).toMatchObject({ name: "Chris", cardId: "agent-default" });
      expect(engine.chatAgent("two")).toMatchObject({ name: "Amber", cardId: builder.id });
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
    const strip = (id: string, pm: Project["pm"]): void => {
      const db: ProjectDb = new ProjectDb(join(home, "projects", id, "pecore.db"));
      try {
        db.definition.write({ ...db.definition.read()!, pm });
      } finally {
        db.close();
      }
    };
    strip("alpha", null);
    strip("beta", { name: "Viola", color: "#9D57FF" });
    strip("gamma", { name: "Viola", color: "#9D57FF" });

    const engine = await Engine.start({ home, templates });
    try {
      expect(engine.project("alpha").ctx.project.pm).toMatchObject({ name: "Chris", color: "#DC2626" });
      expect(engine.project("beta").ctx.project.pm).toEqual({ name: "Viola", color: "#9D57FF" });
      expect(engine.project("gamma").ctx.project.pm).toMatchObject({ name: "Amber", color: "#F97316" });
      expect(engine.project("gamma").ctx.db.definition.read()).toMatchObject({ pm: { name: "Amber" } });
    } finally {
      await engine.shutdown();
    }
  });
});
