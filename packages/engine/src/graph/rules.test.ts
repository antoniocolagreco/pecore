import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Node, Recipe } from "@pecore/schemas";
import { canTransition } from "./job-machine";
import { endOf, nextStep, reenterOnBaseChange } from "./rules";
import type { RunRecord } from "./rules";

const mkNode = (name: string, outcomes: string[], failOutcomes: string[] = []) =>
  Node.parse({ name, description: name, kind: "command", command: ["true"], outcomes, failOutcomes, changesFiles: false, outcomeRules: [{ exitCode: "other", outcome: outcomes[0] }], timeoutSec: 1 });

const outcomeNames = ["a", "b", "c"];

const arbGraph = fc
  .record({
    size: fc.integer({ min: 1, max: 6 }),
    maxNodeRuns: fc.integer({ min: 1, max: 30 }),
    edges: fc.array(fc.record({ from: fc.nat(5), on: fc.constantFrom(...outcomeNames), to: fc.nat(5), maxRounds: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }) }), { maxLength: 15 }),
    fails: fc.subarray(outcomeNames),
  })
  .map(({ size, maxNodeRuns, edges, fails }) => {
    const ids = Array.from({ length: size }, (_, i) => `n${i}`);
    const seen = new Set<string>();
    const es = edges
      .map((e) => ({ from: ids[e.from % size]!, on: e.on, to: ids[e.to % size]!, ...(e.maxRounds ? { maxRounds: e.maxRounds } : {}) }))
      .filter((e) => (seen.has(`${e.from}:${e.on}`) ? false : (seen.add(`${e.from}:${e.on}`), true)));
    const recipe = Recipe.parse({
      name: "r",
      description: "r",
      start: "n0",
      maxNodeRuns,
      successOutcomes: ["n0:done"],
      nodes: Object.fromEntries(ids.map((id) => [id, { use: id }])),
      edges: es,
    });
    const byId = new Map(ids.map((id) => [id, mkNode(id, [...outcomeNames, "done"], fails)]));
    return { recipe, byId };
  });

function simulate(recipe: Recipe, byId: Map<string, Node>, choose: (i: number) => string) {
  const history: RunRecord[] = [];
  for (let step = 0; step < 1000; step++) {
    const d = nextStep(recipe, byId, history);
    if (d.kind !== "run") return { history, last: d };
    history.push({ nodeId: d.nodeId, outcome: choose(step), viaEdge: d.viaEdge });
  }
  throw new Error("did not terminate");
}

describe("graph rules (4.2), property tests", () => {
  it("every job ends or stops at a round limit, and node runs never exceed maxNodeRuns", () => {
    fc.assert(
      fc.property(arbGraph, fc.array(fc.constantFrom(...outcomeNames), { minLength: 1, maxLength: 50 }), ({ recipe, byId }, picks) => {
        const { history, last } = simulate(recipe, byId, (i) => picks[i % picks.length]!);
        expect(["end", "round_limit"]).toContain(last.kind);
        expect(history.length).toBeLessThanOrEqual(recipe.maxNodeRuns);
      }),
    );
  });

  it("an edge never sends the job back more than maxRounds times", () => {
    fc.assert(
      fc.property(arbGraph, fc.array(fc.constantFrom(...outcomeNames), { minLength: 1, maxLength: 50 }), ({ recipe, byId }, picks) => {
        const { history } = simulate(recipe, byId, (i) => picks[i % picks.length]!);
        recipe.edges.forEach((e, i) => {
          if (e.maxRounds !== undefined) expect(history.filter((h) => h.viaEdge === i).length).toBeLessThanOrEqual(e.maxRounds);
        });
      }),
    );
  });

  it("rounds count earlier runs of the same node", () => {
    fc.assert(
      fc.property(arbGraph, fc.array(fc.constantFrom(...outcomeNames), { minLength: 1, maxLength: 50 }), ({ recipe, byId }, picks) => {
        const history: RunRecord[] = [];
        for (let i = 0; i < 40; i++) {
          const d = nextStep(recipe, byId, history);
          if (d.kind !== "run") break;
          expect(d.round).toBe(history.filter((h) => h.nodeId === d.nodeId).length);
          history.push({ nodeId: d.nodeId, outcome: picks[i % picks.length]!, viaEdge: d.viaEdge });
        }
      }),
    );
  });
});

describe("graph rules (4.2), examples", () => {
  const recipe = Recipe.parse({
    name: "r",
    description: "r",
    start: "lint",
    onBaseChanged: "lint",
    maxNodeRuns: 10,
    successOutcomes: ["commit:done"],
    nodes: { lint: { use: "lint" }, commit: { use: "commit" } },
    edges: [
      { from: "lint", on: "passed", to: "commit" },
      { from: "lint", on: "failed", to: "lint", maxRounds: 2 },
    ],
  });
  const byId = new Map([
    ["lint", mkNode("lint", ["passed", "failed", "broken"], ["broken"])],
    ["commit", mkNode("commit", ["done", "rejected"])],
  ]);

  it("ends succeeded, failed or not_delivered on an outcome with no edge", () => {
    expect(endOf(recipe, byId, "commit", "done")).toEqual({ kind: "end", state: "succeeded", reason: "commit:done" });
    expect(endOf(recipe, byId, "lint", "broken")).toEqual({ kind: "end", state: "failed", reason: "lint:broken" });
    expect(endOf(recipe, byId, "commit", "stale")).toEqual({ kind: "end", state: "failed", reason: "commit:stale" });
    expect(endOf(recipe, byId, "commit", "rejected")).toEqual({ kind: "end", state: "not_delivered", reason: "commit:rejected" });
  });

  it("uses the result configured on each connection to End", () => {
    const explicit: Recipe = Recipe.parse({
      name: "review",
      description: "Review before delivery",
      start: "review",
      nodes: { review: { use: "human-review" }, fix: { use: "builder" } },
      edges: [{ from: "review", on: "changes", to: "fix" }, { from: "fix", on: "done", to: "review" }],
      ends: [{ from: "review", on: "approve", result: "succeeded" }, { from: "review", on: "reject", result: "failed" }],
    });
    expect(nextStep(explicit, byId, [])).toEqual({ kind: "run", nodeId: "review", round: 0, viaEdge: null });
    expect(nextStep(explicit, byId, [{ nodeId: "review", outcome: "approve", viaEdge: null }])).toEqual({
      kind: "end", state: "succeeded", reason: "review:approve",
    });
    expect(nextStep(explicit, byId, [{ nodeId: "review", outcome: "reject", viaEdge: null }])).toEqual({
      kind: "end", state: "failed", reason: "review:reject",
    });
    expect(nextStep(explicit, byId, [{ nodeId: "review", outcome: "changes", viaEdge: null }])).toEqual({
      kind: "run", nodeId: "fix", round: 0, viaEdge: 0,
    });
    expect(nextStep(explicit, byId, [{ nodeId: "review", outcome: "unknown", viaEdge: null }])).toEqual({
      kind: "invalid_route", reason: "unrouted_outcome:review:unknown",
    });
  });

  it("asks at the round limit and continues with allowances", () => {
    const h: RunRecord[] = [
      { nodeId: "lint", outcome: "failed", viaEdge: null },
      { nodeId: "lint", outcome: "failed", viaEdge: 1 },
      { nodeId: "lint", outcome: "failed", viaEdge: 1 },
    ];
    expect(nextStep(recipe, byId, h)).toEqual({ kind: "round_limit", edge: 1, cap: "maxRounds" });
    expect(nextStep(recipe, byId, h, { extraRounds: { 1: 1 }, extraNodeRuns: 0 })).toEqual({ kind: "run", nodeId: "lint", round: 3, viaEdge: 1 });
  });

  it("the empty recipe ends succeeded", () => {
    expect(nextStep(Recipe.parse({ name: "e", description: "e" }), new Map(), [])).toEqual({ kind: "end", state: "succeeded", reason: null });
  });

  it("re-enters at onBaseChanged", () => {
    expect(reenterOnBaseChange(recipe, [{ nodeId: "lint", outcome: "passed", viaEdge: null }])).toEqual({ kind: "run", nodeId: "lint", round: 1, viaEdge: null });
  });
});

describe("job states (4.1)", () => {
  it("allows resume only from failed or stopped and not archived; base change only from succeeded or not_delivered", () => {
    expect(canTransition("failed", "running", { archived: false, cause: "resume" })).toBe(true);
    expect(canTransition("failed", "running", { archived: true, cause: "resume" })).toBe(false);
    expect(canTransition("succeeded", "running", { archived: true, cause: "base_change" })).toBe(true);
    expect(canTransition("succeeded", "running", { archived: false, cause: "resume" })).toBe(false);
    expect(canTransition("queued", "waiting", { archived: false })).toBe(false);
    expect(canTransition("paused", "waiting", { archived: false })).toBe(true);
  });
});
