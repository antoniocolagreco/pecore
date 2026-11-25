import { describe, expect, it } from "vitest";
import { Node, Recipe } from "@pecore/schemas";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { apiProject } from "../../test/api-project";
import type { RouteOutput } from "@pecore/schemas";
import { setTestConfiguration, testConfiguration } from "../../test/configuration";
import { loadTemplates, validateGlobal } from "./load";
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
  outcomes: ["accepted", "rejected"],
  outputs: { accepted: "spec", rejected: "text" },
  changesFiles: false,
  timeoutSec: 600,
});

const builder = Node.parse({
  name: "builder",
  description: "writes code",
  kind: "agent",
  prompt: "builder.md",
  agent: { tier: "strong" },
  outcomes: ["done"],
  changesFiles: true,
  timeoutSec: 600,
});

const nodes = new Map<string, Node>([
  ["spec-writer", writer],
  ["builder", builder],
  ["lint", check("lint", ["passed", "failed"])],
  ["git-commit", check("git-commit", ["done", "failed"], { outputs: { done: "reference" }, outputRules: { done: { stdoutLastLine: "sha" } } })],
  ["publish", check("publish", ["done"], { inputs: ["spec"], optionalInputs: ["text"] })],
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

  it("requires each outcome to continue or reach End", () => {
    const valid: Recipe = recipe({
      start: "lint",
      nodes: { lint: { use: "lint" } },
      ends: [{ from: "lint", on: "passed", result: "succeeded" }, { from: "lint", on: "failed", result: "failed" }],
    });
    const missing: Recipe = recipe({ ...valid, ends: [{ from: "lint", on: "passed", result: "succeeded" }] });
    const unknown: Recipe = recipe({ ...valid, ends: [{ from: "lint", on: "missing", result: "succeeded" }] });
    expect(checkRecipe(valid, nodes, false)).toEqual([]);
    expect(checkRecipe(missing, nodes, false)).toContainEqual({ path: "nodes.lint", message: "connect these outcomes: failed" });
    expect(checkRecipe(unknown, nodes, false)).toContainEqual({ path: "ends.0.on", message: "missing is not an outcome of lint" });
  });

  it("rejects a missing node instance", () => {
    expect(checkRecipe(recipe({ ...local, nodes: { ...local.nodes, lint: { use: "eslint" } } }), nodes, true)).toContainEqual({ path: "nodes.lint.use", message: "node eslint not found" });
  });

  it("rejects an edge on an outcome the node does not produce, and allows stale only with requires", () => {
    const edges = [...local.edges, { from: "code", on: "stale", to: "lint" }];
    expect(checkRecipe(recipe({ ...local, edges }), nodes, true)).toContainEqual({ path: "edges.5.on", message: "stale is not an outcome of code" });
  });

  const publishing = (publish: object, edges: object[]) => recipe({
    start: "spec",
    successOutcomes: ["publish:done"],
    nodes: { spec: { use: "spec-writer" }, lint: { use: "lint" }, code: { use: "builder" }, publish: { use: "publish", ...publish } },
    edges,
  });
  const throughSpec = [
    { from: "spec", on: "accepted", to: "lint" },
    { from: "spec", on: "rejected", to: "code" },
    { from: "code", on: "done", to: "lint" },
    { from: "lint", on: "passed", to: "publish" },
    { from: "lint", on: "failed", to: "code" },
  ];
  const onlyAccepted = throughSpec.filter((edge) => edge.on !== "rejected");

  it("gives a command its required input from the node it reads, on every path", () => {
    expect(checkRecipe(publishing({ reads: ["spec"] }, throughSpec), nodes, true)).toContainEqual({ path: "nodes.publish.reads", message: "spec from spec is not produced on every path to publish" });
    expect(checkRecipe(publishing({ reads: ["spec"] }, onlyAccepted), nodes, true)).toEqual([]);
  });

  it("asks a command to read a node that produces each required input", () => {
    expect(checkRecipe(publishing({}, throughSpec), nodes, true)).toContainEqual({ path: "nodes.publish.reads", message: "read a node that produces spec" });
  });

  it("rejects two read nodes that produce the same input of a command", () => {
    expect(checkRecipe(publishing({ reads: ["spec", "lint"] }, onlyAccepted), nodes, true)).toContainEqual({ path: "nodes.publish.reads", message: "spec and lint both produce text; read only one" });
  });

  it("rejects reading a node that produces nothing", () => {
    const silent = new Map<string, Node>([...nodes, ["lint", check("lint", ["passed", "failed"], { command: ["true"] })], ["quiet", Node.parse({ ...writer, name: "quiet", outputs: {} })]]);
    const r = recipe({ ...local, nodes: { ...local.nodes, code: { use: "builder", reads: ["spec"] }, spec: { use: "quiet" } } });
    expect(checkRecipe(r, silent, true)).toContainEqual({ path: "nodes.code.reads", message: "spec produces nothing to read" });
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
    const lib = await loadTemplates(shippedTemplates);
    expect(lib.errors).toEqual([]);
    expect(lib.nodes.size).toBeGreaterThan(0);
    expect(lib.recipes.has("feature-to-pr")).toBe(true);
  });
});
describe("instantiate", () => {
  it("copies a node and its script to a project's catalog, and keeps an edited instance", async () => {
    const { engine, call, close } = await apiProject();
    try {
      const { ctx } = engine.project("demo");
      ctx.db.definition.write({ ...ctx.project, recipes: undefined });
      await engine.reloadProject("demo");
      const body: { kind: "node"; name: string; project: string } = { kind: "node", name: "git-commit", project: "demo" };
      expect(await call("instantiate", { body })).toMatchObject({
        created: ["projects/demo/nodes/git-commit.json", "projects/demo/nodes/git-commit.sh"], kept: [],
      });
      expect(ctx.db.catalog.content("git-commit.sh")).toBe(engine.catalog.content("git-commit.sh"));
      const node: Node = ctx.db.catalog.node("git-commit")!;
      ctx.db.catalog.saveNode({ ...node, description: "My commit" });
      expect(await call("instantiate", { body })).toMatchObject({ created: [], kept: ["projects/demo/nodes/git-commit.json"] });
      expect(ctx.db.catalog.node("git-commit")?.description).toBe("My commit");
    } finally {
      await close();
    }
  });

  it("instantiates a valid local recipe and rejects a delivery recipe", async () => {
    const { engine, call, close } = await apiProject();
    try {
      const { ctx } = engine.project("demo");
      ctx.db.definition.write({ ...ctx.project, recipes: undefined });
      await engine.reloadProject("demo");
      await expect(call("instantiate", { body: { kind: "recipe", name: "feature-to-pr", project: "demo" } }))
        .rejects.toThrow("git-push needs a remote repository");
      expect(ctx.db.catalog.node("git-push")).toBeNull();
      const response: RouteOutput<"instantiate"> = await call("instantiate", { body: { kind: "recipe", name: "feature-to-local-commit", project: "demo" } });
      expect(response.created).toContain("projects/demo/recipes/feature-to-local-commit.json");
      expect(ctx.defs.errors).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("global configuration", () => {
  it("gives defaults when the tables are empty", async () => {
    const g = await testConfiguration(await tempDir(), (config) => config.read());
    expect(validateGlobal(g)).toEqual([]);
    expect(g.settings.minFreeDiskGb).toBe(10);
    expect(g.tiers.tiers.strong).toEqual([]);
  });

  it("rejects profiles of unknown accounts and tiers of unknown profiles", async () => {
    const home = await tempDir();
    await setTestConfiguration(home, "profiles", { profiles: [{ id: "opus", account: "nobody", model: "opus" }] });
    await setTestConfiguration(home, "tiers", { tiers: { strong: ["sonnet"] } });
    const g = await testConfiguration(home, (config) => config.read());
    expect(validateGlobal(g).map((e) => e.message)).toEqual(["account nobody not found", "profile sonnet not found"]);
  });

});
