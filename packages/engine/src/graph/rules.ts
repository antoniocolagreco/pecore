import type { Node, Recipe } from "@pecore/schemas";

export type RunRecord = { nodeId: string; outcome: string; viaEdge: number | null };

export type Allowances = { extraRounds: Record<number, number>; extraNodeRuns: number };

export type Decision =
  | { kind: "run"; nodeId: string; round: number; viaEdge: number | null }
  | { kind: "end"; state: "succeeded" | "not_delivered" | "failed"; reason: string | null }
  | { kind: "round_limit"; edge: number | null; cap: "maxRounds" | "maxNodeRuns" };

export const noAllowances: Allowances = { extraRounds: {}, extraNodeRuns: 0 };

function roundOf(history: RunRecord[], nodeId: string): number {
  return history.filter((h) => h.nodeId === nodeId).length;
}

function runIfAllowed(recipe: Recipe, history: RunRecord[], nodeId: string, viaEdge: number | null, allow: Allowances): Decision {
  if (history.length >= recipe.maxNodeRuns + allow.extraNodeRuns) return { kind: "round_limit", edge: viaEdge, cap: "maxNodeRuns" };
  return { kind: "run", nodeId, round: roundOf(history, nodeId), viaEdge };
}

export function endOf(recipe: Recipe, byId: Map<string, Node>, nodeId: string, outcome: string): Decision & { kind: "end" } {
  const reason = `${nodeId}:${outcome}`;
  const node = byId.get(nodeId);
  const failOutcomes = node && node.kind !== "source" ? node.failOutcomes : [];
  const ciFailed: boolean = recipe.ci?.after === nodeId && ["ci_failed", "ci_exhausted", "ci_timeout"].includes(outcome);
  if (outcome === "stale" || failOutcomes.includes(outcome) || ciFailed) return { kind: "end", state: "failed", reason };
  if (recipe.successOutcomes.includes(reason)) return { kind: "end", state: "succeeded", reason };
  return { kind: "end", state: "not_delivered", reason };
}

export function nextStep(recipe: Recipe, byId: Map<string, Node>, history: RunRecord[], allow: Allowances = noAllowances): Decision {
  if (Object.keys(recipe.nodes).length === 0) return { kind: "end", state: "succeeded", reason: null };
  const last = history.at(-1);
  if (!last) return runIfAllowed(recipe, history, recipe.start!, null, allow);
  const edgeIndex = recipe.edges.findIndex((e) => e.from === last.nodeId && e.on === last.outcome);
  if (edgeIndex < 0) return endOf(recipe, byId, last.nodeId, last.outcome);
  const edge = recipe.edges[edgeIndex]!;
  if (edge.maxRounds !== undefined) {
    const taken = history.filter((h) => h.viaEdge === edgeIndex).length;
    if (taken >= edge.maxRounds + (allow.extraRounds[edgeIndex] ?? 0)) return { kind: "round_limit", edge: edgeIndex, cap: "maxRounds" };
  }
  return runIfAllowed(recipe, history, edge.to, edgeIndex, allow);
}

export function reenterOnBaseChange(recipe: Recipe, history: RunRecord[], allow: Allowances = noAllowances): Decision | null {
  if (recipe.onBaseChanged === undefined) return null;
  return runIfAllowed(recipe, history, recipe.onBaseChanged, null, allow);
}
