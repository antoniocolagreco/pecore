import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Node, Recipe } from "@pecore/schemas";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { instantiateRecipe, instantiateNode } from "./instantiate";
import { loadGlobal, loadLibrary, loadProject } from "./load";
import { checkRecipe, hasCommitNode } from "./recipe-check";

const check = (name: string, outcomes: string[], extra: object = {}) =>
  Node.parse({
    name,
    description: name,
    kind: "command",
    command: ["true"],
    outcomes,
    failOutcomes: outcomes.includes("failed") ? ["failed"] : [],
    changesFiles: false,
    outcomeRules: [{ exitCode: 0, outcome: outcomes[0] }],
    timeoutSec: 60,
    ...extra,
  });

const writer = Node.parse({
  name: "spec-writer",
  description: "writes the spec",
  kind: "agent",
  prompt: "spec-writer.md",
  agent: { tier: "strong" },
  inputs: ["ticket"],
  outputs: ["spec"],
  outcomes: ["accepted", "rejected"],
  changesFiles: false,
  timeoutSec: 600,
  outputSchema: { type: "object", properties: { outcome: {} } },
});

const builder = Node.parse({
  name: "builder",
  description: "writes code",
  kind: "agent",
  prompt: "builder.md",
  agent: { tier: "strong" },
  inputs: ["spec"],
  outcomes: ["done"],
  changesFiles: true,
  timeoutSec: 600,
  outputSchema: { type: "object", properties: { outcome: {} } },
});

const nodes = new Map<string, Node>([
  ["spec-writer", writer],
  ["builder", builder],
  ["lint", check("lint", ["passed", "failed"])],
  ["git-commit", check("git-commit", ["done", "failed"], { outputs: ["commit"] })],
]);

const recipe = (r: object) => Recipe.parse({ name: "r", description: "r", ...r });

const local = {
  start: "spec",
  successOutcomes: ["commit:done"],
  nodes: { spec: { use: "spec-writer" }, code: { use: "builder" }, lint: { use: "lint" }, commit: { use: "git-commit", requires: ["lint"] } },
  edges: [
    { from: "spec", on: "accepted", to: "code" },
    { from: "code", on: "done", to: "lint" },
    { from: "lint", on: "passed", to: "commit" },
    { from: "lint", on: "failed", to: "code", maxRounds: 3 },
    { from: "commit", on: "stale", to: "lint" },
  ],
};

describe("recipe check", () => {
  it("accepts a valid recipe and knows it has a commit node", () => {
    expect(checkRecipe(recipe(local), nodes, false)).toEqual([]);
    expect(hasCommitNode(recipe(local), nodes)).toBe(true);
  });

  it("rejects a missing node instance", () => {
    expect(checkRecipe(recipe({ ...local, nodes: { ...local.nodes, lint: { use: "eslint" } } }), nodes, true)).toContainEqual({ path: "nodes.lint.use", message: "node eslint not found" });
  });

  it("rejects an edge on an outcome the node does not produce, and allows stale only with requires", () => {
    const edges = [...local.edges, { from: "code", on: "stale", to: "lint" }];
    expect(checkRecipe(recipe({ ...local, edges }), nodes, true)).toContainEqual({ path: "edges.5.on", message: "stale is not an outcome of code" });
  });

  it("rejects an input that is not produced on every path", () => {
    const r = recipe({
      ...local,
      start: "code",
      nodes: { ...local.nodes },
      edges: [{ from: "code", on: "done", to: "lint" }, { from: "lint", on: "passed", to: "commit" }, { from: "lint", on: "failed", to: "spec" }, { from: "spec", on: "accepted", to: "code" }, { from: "commit", on: "stale", to: "lint" }],
    });
    expect(checkRecipe(r, nodes, true)).toContainEqual({ path: "nodes.code", message: "input spec is not produced on every path to code" });
  });

  it("rejects a success outcome that is a fail outcome", () => {
    const r = recipe({ ...local, successOutcomes: ["commit:failed"] });
    expect(checkRecipe(r, nodes, true)).toContainEqual({ path: "successOutcomes.0", message: "failed is a fail outcome of commit" });
  });

  it("requires an edge on skipped for optional nodes", () => {
    const r = recipe({ ...local, nodes: { ...local.nodes, lint: { use: "lint", optional: true } } });
    expect(checkRecipe(r, nodes, true)).toContainEqual({ path: "nodes.lint.optional", message: "optional node lint needs an edge on skipped" });
  });

  it("rejects params overrides on runsAs: engine nodes", () => {
    const engine = check("push", ["pushed", "failed"], { runsAs: "engine", probe: ["true"] });
    const r = recipe({ start: "push", successOutcomes: ["push:pushed"], nodes: { push: { use: "push", params: { x: 1 } } } });
    expect(checkRecipe(r, new Map([["push", engine]]), true)).toContainEqual({ path: "nodes.push.params", message: "params cannot be overridden on a runsAs: engine node" });
  });

  it("rejects a node that needs the project's remote repository only when the project has none (decision 72)", () => {
    const push = check("git-push", ["pushed", "failed"], { runsAs: "engine", probe: ["true"], credentials: ["project.account"] });
    const r = recipe({ start: "push", successOutcomes: ["push:pushed"], nodes: { push: { use: "git-push" } } });
    const pushNodes = new Map<string, Node>([["git-push", push]]);
    expect(checkRecipe(r, pushNodes, false)).toEqual([{ path: "nodes.push.use", message: "git-push needs a remote repository, and this project has none" }]);
    expect(checkRecipe(r, pushNodes, true)).toEqual([]);
  });
});

describe("phase 1 gate: shipped templates", () => {
  it("every template present validates", async () => {
    const lib = await loadLibrary(shippedLibrary);
    expect(lib.errors).toEqual([]);
    expect(lib.nodes.size).toBeGreaterThan(0);
    expect(lib.recipes.has("empty")).toBe(true);
  });
});

describe("instantiate", () => {
  it("copies a node with its script into a project, with the project schema path", async () => {
    const project = await tempDir();
    const r = await instantiateNode(shippedLibrary, project, "git-commit");
    expect(r.errors).toEqual([]);
    expect(r.written.map((f) => f.slice(project.length + 1)).sort()).toEqual(["nodes/git-commit.json", "nodes/git-commit.sh"]);
    expect(JSON.parse(await readFile(join(project, "nodes", "git-commit.json"), "utf8")).$schema).toBe("../../../schemas/node.json");
  });

  it("keeps an existing instance with the same name", async () => {
    const project = await tempDir();
    await mkdir(join(project, "nodes"));
    await writeFile(join(project, "nodes", "typecheck.json"), "{}");
    const r = await instantiateNode(shippedLibrary, project, "typecheck");
    expect(r.kept).toEqual([join(project, "nodes", "typecheck.json")]);
    expect(await readFile(join(project, "nodes", "typecheck.json"), "utf8")).toBe("{}");
  });

  it("instantiates a recipe and gives a valid project", async () => {
    const project = join(await tempDir(), "demo");
    await mkdir(project);
    expect((await instantiateRecipe(shippedLibrary, project, "empty")).errors).toEqual([]);
    await writeFile(join(project, "project.json"), JSON.stringify({
      id: "demo", name: "Demo", repo: null, defaultRecipe: "empty", limits: { jobs: 2, budget: { jobUsd: 5 } },
    }));
    const loaded = await loadProject(project);
    expect(loaded.errors).toEqual([]);
    expect(loaded.project?.baseBranch).toBe("main");
    expect(loaded.project).not.toHaveProperty("limits");
    expect(loaded.project).not.toHaveProperty("defaultRecipe");
  });

  it("refuses a recipe that pushes in a project without a remote repository (decision 72)", async () => {
    const project = join(await tempDir(), "demo");
    await mkdir(project);
    expect((await instantiateRecipe(shippedLibrary, project, "feature")).errors).toEqual([]);
    await writeFile(join(project, "project.json"), JSON.stringify({ id: "demo", name: "Demo", repo: null }));
    const loaded = await loadProject(project);
    expect(loaded.errors.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: "nodes.push.use", message: "git-push needs a remote repository, and this project has none" },
      { path: "nodes.pr.use", message: "github-pr needs a remote repository, and this project has none" },
    ]);
  });
});

describe("global files", () => {
  it("gives defaults when the files are missing", async () => {
    const g = await loadGlobal(await tempDir());
    expect(g.errors).toEqual([]);
    expect(g.value?.settings.minFreeDiskGb).toBe(10);
    expect(g.value?.tiers.tiers.strong).toEqual([]);
  });

  it("rejects profiles of unknown accounts and tiers of unknown profiles", async () => {
    const home = await tempDir();
    await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "opus", account: "nobody", model: "opus" }] }));
    await writeFile(join(home, "tiers.json"), JSON.stringify({ tiers: { strong: ["sonnet"] } }));
    const g = await loadGlobal(home);
    expect(g.errors.map((e) => e.message)).toEqual(["account nobody not found", "profile sonnet not found"]);
  });
});
