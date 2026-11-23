import { describe, expect, it } from "vitest";
import { Recipe } from "./recipe";

const feature = {
  $schema: "../../../schemas/recipe.json",
  name: "feature",
  description: "New feature on existing code: spec, tests, code, checks, review, commit, PR",
  start: "spec",
  onBaseChanged: "rebase",
  maxNodeRuns: 60,
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
    expect(issues({ ...feature, edges: [...feature.edges, { from: "spec", on: "accepted", to: "code" }] })).toContain("edges.22: two edges from spec on accepted");
  });

  it("rejects edges, start and requires that name missing nodes", () => {
    expect(issues({ ...feature, start: "nope" })).toContain("start: nope is not a recipe node");
    expect(issues({ ...feature, edges: [{ from: "spec", on: "accepted", to: "nope" }] })).toContain("edges.0.to: nope is not a recipe node");
    expect(issues({ ...feature, nodes: { ...feature.nodes, commit: { use: "git-commit", requires: ["nope"] } } })).toContain("nodes.commit.requires.0: nope is not a recipe node");
  });

  it("requires a success outcome with no edge", () => {
    expect(issues({ ...feature, successOutcomes: [] })).toContain("successOutcomes: at least one success outcome");
    expect(issues({ ...feature, successOutcomes: ["commit:done"] })).toContain("successOutcomes.0: commit:done has an edge");
  });

  it("rejects providerNot targets that are not recipe nodes", () => {
    expect(issues({ ...feature, nodes: { ...feature.nodes, review: { use: "code-reviewer", agent: { providerNot: ["coder"] } } } })).toContain("nodes.review.agent.providerNot.0: coder is not a recipe node");
  });
});
