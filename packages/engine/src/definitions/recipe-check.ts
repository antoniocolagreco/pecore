import { Ajv } from "ajv";
import { ArtifactType, isHumanNode } from "@pecore/schemas";
import type { Node, Recipe } from "@pecore/schemas";
import { paramsWithDefaults } from "../runners/placeholders";

export type RecipeIssue = { path: string; message: string };

const paramsValidator: Ajv = new Ajv({ allErrors: true, strict: false });

export function recipeParameterIssues(recipe: Recipe, nodes: Map<string, Node>): RecipeIssue[] {
  return Object.entries(recipe.nodes).flatMap(([id, step]): RecipeIssue[] => {
    const node: Node | undefined = nodes.get(step.use);
    if (!node) return [];
    const path: string = `nodes.${id}.params`;
    try {
      const validate = paramsValidator.compile(node.params);
      return validate(paramsWithDefaults(node.params, step.params)) ? [] : (validate.errors ?? []).map((error) => ({
        path,
        message: `${error.instancePath ? error.instancePath + " " : ""}${error.message ?? "invalid parameter"}`,
      }));
    } catch (error) {
      return [{ path, message: (error as Error).message }];
    }
  });
}

export function nodeOutcomes(recipe: Recipe, id: string, node: Node): string[] {
  if (node.kind === "source") return [];
  const r = recipe.nodes[id];
  const out = [...node.outcomes];
  if (r && r.requires.length > 0) out.push("stale");
  if (r?.optional) out.push("skipped");
  if (recipe.ci?.after === id) out.push("ci_passed", "ci_failed", "ci_exhausted", "ci_timeout");
  return out;
}

function produced(node: Node): ArtifactType[] {
  if (node.kind === "source") return [];
  const out = [...node.outputs];
  if (!isHumanNode(node) && node.changesFiles) out.push("diff");
  if (isHumanNode(node) && node.answer) out.push("user-note");
  if (node.kind === "command") out.push("check-log");
  return out;
}

export function availableInputs(recipe: Recipe, byId: Map<string, Node>): Map<string, Set<ArtifactType>> {
  const ids = Object.keys(recipe.nodes);
  const all = new Set<ArtifactType>(ArtifactType.options);
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

export function remoteIssues(recipe: Recipe, nodes: Map<string, Node>): RecipeIssue[] {
  return Object.entries(recipe.nodes).flatMap(([id, r]) => {
    const node = nodes.get(r.use);
    return node?.kind === "command" && node.credentials.includes("project.account")
      ? [{ path: `nodes.${id}.use`, message: `${r.use} needs a remote repository, and this project has none` }]
      : [];
  });
}

export function checkRecipe(recipe: Recipe, nodes: Map<string, Node>, remote: boolean): RecipeIssue[] {
  const issues: RecipeIssue[] = remote ? [] : remoteIssues(recipe, nodes);
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
  if (recipe.ci) {
    const producer: Node | undefined = resolved.get(recipe.ci.after);
    if (!remote || producer?.kind !== "command" || !producer.outputs.includes("delivery") || !producer.outcomes.includes(recipe.ci.on)) {
      issues.push({ path: "ci", message: "CI needs a remote delivery command and one of its outcomes" });
    }
    if (edgeKeys.has(`${recipe.ci.after}:${recipe.ci.on}`)) issues.push({ path: "ci.on", message: "use edges for the CI outcomes" });
  }
  for (const [i, e] of recipe.edges.entries()) {
    const outcomes = nodeOutcomes(recipe, e.from, resolved.get(e.from)!);
    if (!outcomes.includes(e.on)) issues.push({ path: `edges.${i}.on`, message: `${e.on} is not an outcome of ${e.from}` });
  }
  for (const [i, s] of recipe.successOutcomes.entries()) {
    const [id, outcome] = s.split(":") as [string, string];
    const node = resolved.get(id);
    if (!node || node.kind === "source") continue;
    if (!nodeOutcomes(recipe, id, node).includes(outcome)) issues.push({ path: `successOutcomes.${i}`, message: `${outcome} is not an outcome of ${id}` });
    if (recipe.ci?.after === id && [recipe.ci.on, "ci_failed", "ci_timeout", "ci_exhausted"].includes(outcome)) {
      issues.push({ path: `successOutcomes.${i}`, message: "use ci_passed for a successful CI result" });
    }
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
