import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DefinitionEntry, LiveMessage } from "@pecore/schemas";
import { git } from "../home/git-commit";
import { apiProject } from "../../test/api-project";
import { definitionOperations } from "./routes/definitions";

describe("definition routes", () => {
  it("lists, reads and saves a project file with its hash; a stale hash is 409, an invalid file is 400", async () => {
    const { home, engine, call, close } = await apiProject();
    const live: LiveMessage[] = [];
    engine.on("live", (m: LiveMessage) => live.push(m));
    const nodes = await call("listDefinitions", { query: { dir: "templates/nodes" } });
    expect(nodes.find((n) => n.path === "templates/nodes/human-review.json")).toMatchObject({ value: { kind: "human" }, errors: [] });
    expect(nodes.some((n) => n.path === "templates/nodes/git-commit.sh")).toBe(true);
    expect((await call("listDefinitions", { query: { dir: "projects/demo/recipes" } })).map((r) => r.path)).toEqual(["projects/demo/recipes/reviewed.json"]);

    const file = await call("getDefinition", { params: { path: "projects/demo/project.json" } });
    const edited = JSON.stringify({ ...(JSON.parse(file.content) as object), name: "Demo renamed" }, null, 2);
    await expect(call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: edited, baseSha256: "0".repeat(64) } })).rejects.toMatchObject({ status: 409 });
    await expect(call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: "{", baseSha256: file.sha256 } })).rejects.toMatchObject({ status: 400 });
    const saved = await call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: edited, baseSha256: file.sha256 } });
    expect((await call("getProject", { params: { id: "demo" } })).project?.name).toBe("Demo renamed");
    expect((await git(home, ["log", "-1", "--format=%s"])).trim()).toBe("project demo: edited");
    expect(live).toContainEqual({ type: "definition.changed", path: "projects/demo/project.json", sha256: saved.sha256 });
    await close();
  });

  it("validates names and paths", async () => {
    const { call, close } = await apiProject();
    const node = JSON.stringify({ name: "other", description: "x", kind: "human", outcomes: ["ok"], changesFiles: false, timeoutSec: 10 });
    expect((await call("validateDefinition", { body: { path: "templates/nodes/mine.json", content: node } })).errors).toContainEqual(expect.objectContaining({ path: "name" }));
    await expect(call("getDefinition", { params: { path: "templates/../settings.json" } })).rejects.toMatchObject({ status: 400 });
    await expect(call("getDefinition", { params: { path: "templates/other/x.json" } })).rejects.toMatchObject({ status: 400 });
    await expect(call("getDefinition", { params: { path: "projects/nope/project.json" } })).rejects.toMatchObject({ status: 404 });
    await expect(call("getDefinition", { params: { path: "templates/nodes/missing.json" } })).rejects.toMatchObject({ status: 404 });
    await close();
  });

  it("lists bundled SVGs and saves reusable icons through the template definition store", async () => {
    const { call, close } = await apiProject();
    try {
      const bundled: DefinitionEntry[] = await call("listDefinitions", { query: { dir: "templates/icons" } });
      expect(bundled.map(({ path }) => path)).toContain("templates/icons/node-spec-writer.svg");
      expect(bundled.flatMap(({ errors }) => errors)).toEqual([]);
      const path: string = "templates/icons/compass.svg";
      const content: string = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m4 4 16 8-16 8 4-8z"/></svg>';
      await call("saveDefinition", { params: { path }, body: { content, baseSha256: null } });
      expect((await call("getDefinition", { params: { path } })).content).toBe(content);
      expect((await call("listDefinitions", { query: { dir: "templates/icons" } })).find((entry) => entry.path === path)?.value).toBe(content);
      const invalid: string = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script/></svg>';
      await expect(call("saveDefinition", { params: { path: "templates/icons/invalid.svg" }, body: { content: invalid, baseSha256: null } }))
        .rejects.toMatchObject({ status: 400 });
      const node: string = JSON.stringify({ name: "mine", description: "Review", icon: "compass", kind: "human", outcomes: ["ok"], changesFiles: false, timeoutSec: 10 });
      await call("saveDefinition", { params: { path: "templates/nodes/mine.json" }, body: { content: node, baseSha256: null } });
      await call("instantiate", { body: { kind: "node", name: "mine", project: "demo" } });
      expect(JSON.parse((await call("getDefinition", { params: { path: "projects/demo/nodes/mine.json" } })).content)).toMatchObject({ icon: "compass" });
    } finally {
      await close();
    }
  });

  it("instantiates an engine node and its script without creating a queue item", async () => {
    const { engine, call, close } = await apiProject();
    const r = await call("instantiate", { body: { kind: "node", name: "github-pr", project: "demo" } });
    expect(r.created).toEqual(expect.arrayContaining(["projects/demo/nodes/github-pr.json", "projects/demo/nodes/github-pr.sh"]));
    expect(await call("listQueue", { query: { state: "open" } })).toEqual([]);
    expect(engine.project("demo").ctx.defs.nodes.has("github-pr")).toBe(true);
    const again = await call("instantiate", { body: { kind: "node", name: "github-pr", project: "demo" } });
    expect(again).toMatchObject({ created: [], kept: ["projects/demo/nodes/github-pr.json"] });
    await close();
  });

  it("refuses to add or save a recipe that needs a remote repository in a local project (decision 72)", async () => {
    const { engine, call, close } = await apiProject();
    const refusal = "git-push needs a remote repository, and this project has none";
    await expect(call("instantiate", { body: { kind: "recipe", name: "feature", project: "demo" } })).rejects.toThrow(refusal);
    expect(existsSync(join(engine.projectDir("demo"), "recipes", "feature.json"))).toBe(false);
    expect(existsSync(join(engine.projectDir("demo"), "nodes", "git-push.json"))).toBe(false);
    const result = await definitionOperations(engine).instantiate({ kind: "recipe", name: "feature", project: "demo" });
    expect(result.errors.map(({ message }) => message)).toContain(refusal);
    expect(await call("listQueue", { query: { state: "open" } })).toEqual([]);
    await call("instantiate", { body: { kind: "node", name: "git-push", project: "demo" } });
    const content = JSON.stringify({ name: "push", description: "commit and push", start: "commit", successOutcomes: ["push:pushed"],
      nodes: { commit: { use: "git-commit" }, push: { use: "git-push" } }, edges: [{ from: "commit", on: "done", to: "push" }] });
    expect((await call("validateDefinition", { body: { path: "projects/demo/recipes/push.json", content } })).errors.map(({ message }) => message)).toEqual([refusal]);
    await expect(call("saveDefinition", { params: { path: "projects/demo/recipes/push.json" }, body: { content, baseSha256: null } })).rejects.toThrow(refusal);
    expect(existsSync(join(engine.projectDir("demo"), "recipes", "push.json"))).toBe(false);
    expect((await call("instantiate", { body: { kind: "recipe", name: "local-only", project: "demo" } })).created).toContain("projects/demo/recipes/local-only.json");
    await close();
  });
});

describe("global file routes", () => {
  it("loads older settings without exposing removed manual configuration", async () => {
    const { home, engine, call, close } = await apiProject();
    try {
      await writeFile(join(home, "settings.json"), JSON.stringify({
        limits: { agents: 3, providers: { openai: 1 } },
        prices: {},
        projectPaths: { demo: "/old/demo" },
        programPaths: { codex: "/old/codex" },
        mergeCheckSec: 45,
      }));
      expect(await engine.reloadGlobal()).toEqual([]);
      const settings = await call("getSettings");
      expect(settings.value.limits).toEqual({ jobs: null, agents: 3 });
      expect(settings.value.mergeCheckSec).toBe(45);
      expect(settings.value).not.toHaveProperty("prices");
      expect(settings.value).not.toHaveProperty("projectPaths");
      expect(settings.value).not.toHaveProperty("programPaths");
      expect(engine.projectDir("demo")).toBe(join(home, "projects", "demo"));
      await expect(call("listDefinitions", { query: { dir: "connectors" } })).rejects.toMatchObject({ status: 400 });
    } finally {
      await close();
    }
  });

  it("saves settings with the hash, refuses protectedMode, and rolls back a profile that names a missing account", async () => {
    const { home, engine, call, close } = await apiProject();
    const s = await call("getSettings");
    await call("putSettings", { body: { value: { ...s.value, mergeCheckSec: 60 }, baseSha256: s.sha256 } });
    expect(engine.global().settings.mergeCheckSec).toBe(60);
    await expect(call("putSettings", { body: { value: { ...s.value, mergeCheckSec: 90 }, baseSha256: s.sha256 } })).rejects.toMatchObject({ status: 409 });
    const s2 = await call("getSettings");
    await expect(call("putSettings", { body: { value: { ...s2.value, protectedMode: true }, baseSha256: s2.sha256 } })).rejects.toMatchObject({ status: 400 });

    const p = await call("getProfiles");
    const bad = { profiles: [{ id: "p1", account: "ghost", model: "m", effort: null }] };
    await expect(call("putProfiles", { body: { value: bad, baseSha256: p.sha256 } })).rejects.toMatchObject({ status: 400 });
    expect(engine.global().profiles.profiles).toEqual([]);
    expect((await call("getProfiles")).sha256).toBe(p.sha256);
    expect(JSON.parse(await readFile(join(home, "settings.json"), "utf8"))).toMatchObject({ mergeCheckSec: 60 });
    await close();
  });
});
