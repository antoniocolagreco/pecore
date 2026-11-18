import type { ArtifactType, Node, Recipe } from "@pecore/schemas";

export type RecipeIssue = { path: string; message: string };

export function nodeOutcomes(recipe: Recipe, id: string, node: Node): string[] {
  if (node.kind === "source") return [];
  const r = recipe.nodes[id];
  const out = [...node.outcomes];
  if (r && r.requires.length > 0) out.push("stale");
  if (r?.optional) out.push("skipped");
  return out;
}

function produced(node: Node): ArtifactType[] {
  if (node.kind === "source") return [];
  const out = [...node.outputs];
  if (node.changesFiles) out.push("diff");
  if (node.kind === "human" && node.answer) out.push("user-note");
  if (node.kind === "command") out.push("check-log");
  return out;
}

export function availableInputs(recipe: Recipe, byId: Map<string, Node>): Map<string, Set<ArtifactType>> {
  const ids = Object.keys(recipe.nodes);
  const all = new Set<ArtifactType>(["ticket", "spec", "findings", "risk", "check-log", "diff", "user-note", "commit", "delivery"]);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of recipe.edges) preds.get(e.to)?.push(e.from);
  const startNode = recipe.start !== undefined ? byId.get(recipe.start) : undefined;
  const entry = new Map<string, Set<ArtifactType>>();
  if (recipe.start !== undefined) entry.set(recipe.start, new Set(["ticket"]));
  if (recipe.onBaseChanged !== undefined) entry.set(recipe.onBaseChanged, new Set<ArtifactType>(["ticket", ...(startNode ? produced(startNode) : [])]));
  const roots = new Set(entry.keys());
  const avail = new Map<string, Set<ArtifactType>>(ids.map((id) => [id, roots.has(id) && preds.get(id)!.length === 0 ? new Set(entry.get(id)) : new Set(all)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      const sources: Set<ArtifactType>[] = [];
      if (roots.has(id)) sources.push(new Set(entry.get(id)));
      for (const p of preds.get(id)!) {
        const pn = byId.get(p);
        sources.push(new Set([...avail.get(p)!, ...(pn ? produced(pn) : [])]));
      }
      if (sources.length === 0) continue;
      const next = new Set([...sources[0]!].filter((t) => sources.every((s) => s.has(t))));
      const cur = avail.get(id)!;
      if (next.size !== cur.size || [...next].some((t) => !cur.has(t))) {
        avail.set(id, next);
        changed = true;
      }
    }
  }
  return avail;
}

export function reachable(recipe: Recipe): Set<string> {
  const seen = new Set<string>();
  const stack = [recipe.start, recipe.onBaseChanged].filter((x): x is string => x !== undefined);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of recipe.edges) if (e.from === id) stack.push(e.to);
  }
  return seen;
}

export function checkRecipe(recipe: Recipe, nodes: Map<string, Node>): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  const resolved = new Map<string, Node>();
  for (const [id, r] of Object.entries(recipe.nodes)) {
    const node = nodes.get(r.use);
    if (!node) {
      issues.push({ path: `nodes.${id}.use`, message: `node ${r.use} not found` });
      continue;
    }
    if (node.kind === "source") {
      issues.push({ path: `nodes.${id}.use`, message: `${r.use} is a source node; recipes cannot use it` });
      continue;
    }
    resolved.set(id, node);
    if (r.params && node.kind === "command" && node.runsAs === "engine") issues.push({ path: `nodes.${id}.params`, message: "params cannot be overridden on a runsAs: engine node" });
    if (r.agent && node.kind !== "agent") issues.push({ path: `nodes.${id}.agent`, message: `${r.use} is not an agent node` });
    if (r.session !== undefined && node.kind !== "agent") issues.push({ path: `nodes.${id}.session`, message: `${r.use} is not an agent node` });
    for (const p of r.agent?.providerNot ?? []) {
      const target = recipe.nodes[p];
      const tn = target && nodes.get(target.use);
      if (tn && tn.kind !== "agent") issues.push({ path: `nodes.${id}.agent.providerNot`, message: `${p} is not an agent node` });
    }
  }
  if (resolved.size !== Object.keys(recipe.nodes).length) return issues;
  const edgeKeys = new Set(recipe.edges.map((e) => `${e.from}:${e.on}`));
  for (const [i, e] of recipe.edges.entries()) {
    const outcomes = nodeOutcomes(recipe, e.from, resolved.get(e.from)!);
    if (!outcomes.includes(e.on)) issues.push({ path: `edges.${i}.on`, message: `${e.on} is not an outcome of ${e.from}` });
  }
  for (const [i, s] of recipe.successOutcomes.entries()) {
    const [id, outcome] = s.split(":") as [string, string];
    const node = resolved.get(id);
    if (!node || node.kind === "source") continue;
    if (!nodeOutcomes(recipe, id, node).includes(outcome)) issues.push({ path: `successOutcomes.${i}`, message: `${outcome} is not an outcome of ${id}` });
    if (node.failOutcomes.includes(outcome)) issues.push({ path: `successOutcomes.${i}`, message: `${outcome} is a fail outcome of ${id}` });
  }
  for (const [id, r] of Object.entries(recipe.nodes)) {
    if (r.optional && !edgeKeys.has(`${id}:skipped`)) issues.push({ path: `nodes.${id}.optional`, message: `optional node ${id} needs an edge on skipped` });
  }
  const live = reachable(recipe);
  for (const id of Object.keys(recipe.nodes)) if (!live.has(id)) issues.push({ path: `nodes.${id}`, message: `${id} cannot be reached from start or onBaseChanged` });
  const avail = availableInputs(recipe, resolved);
  for (const [id, node] of resolved) {
    if (!live.has(id) || node.kind === "source") continue;
    for (const input of node.inputs) {
      if (!avail.get(id)!.has(input)) issues.push({ path: `nodes.${id}`, message: `input ${input} is not produced on every path to ${id}` });
    }
  }
  return issues;
}

export function hasCommitNode(recipe: Recipe, nodes: Map<string, Node>): boolean {
  return Object.values(recipe.nodes).some((r) => {
    const n = nodes.get(r.use);
    return n !== undefined && n.kind !== "source" && n.outputs.includes("commit");
  });
}
