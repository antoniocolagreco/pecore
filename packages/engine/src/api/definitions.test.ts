import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DefinitionEntry, LiveMessage } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { definitionOperations } from "./routes/definitions";

describe("definition routes", () => {
  it("lists, reads and saves a project file with its hash; a stale hash is 409, an invalid file is 400", async () => {
    const { engine, call, close } = await apiProject();
    const live: LiveMessage[] = [];
    engine.on("live", (m: LiveMessage) => live.push(m));
    const nodes = await call("listDefinitions", { query: { dir: "templates/nodes" } });
    expect(nodes.find((n) => n.path === "templates/nodes/human-review.json")).toMatchObject({ value: { kind: "human", mode: "review" }, errors: [] });
    expect(nodes.some((n) => n.path === "templates/nodes/git-commit.sh")).toBe(true);
    expect((await call("listDefinitions", { query: { dir: "projects/demo/recipes" } })).map((r) => r.path)).toEqual(["templates/recipes/reviewed.json"]);

    const file = await call("getDefinition", { params: { path: "projects/demo/project.json" } });
    const edited = JSON.stringify({ ...(JSON.parse(file.content) as object), name: "Demo renamed" }, null, 2);
    await expect(call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: edited, baseSha256: "0".repeat(64) } })).rejects.toMatchObject({ status: 409 });
    await expect(call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: "{", baseSha256: file.sha256 } })).rejects.toMatchObject({ status: 400 });
    const saved = await call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: edited, baseSha256: file.sha256 } });
    expect((await call("getProject", { params: { id: "demo" } })).project?.name).toBe("Demo renamed");
    expect(live).toContainEqual({ type: "definition.changed", path: "projects/demo/project.json", sha256: saved.sha256 });
    await close();
  });

  it("validates names and paths", async () => {
    const { call, close } = await apiProject();
    const node = JSON.stringify({ name: "other", description: "x", kind: "human-decision", outcomes: ["ok"] });
    expect((await call("validateDefinition", { body: { path: "templates/nodes/mine.json", content: node } })).errors).toContainEqual(expect.objectContaining({ path: "name" }));
    await expect(call("getDefinition", { params: { path: "templates/../settings.json" } })).rejects.toMatchObject({ status: 400 });
    await expect(call("getDefinition", { params: { path: "templates/other/x.json" } })).rejects.toMatchObject({ status: 400 });
    await expect(call("getDefinition", { params: { path: "projects/nope/project.json" } })).rejects.toMatchObject({ status: 404 });
    await expect(call("getDefinition", { params: { path: "templates/nodes/missing.json" } })).rejects.toMatchObject({ status: 404 });
    await close();
  });

  it("deletes unused templates and protects references and newer revisions", async () => {
    const { engine, call, close } = await apiProject();
    try {
      const live: LiveMessage[] = [];
      engine.on("live", (message: LiveMessage) => live.push(message));
      const node: string = "templates/nodes/delete-me.json";
      const recipe: string = "templates/recipes/delete-me.json";
      const { sha256: nodeHash } = await call("saveDefinition", { params: { path: node }, body: {
        content: JSON.stringify({ name: "delete-me", description: "Decide", kind: "human", mode: "decision", outcomes: ["yes"] }),
        baseSha256: null,
      } });
      const usage = () => call("getNodeTemplateUsage", { params: { name: "delete-me" } });
      expect(await usage()).toEqual([]);
      const { sha256: recipeHash } = await call("saveDefinition", { params: { path: recipe }, body: {
        content: JSON.stringify({
          name: "delete-me", description: "Decide", start: "decision",
          nodes: { decision: { use: "delete-me" } }, edges: [], ends: [{ from: "decision", on: "yes", result: "succeeded" }],
        }),
        baseSha256: null,
      } });
      expect(await usage()).toEqual(["recipe delete-me"]);
      await expect(call("deleteTemplate", { params: { path: node }, body: { baseSha256: nodeHash } })).rejects.toThrow("recipe delete-me");
      const assigned: string = "templates/recipes/reviewed.json";
      expect(await call("getNodeTemplateUsage", { params: { name: "write-hello" } })).toEqual(["recipe reviewed"]);
      const { sha256: assignedHash } = await call("getDefinition", { params: { path: assigned } });
      await expect(call("deleteTemplate", { params: { path: assigned }, body: { baseSha256: assignedHash } })).rejects.toThrow("project demo");
      await expect(call("deleteTemplate", { params: { path: recipe }, body: { baseSha256: "0".repeat(64) } })).rejects.toMatchObject({ status: 409 });

      await expect(call("deleteTemplate", { params: { path: recipe }, body: { baseSha256: recipeHash } })).resolves.toEqual({ ok: true });
      expect(await usage()).toEqual([]);
      await expect(call("deleteTemplate", { params: { path: node }, body: { baseSha256: nodeHash } })).resolves.toEqual({ ok: true });
      for (const path of [node, recipe]) {
        await expect(call("getDefinition", { params: { path } })).rejects.toMatchObject({ status: 404 });
        expect(live).toContainEqual({ type: "definition.changed", path, sha256: null });
      }
    } finally {
      await close();
    }
  });

  it("stores tags on the node template and returns them in the catalogue", async () => {
    const { home, call, close } = await apiProject();
    try {
      const path: string = "templates/nodes/tagged.json";
      const content: string = JSON.stringify({
        name: "tagged", description: "Tagged node", kind: "human-decision", outcomes: ["yes"],
        tags: ["github", "Human", "pull request"],
      });
      await call("saveDefinition", { params: { path }, body: { content, baseSha256: null } });
      expect(JSON.parse(await readFile(join(home, path), "utf8"))).toMatchObject({ kind: "human", mode: "decision", tags: ["github", "pull request"] });
      const nodes: DefinitionEntry[] = await call("listDefinitions", { query: { dir: "templates/nodes" } });
      expect(nodes.find((entry) => entry.path === path)).toMatchObject({ value: { tags: ["github", "pull request"] } });
    } finally {
      await close();
    }
  });

  it("blocks deletion when a project has a local recipe that uses the node", async () => {
    const { engine, call, close } = await apiProject();
    try {
      const path: string = "templates/nodes/write-hello.json";
      const { sha256, content } = await call("getDefinition", { params: { path } });
      const projectDir: string = engine.projectDir("demo");
      const projectPath: string = join(projectDir, "project.json");
      const project = engine.project("demo").ctx.project;
      await mkdir(join(projectDir, "nodes"), { recursive: true });
      await mkdir(join(projectDir, "recipes"), { recursive: true });
      await writeFile(join(projectDir, "nodes", "write-hello.json"), content);
      await writeFile(join(projectDir, "recipes", "local.json"), JSON.stringify({
        name: "local", description: "Write a file", start: "write",
        nodes: { write: { use: "write-hello" } }, edges: [], ends: [{ from: "write", on: "done", result: "succeeded" }],
      }));
      await writeFile(projectPath, JSON.stringify({ ...project, recipes: undefined }));
      expect(await engine.reloadProject("demo")).toEqual([]);

      expect(await call("getNodeTemplateUsage", { params: { name: "write-hello" } })).toContain("recipe local in project demo");
      await expect(call("deleteTemplate", { params: { path }, body: { baseSha256: sha256 } })).rejects.toThrow("recipe local in project demo");
    } finally {
      await close();
    }
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
      const node: string = JSON.stringify({ name: "mine", description: "Decide", icon: "compass", kind: "human-decision", outcomes: ["ok"] });
      await call("saveDefinition", { params: { path: "templates/nodes/mine.json" }, body: { content: node, baseSha256: null } });
      expect(JSON.parse((await call("getDefinition", { params: { path: "templates/nodes/mine.json" } })).content)).toMatchObject({ icon: "compass" });
    } finally {
      await close();
    }
  });

  it("assigns a shared recipe without copying its files or creating a queue item", async () => {
    const { engine, call, close } = await apiProject();
    const r = await call("instantiate", { body: { kind: "recipe", name: "feature-to-local-commit", project: "demo" } });
    expect(r.created).toEqual(["templates/recipes/feature-to-local-commit.json"]);
    expect(await call("listQueue", { query: { state: "open" } })).toEqual([]);
    expect(engine.project("demo").ctx.project.recipes).toEqual(["reviewed", "feature-to-local-commit"]);
    expect(existsSync(join(engine.projectDir("demo"), "nodes"))).toBe(false);
    const again = await call("instantiate", { body: { kind: "recipe", name: "feature-to-local-commit", project: "demo" } });
    expect(again).toMatchObject({ created: [], kept: ["templates/recipes/feature-to-local-commit.json"] });
    await close();
  });

  it("refuses to add or save a recipe that needs a remote repository in a local project (decision 72)", async () => {
    const { engine, call, close } = await apiProject();
    const refusal = "git-push needs a remote repository, and this project has none";
    await expect(call("instantiate", { body: { kind: "recipe", name: "feature-to-pr", project: "demo" } })).rejects.toThrow(refusal);
    expect(existsSync(join(engine.projectDir("demo"), "recipes", "feature.json"))).toBe(false);
    expect(existsSync(join(engine.projectDir("demo"), "nodes", "git-push.json"))).toBe(false);
    const result = await definitionOperations(engine).instantiate({ kind: "recipe", name: "feature-to-pr", project: "demo" });
    expect(result.errors.map(({ message }) => message)).toContain(refusal);
    expect(await call("listQueue", { query: { state: "open" } })).toEqual([]);
    const content = JSON.stringify({ name: "push", description: "commit and push", start: "commit", successOutcomes: ["push:pushed"],
      nodes: { commit: { use: "git-commit" }, push: { use: "git-push" } }, edges: [{ from: "commit", on: "done", to: "push" }] });
    await call("saveDefinition", { params: { path: "templates/recipes/push.json" }, body: { content, baseSha256: null } });
    await expect(call("instantiate", { body: { kind: "recipe", name: "push", project: "demo" } })).rejects.toThrow(refusal);
    expect(existsSync(join(engine.projectDir("demo"), "recipes", "push.json"))).toBe(false);
    expect((await call("instantiate", { body: { kind: "recipe", name: "feature-to-local-commit", project: "demo" } })).created).toContain("templates/recipes/feature-to-local-commit.json");
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

  it("keeps knowledge flat, refuses broken links, and uploads, renames and deletes files with their links", async () => {
    const { engine, call, close } = await apiProject();
    try {
      const dir: string = join(engine.projectDir("demo"), "knowledge");
      const path = (name: string): string => `projects/demo/knowledge/${name}`;
      await expect(call("saveDefinition", { params: { path: "projects/demo/knowledge/docs/a.md" }, body: { content: "# A\n", baseSha256: null } })).rejects.toMatchObject({ status: 400 });
      await expect(call("saveDefinition", { params: { path: path("bad name.md") }, body: { content: "# A\n", baseSha256: null } })).rejects.toMatchObject({ status: 400 });
      await expect(call("saveDefinition", { params: { path: path("guide.md") }, body: { content: "# Guide\n\nSee [n](naming.md).\n", baseSha256: null } }))
        .rejects.toMatchObject({ status: 400, message: expect.stringContaining("line 3: naming.md is not a knowledge file of this project") });
      const checked = await call("validateDefinition", { body: { path: path("guide.md"), content: "# Guide\n# Again\n" } });
      expect(checked.errors).toEqual([]);
      expect(checked.warnings).toContainEqual(expect.objectContaining({ line: 2, message: expect.stringContaining("line 2:") }));

      expect(await call("uploadKnowledge", { params: { id: "demo" }, body: { files: [
        { name: "guide.md", content: "# Guide\n\nSee [n](naming.md).\n" },
        { name: "naming.md", content: "# Naming\n\nBack to [guide](guide.md).\n" },
      ] } })).toEqual({ saved: [path("guide.md"), path("naming.md")], removedLinks: [] });
      await expect(call("uploadKnowledge", { params: { id: "demo" }, body: { files: [{ name: "guide.md", content: "# Other\n" }] } })).rejects.toMatchObject({ status: 409 });
      expect(await call("uploadKnowledge", { params: { id: "demo" }, body: { files: [{ name: "extra.md", content: "See [x](nope.md) and [g](guide.md).\n" }] } }))
        .toEqual({ saved: [path("extra.md")], removedLinks: [{ file: "extra.md", link: "nope.md" }] });
      expect(await readFile(join(dir, "extra.md"), "utf8")).toBe("See x and [g](guide.md).\n");
      await call("deleteKnowledge", { params: { id: "demo", name: "extra.md" } });
      const listed: DefinitionEntry[] = await call("listDefinitions", { query: { dir: "projects/demo/knowledge" } });
      expect(listed.map((entry) => [entry.path, entry.value])).toEqual([[path("guide.md"), { links: ["naming.md"] }], [path("naming.md"), { links: ["guide.md"] }]]);

      expect(await call("renameKnowledge", { params: { id: "demo" }, body: { from: "naming.md", to: "names.md" } })).toEqual({ updated: [path("guide.md")] });
      expect(await readFile(join(dir, "guide.md"), "utf8")).toBe("# Guide\n\nSee [n](names.md).\n");
      expect(existsSync(join(dir, "naming.md"))).toBe(false);
      await expect(call("renameKnowledge", { params: { id: "demo" }, body: { from: "names.md", to: "guide.md" } })).rejects.toMatchObject({ status: 409 });
      await expect(call("renameKnowledge", { params: { id: "demo" }, body: { from: "gone.md", to: "other.md" } })).rejects.toMatchObject({ status: 404 });

      await call("deleteKnowledge", { params: { id: "demo", name: "names.md" } });
      expect(existsSync(join(dir, "names.md"))).toBe(false);
      await expect(call("deleteKnowledge", { params: { id: "demo", name: "names.md" } })).rejects.toMatchObject({ status: 404 });
    } finally {
      await close();
    }
  });
});
