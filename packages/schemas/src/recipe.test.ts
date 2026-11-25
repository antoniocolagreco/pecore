import { describe, expect, it } from "vitest";
import { Recipe, RecipeNode } from "./recipe";

it("accepts legacy recipe anchors without retaining them on Start, End or internal connections", () => {
  const recipe: unknown = {
    name: "test", description: "Test recipe", start: "a", startPorts: { sourcePort: "top" },
    nodes: { a: { use: "build" }, b: { use: "test" } },
    edges: [{ from: "a", on: "success", to: "b", sourcePort: "bottom", targetPort: "top", maxRounds: 2 }],
    ends: [{ from: "b", on: "failure", result: "failed", targetPort: "top" }],
  };
  const parsed: Recipe = Recipe.parse(recipe);
  expect(parsed).not.toHaveProperty("startPorts");
  expect(parsed.edges).toEqual([{ from: "a", on: "success", to: "b", maxRounds: 2 }]);
  expect(parsed.ends).toEqual([{ from: "b", on: "failure", result: "failed" }]);
});

const feature = {
  name: "feature",
  description: "New feature on existing code: spec, tests, code, checks, review, commit, PR",
  start: "spec",
  onBaseChanged: "rebase",
  successOutcomes: ["pr:opened"],
  nodes: {
    spec: { use: "spec-writer" },
    tests: { use: "tests-writer" },
    "tests-check": { use: "typecheck" },
    code: { use: "builder" },
    lint: { use: "eslint" },
    types: { use: "typecheck" },
    test: { use: "vitest", params: { suite: "unit" } },
    review: { use: "code-reviewer", agent: { providerNot: ["code"] } },
    approve: { use: "approver" },
    human: { use: "human-review" },
    commit: { use: "git-commit", requires: ["lint", "types", "test", "human"] },
    rebase: { use: "git-rebase" },
    push: { use: "git-push" },
    pr: { use: "github-pr" },
  },
  edges: [
    { from: "spec", on: "accepted", to: "tests" },
    { from: "tests", on: "done", to: "tests-check" },
    { from: "tests-check", on: "failed", to: "tests", maxRounds: 3 },
    { from: "tests-check", on: "passed", to: "code" },
    { from: "code", on: "done", to: "lint" },
    { from: "code", on: "tests_disputed", to: "tests", maxRounds: 2 },
    { from: "lint", on: "passed", to: "types" },
    { from: "types", on: "passed", to: "test" },
    { from: "lint", on: "failed", to: "code", maxRounds: 3 },
    { from: "types", on: "failed", to: "code", maxRounds: 3 },
    { from: "test", on: "failed", to: "code", maxRounds: 3 },
    { from: "test", on: "passed", to: "review" },
    { from: "review", on: "changes", to: "code", maxRounds: 3 },
    { from: "review", on: "approve", to: "approve" },
    { from: "approve", on: "done", to: "human" },
    { from: "human", on: "approve", to: "commit" },
    { from: "human", on: "changes", to: "code" },
    { from: "commit", on: "done", to: "push" },
    { from: "commit", on: "stale", to: "lint" },
    { from: "push", on: "pushed", to: "pr" },
    { from: "rebase", on: "clean", to: "lint" },
    { from: "rebase", on: "conflict", to: "code" },
  ],
};

const issues = (value: unknown) => {
  const r = Recipe.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("recipe schema", () => {
  it("validates agent step overrides and ignores old session groups", () => {
    const step: RecipeNode = RecipeNode.parse({ use: "builder", agentId: "reviewer", agentContext: "isolated", session: "previous" });
    expect(step).toMatchObject({ agentId: "reviewer", agentSession: "new" });
    expect(step).not.toHaveProperty("session");
    expect(step).not.toHaveProperty("agentContext");
    expect(RecipeNode.parse({ use: "builder" })).not.toHaveProperty("agentSession");
    expect(RecipeNode.parse({ use: "builder", agentContext: "shared" })).toMatchObject({ agentSession: "job" });
    for (const agentSession of ["job", "node", "new"]) {
      expect(RecipeNode.parse({ use: "builder", agentSession })).toMatchObject({ agentSession });
    }
    expect(RecipeNode.safeParse({ use: "builder", agentSession: "isolated" }).success).toBe(false);
    expect(RecipeNode.safeParse({ use: "builder", agentId: "assistant" }).success).toBe(false);
  });

  it("accepts the feature recipe of design 3.2", () => {
    expect(issues(feature)).toEqual([]);
  });

  it("accepts the empty recipe", () => {
    expect(issues({ name: "empty", description: "No nodes" })).toEqual([]);
  });

  it("limits the name to 24 characters so it fits on its card", () => {
    expect(issues({ name: "feature-to-local-commits", description: "No nodes" })).toEqual([]);
    expect(issues({ name: "feature-to-local-commitss", description: "No nodes" })).toEqual(["name: at most 24 characters, so it fits on its card"]);
  });

  it("rejects two edges with the same from and on", () => {
    expect(issues({ ...feature, edges: [...feature.edges, { from: "spec", on: "accepted", to: "code" }] })).toContain("edges.22: Spec Writer has two connections for Accepted. Keep only one.");
  });

  it("rejects edges, start and requires that name missing nodes", () => {
    expect(issues({ ...feature, start: "nope" })).toContain("start: Start points to Nope, which is missing. Connect Start to an existing step.");
    expect(issues({ ...feature, edges: [{ from: "spec", on: "accepted", to: "nope" }] })).toContain("edges.0.to: Spec Writer connects to Nope, which is missing. Choose another destination.");
    expect(issues({ ...feature, nodes: { ...feature.nodes, commit: { use: "git-commit", requires: ["nope"] } } })).toContain("nodes.commit.requires.0: Git Commit requires Nope, which is missing. Choose an existing step in Requires.");
  });

  it("reads only recipe nodes, each once", () => {
    expect(issues({ ...feature, nodes: { ...feature.nodes, code: { use: "builder", reads: ["spec", "review"] } } })).toEqual([]);
    expect(issues({ ...feature, nodes: { ...feature.nodes, code: { use: "builder", reads: ["nope"] } } })).toContain("nodes.code.reads.0: Builder reads from Nope, which is missing. Choose an existing step in Reads from.");
    expect(issues({ ...feature, nodes: { ...feature.nodes, code: { use: "builder", reads: ["spec", "spec"] } } })).toContain("nodes.code.reads: Builder reads the same step twice. Select it once in Reads from.");
  });

  it("requires a success outcome with no edge", () => {
    expect(issues({ ...feature, successOutcomes: [] })).toContain("successOutcomes: Choose at least one outcome that ends the job successfully.");
    expect(issues({ ...feature, successOutcomes: ["commit:done"] })).toContain("successOutcomes.0: Done on Git Commit already goes to another step. Choose one destination.");
  });

  it("rejects providerNot targets that are not recipe nodes", () => {
    expect(issues({ ...feature, nodes: { ...feature.nodes, review: { use: "code-reviewer", agent: { providerNot: ["coder"] } } } })).toContain("nodes.review.agent.providerNot.0: The provider restriction on Code Reviewer refers to Coder, which is missing. Choose an existing Agent step.");
  });
});
