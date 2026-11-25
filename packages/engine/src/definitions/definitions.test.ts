import { describe, expect, it } from "vitest";
import { Node, Recipe } from "@pecore/schemas";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { apiProject } from "../../test/api-project";
import type { RouteOutput } from "@pecore/schemas";
import { setTestConfiguration, testConfiguration } from "../../test/configuration";
import { loadTemplates, validateGlobal } from "./load";
import { checkRecipe, hasCommitNode } from "./recipe-check";
import { outcomeRenames } from "./outcomes";

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
    expect(checkRecipe(missing, nodes, false)).toContainEqual({ path: "nodes.lint", message: "Connect the remaining outcomes of Lint to another step or End (Failed)." });
    expect(checkRecipe(unknown, nodes, false)).toContainEqual({ path: "ends.0.on", message: "Lint has no Missing outcome. Choose another outcome for this connection to End." });
  });

  it("rejects a missing node instance", () => {
    expect(checkRecipe(recipe({ ...local, nodes: { ...local.nodes, lint: { use: "eslint" } } }), nodes, true)).toContainEqual({ path: "nodes.lint.use", message: "The ESLint node template is missing. Choose another node." });
  });

  it("accepts card and session overrides only on agent steps", () => {
    const valid: Recipe = recipe({ ...local, nodes: { ...local.nodes, code: { use: "builder", agentId: "reviewer", agentSession: "new" } } });
    expect(checkRecipe(valid, nodes, false)).toEqual([]);
    const invalid: Recipe = recipe({ ...local, nodes: { ...local.nodes, lint: { use: "lint", agentId: "reviewer", agentSession: "new" } } });
    expect(checkRecipe(invalid, nodes, false)).toEqual([
      { path: "nodes.lint.agentId", message: "Choose an Agent node to use agent settings. Lint is a different kind of node." },
      { path: "nodes.lint.agentSession", message: "Choose an Agent node to use agent settings. Lint is a different kind of node." },
    ]);
  });

  it("rejects an edge on an outcome the node does not produce, and allows stale only with requires", () => {
    const edges = [...local.edges, { from: "code", on: "stale", to: "lint" }];
    expect(checkRecipe(recipe({ ...local, edges }), nodes, true)).toContainEqual({ path: "edges.5.on", message: "Builder has no Stale outcome. Choose another outcome for this connection." });
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
    expect(checkRecipe(publishing({ reads: ["spec"] }, throughSpec), nodes, true)).toContainEqual({ path: "nodes.publish.reads", message: "Publish needs the spec from Spec Writer. A path reaches Publish without that output. Route it through an outcome of Spec Writer that produces the spec." });
    expect(checkRecipe(publishing({ reads: ["spec"] }, onlyAccepted), nodes, true)).toEqual([]);
  });

  it("asks a command to read a node that produces each required input", () => {
    expect(checkRecipe(publishing({}, throughSpec), nodes, true)).toContainEqual({ path: "nodes.publish.reads", message: "Publish needs a spec input. Select a step that produces it in Reads from." });
  });

  it("rejects two read nodes that produce the same input of a command", () => {
    expect(checkRecipe(publishing({ reads: ["spec", "lint"] }, onlyAccepted), nodes, true)).toContainEqual({ path: "nodes.publish.reads", message: "Spec Writer and Lint produce the same input for Publish (text). Select one source in Reads from." });
  });

  it("rejects reading a node that produces nothing", () => {
    const silent = new Map<string, Node>([...nodes, ["lint", check("lint", ["passed", "failed"], { command: ["true"] })], ["quiet", Node.parse({ ...writer, name: "quiet", outputs: {} })]]);
    const r = recipe({ ...local, nodes: { ...local.nodes, code: { use: "builder", reads: ["spec"] }, spec: { use: "quiet" } } });
    expect(checkRecipe(r, silent, true)).toContainEqual({ path: "nodes.code.reads", message: "Quiet produces no output for Builder to read. Remove it from Reads from." });
  });

  it("rejects a success outcome that is a fail outcome", () => {
    const r = recipe({ ...local, successOutcomes: ["commit:failed"] });
    expect(checkRecipe(r, nodes, true)).toContainEqual({ path: "successOutcomes.0", message: "Git Commit reports Failed as a failure. Choose another outcome to end the job successfully." });
  });

  it("requires an edge on skipped for optional nodes", () => {
    const r = recipe({ ...local, nodes: { ...local.nodes, lint: { use: "lint", optional: true } } });
    expect(checkRecipe(r, nodes, true)).toContainEqual({ path: "nodes.lint.optional", message: "Connect the Skipped outcome of Lint to another step or End." });
  });

  it("rejects params overrides on Repository nodes", () => {
    const repository: Node = Node.parse({ name: "push", description: "Push", kind: "repository", script: "true", account: "project.account",
      outcomes: ["pushed", "failed"], outcomeRules: [{ exitCode: 0, outcome: "pushed" }] });
    const r = recipe({ start: "push", successOutcomes: ["push:pushed"], nodes: { push: { use: "push", params: { x: 1 } } } });
    expect(checkRecipe(r, new Map([["push", repository]]), true)).toContainEqual({ path: "nodes.push.params", message: "Recipes cannot change parameters for Repository nodes." });
  });

  it("rejects a node that needs the project's remote repository only when the project has none (decision 72)", () => {
    const push: Node = Node.parse({ name: "git-push", description: "Push a branch", kind: "repository", script: "true", account: "project.account",
      outcomes: ["pushed", "failed"], outcomeRules: [{ exitCode: 0, outcome: "pushed" }] });
    const r = recipe({ start: "push", successOutcomes: ["push:pushed"], nodes: { push: { use: "git-push" } } });
    const pushNodes = new Map<string, Node>([["git-push", push]]);
    expect(checkRecipe(r, pushNodes, false)).toEqual([{ path: "nodes.push.use", message: "Git Push needs a remote repository. Add one in Project Settings or remove this step." }]);
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

  it("identifies the base-change route that bypasses the spec after adding Read Ticket", async () => {
    const library = await loadTemplates(shippedTemplates);
    const bugfix: Recipe = library.recipes.get("bugfix-to-pr")!;
    const draft: Recipe = Recipe.parse({
      ...bugfix, start: "ticket", nodes: { ...bugfix.nodes, ticket: { use: "github-ticket-read" } },
      edges: [...bugfix.edges, { from: "ticket", on: "success", to: "spec" }],
      ends: [...bugfix.ends!, { from: "ticket", on: "failure", result: "failed" }],
    });
    expect(checkRecipe(draft, library.nodes, true)).toContainEqual({
      path: "nodes.pr.reads",
      message: "GitHub PR needs the spec from Spec Writer. A base change can restart at Git Rebase before Spec Writer has produced it. Route that branch through Spec Writer, or clear the base-change step in Recipe settings and remove the disconnected steps.",
    });
    const throughSpec: Recipe = Recipe.parse({
      ...draft, edges: draft.edges.map((edge) =>
        (edge.from === "rebase" || edge.from === "resolve-conflicts") && edge.on === "success" ? { ...edge, to: "spec" } : edge),
    });
    expect(checkRecipe(throughSpec, library.nodes, true)).toEqual([]);
    const fromStart: Recipe = Recipe.parse({
      ...draft, onBaseChanged: undefined,
      nodes: Object.fromEntries(Object.entries(draft.nodes).filter(([id]) => id !== "rebase" && id !== "resolve-conflicts")),
      edges: draft.edges.filter(({ from }) => from !== "rebase" && from !== "resolve-conflicts"),
      ends: draft.ends!.filter(({ from }) => from !== "resolve-conflicts"),
    });
    expect(checkRecipe(fromStart, library.nodes, true)).toEqual([]);
    const bypass: Recipe = Recipe.parse({
      ...fromStart, edges: [...fromStart.edges, { from: "ticket", on: "failure", to: "lint" }],
      ends: fromStart.ends!.filter(({ from }) => from !== "ticket"),
    });
    expect(checkRecipe(bypass, library.nodes, true)).toContainEqual({
      path: "nodes.pr.reads",
      message: "GitHub PR needs the spec from Spec Writer. A path reaches GitHub PR without that output. Route it through an outcome of Spec Writer that produces the spec.",
    });
  });

  it.each([
    ["bugfix-to-pr", "4d0acdff4b1fabe0efe99ac544d2394d82cb6dbe2acfc9447a3e4353f470e8dc"],
    ["feature-to-local-commit", "6731b23e11f93e40e02e6717b1ce3ec6490fdfa78b63e1b3a9e97e4650997e1e"],
    ["feature-to-pr", "8f1c560073c868bbad2f72aeb939f2b666282c231158ed87b3e2f690272c887f"],
  ])("preserves every route of %s when outcomes are identified by their position", async (name, before) => {
    const { nodes } = await loadTemplates(shippedTemplates);
    const recipe: Recipe = JSON.parse(await readFile(join(shippedTemplates, "recipes", name + ".json"), "utf8"));
    const route = ({ from, on, ...edge }: Recipe["edges"][number] | NonNullable<Recipe["ends"]>[number]) => {
      const index: number = nodes.get(recipe.nodes[from]!.use)!.outcomes.indexOf(on);
      return { from, on: index >= 0 ? index : on, ...edge };
    };
    const graph = { ...recipe, edges: recipe.edges.map(route), ends: recipe.ends!.map(route) };
    expect(createHash("sha256").update(JSON.stringify(graph)).digest("hex")).toBe(before);
  });

  it("ships only standard results, distinct paths and literal decision answers", async () => {
    const { nodes } = await loadTemplates(shippedTemplates);
    const extras: [string, string[]][] = [...nodes].flatMap(([name, node]) => {
      const named: string[] = node.outcomes.filter((outcome) => outcome !== "success" && outcome !== "failure");
      return named.length ? [[name, named]] : [];
    });
    expect(extras).toEqual([
      ["builder", ["tests_disputed"]],
      ["code-reviewer", ["approved", "changes_requested"]],
      ["git-rebase", ["rebase_conflict"]],
      ["human-decision", ["yes", "no"]],
      ["human-review", ["approved", "changes_requested", "rejected"]],
      ["spec-writer", ["rejected"]],
    ]);
  });

  it("ships failure routes for Jira MCP operations and leaves successful agent completions alone", async () => {
    const { nodes } = await loadTemplates(shippedTemplates);
    for (const name of ["jira-mcp-ticket-read", "jira-mcp-ticket-search", "jira-mcp-issue-comment"]) {
      expect(nodes.get(name)).toMatchObject({
        outcomes: ["success", "failure"], failOutcomes: ["failure"],
        outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
      });
    }
    for (const name of ["approver", "tests-writer", "write-pr"]) expect(nodes.get(name)?.outcomes).toEqual(["success"]);
  });

  it("retains separately routed custom outcomes and literal answers during migration", () => {
    expect([...outcomeRenames("custom-check", ["done", "passed", "failed"])]).toEqual([["failed", "failure"]]);
    expect([...outcomeRenames("custom-question", ["ok", "no"], "decision")]).toEqual([]);
  });

  it("ships independent sessions for reviewers and shared sessions for the other agents", async () => {
    const { nodes } = await loadTemplates(shippedTemplates);
    const sessions: [string, string][] = [...nodes.values()].flatMap((node): [string, string][] =>
      node.kind === "agent" ? [[node.name, node.agentSession]] : []);
    expect(sessions.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["approver", "new"], ["builder", "job"], ["code-reviewer", "new"],
      ["resolve-rebase-conflicts", "job"], ["spec-writer", "job"], ["tests-writer", "job"], ["write-pr", "job"],
    ]);
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
        .rejects.toThrow("Git Push needs a remote repository");
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
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
