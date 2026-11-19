import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LiveMessage } from "@pecore/schemas";
import { git } from "../home/git-commit";
import { apiProject } from "../../test/api-project";

describe("definition routes", () => {
  it("lists, reads and saves a project file with its hash; a stale hash is 409, an invalid file is 400", async () => {
    const { home, engine, call, close } = await apiProject();
    const live: LiveMessage[] = [];
    engine.on("live", (m: LiveMessage) => live.push(m));
    const nodes = await call("listDefinitions", { query: { dir: "library/nodes" } });
    expect(nodes.find((n) => n.path === "library/nodes/human-review.json")).toMatchObject({ value: { kind: "human" }, errors: [] });
    expect(nodes.some((n) => n.path === "library/nodes/git-commit.sh")).toBe(true);
    expect((await call("listDefinitions", { query: { dir: "projects/demo/recipes" } })).map((r) => r.path)).toEqual(["projects/demo/recipes/reviewed.json"]);

    const file = await call("getDefinition", { params: { path: "projects/demo/project.json" } });
    const edited = JSON.stringify({ ...(JSON.parse(file.content) as object), name: "Demo renamed" }, null, 2);
    await expect(call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: edited, baseSha256: "0".repeat(64) } })).rejects.toMatchObject({ status: 409 });
    await expect(call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: "{", baseSha256: file.sha256 } })).rejects.toMatchObject({ status: 400 });
    const saved = await call("saveDefinition", { params: { path: "projects/demo/project.json" }, body: { content: edited, baseSha256: file.sha256 } });
    expect(saved.confirmItemIds).toEqual([]);
    expect((await call("getProject", { params: { id: "demo" } })).project?.name).toBe("Demo renamed");
    expect((await git(home, ["log", "-1", "--format=%s"])).trim()).toBe("project demo: edited");
    expect(live).toContainEqual({ type: "definition.changed", path: "projects/demo/project.json", sha256: saved.sha256 });
    await close();
  });

  it("validates names and paths", async () => {
    const { call, close } = await apiProject();
    const node = JSON.stringify({ name: "other", description: "x", kind: "human", outcomes: ["ok"], changesFiles: false, timeoutSec: 10 });
    expect((await call("validateDefinition", { body: { path: "library/nodes/mine.json", content: node } })).errors).toContainEqual(expect.objectContaining({ path: "name" }));
    await expect(call("getDefinition", { params: { path: "library/../settings.json" } })).rejects.toMatchObject({ status: 400 });
    await expect(call("getDefinition", { params: { path: "library/other/x.json" } })).rejects.toMatchObject({ status: 400 });
    await expect(call("getDefinition", { params: { path: "projects/nope/project.json" } })).rejects.toMatchObject({ status: 404 });
    await expect(call("getDefinition", { params: { path: "library/nodes/missing.json" } })).rejects.toMatchObject({ status: 404 });
    await close();
  });

  it("instantiates an engine node with its script and returns its confirmation item", async () => {
    const { engine, call, close } = await apiProject();
    const r = await call("instantiate", { body: { kind: "node", name: "github-pr", project: "demo" } });
    expect(r.created).toEqual(expect.arrayContaining(["projects/demo/nodes/github-pr.json", "projects/demo/nodes/github-pr.sh"]));
    expect(r.confirmItemIds).toHaveLength(1);
    const [item] = await call("listQueue", { query: { state: "open" } });
    expect(item).toMatchObject({ id: r.confirmItemIds[0], kind: "engine-node" });
    expect(engine.project("demo").ctx.defs.nodes.has("github-pr")).toBe(true);
    const again = await call("instantiate", { body: { kind: "node", name: "github-pr", project: "demo" } });
    expect(again).toMatchObject({ created: [], kept: ["projects/demo/nodes/github-pr.json"] });
    await close();
  });
});

describe("global file routes", () => {
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
