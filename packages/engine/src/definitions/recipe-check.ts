import { Ajv } from "ajv";
import { automaticOutputs, recipeStart, templateTitle } from "@pecore/schemas";
import type { ArtifactType, Node, Recipe } from "@pecore/schemas";
import { paramsWithDefaults } from "../runners/placeholders";

export type RecipeIssue = { path: string; message: string };

function stepTitle(recipe: Recipe, id: string): string {
  return id === recipeStart ? "Start" : templateTitle(recipe.nodes[id]?.use ?? id);
}

function outcomeTitle(name: string): string {
  return templateTitle(name.replaceAll("_", "-"));
}

const paramsValidator: Ajv = new Ajv({ allErrors: true, strict: false });

export function recipeParameterIssues(recipe: Recipe, nodes: Map<string, Node>): RecipeIssue[] {
  return Object.entries(recipe.nodes).flatMap(([id, step]): RecipeIssue[] => {
    const node: Node | undefined = nodes.get(step.use);
    if (!node) return [];
    const path: string = `nodes.${id}.params`;
    const title: string = stepTitle(recipe, id);
    try {
      const validate = paramsValidator.compile(node.params);
      return validate(paramsWithDefaults(node.params, step.params)) ? [] : (validate.errors ?? []).map((error) => {
        const missing: unknown = error.keyword === "required" ? error.params.missingProperty : undefined;
        const field: string = templateTitle((error.instancePath.split("/").at(-1) ?? "").replaceAll("_", "-"));
        const message: string = typeof missing === "string"
          ? `${title} needs a value for ${templateTitle(missing.replaceAll("_", "-"))}.`
          : field && error.message ? `The ${field} value for ${title} ${error.message}.` : `Check the input settings for ${title}.`;
        return { path, message };
      });
    } catch {
      return [{ path, message: `The input settings for ${title} are invalid. Check its node template.` }];
    }
  });
}

export function nodeOutcomes(recipe: Recipe, id: string, node: Node): string[] {
  const r = recipe.nodes[id];
  const out = [...node.outcomes];
  if (r && r.requires.length > 0) out.push("stale");
  if (r?.optional) out.push("skipped");
  if (recipe.ci?.after === id) out.push("ci_passed", "ci_failed", "ci_exhausted", "ci_timeout");
  return out;
}

export function producedOn(recipe: Recipe, id: string, node: Node, outcome: string): ArtifactType[] {
  if (outcome === "stale" || outcome === "skipped") return [];
  if (recipe.ci?.after === id && outcome.startsWith("ci_")) return [...new Set([...producedOn(recipe, id, node, recipe.ci.on), "text" as const])];
  const declared: ArtifactType | undefined = node.outputs[outcome];
  return [...new Set([...(declared ? [declared] : []), ...automaticOutputs(node)])];
}

export function producedTypes(recipe: Recipe, id: string, node: Node): ArtifactType[] {
  return [...new Set(nodeOutcomes(recipe, id, node).flatMap((outcome) => producedOn(recipe, id, node, outcome)))];
}

export function availableOutputs(recipe: Recipe, byId: Map<string, Node>, includeBaseChange: boolean = true): Map<string, Set<string>> {
  const ids = Object.keys(recipe.nodes);
  const pair = (id: string, type: ArtifactType): string => `${id}:${type}`;
  const all = new Set<string>(ids.flatMap((id) => {
    const node = byId.get(id);
    return node ? producedTypes(recipe, id, node).map((type) => pair(id, type)) : [];
  }));
  const request: string = pair(recipeStart, "document");
  all.add(request);
  const incoming = new Map<string, { from: string; on: string }[]>(ids.map((id) => [id, []]));
  for (const e of recipe.edges) incoming.get(e.to)?.push({ from: e.from, on: e.on });
  const startNode = recipe.start !== undefined ? byId.get(recipe.start) : undefined;
  const entry = new Map<string, Set<string>>();
  if (recipe.start !== undefined) entry.set(recipe.start, new Set([request]));
  if (includeBaseChange && recipe.onBaseChanged !== undefined && recipe.onBaseChanged !== recipe.start) {
    entry.set(recipe.onBaseChanged, new Set([request, ...(startNode && recipe.start !== undefined ? producedTypes(recipe, recipe.start, startNode).map((type) => pair(recipe.start!, type)) : [])]));
  }
  const avail = new Map<string, Set<string>>(ids.map((id) => [id, entry.has(id) && incoming.get(id)!.length === 0 ? new Set(entry.get(id)) : new Set(all)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      const sources: Set<string>[] = [];
      if (entry.has(id)) sources.push(new Set(entry.get(id)));
      for (const { from, on } of incoming.get(id)!) {
        const node = byId.get(from);
        sources.push(new Set([...avail.get(from)!, ...(node ? producedOn(recipe, from, node, on).map((type) => pair(from, type)) : [])]));
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

function readIssues(recipe: Recipe, resolved: Map<string, Node>, live: Set<string>): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  const avail = availableOutputs(recipe, resolved);
  let fromStart: Map<string, Set<string>> | undefined;
  for (const [id, node] of resolved) {
    if (!live.has(id)) continue;
    const reads: string[] = recipe.nodes[id]!.reads;
    const title: string = stepTitle(recipe, id);
    const path: string = `nodes.${id}.reads`;
    for (const read of reads) {
      const source: Node | undefined = resolved.get(read);
      if (source && producedTypes(recipe, read, source).length === 0) issues.push({ path, message: `${stepTitle(recipe, read)} produces no output for ${title} to read. Remove it from Reads from.` });
    }
    if (!("inputs" in node)) continue;
    for (const type of [...node.inputs, ...node.optionalInputs]) {
      const providers: string[] = reads.filter((read) => {
        if (read === recipeStart) return type === "document";
        const source: Node | undefined = resolved.get(read);
        return source !== undefined && producedTypes(recipe, read, source).includes(type);
      });
      if (providers.length > 1) issues.push({ path, message: `${providers.map((step) => stepTitle(recipe, step)).join(" and ")} produce the same input for ${title} (${type}). Select one source in Reads from.` });
      if (!node.inputs.includes(type)) continue;
      if (providers.length === 0) issues.push({ path, message: `${title} needs a ${type} input. Select a step that produces it in Reads from.` });
      if (providers.length !== 1) continue;
      const provider: string = providers[0]!;
      const output: string = `${provider}:${type}`;
      if (avail.get(id)!.has(output)) continue;
      const source: string = stepTitle(recipe, provider);
      fromStart ??= availableOutputs(recipe, resolved, false);
      const reentry: string | undefined = recipe.onBaseChanged;
      const message: string = reentry && fromStart.get(id)?.has(output)
        ? `${title} needs the ${type} from ${source}. A base change can restart at ${stepTitle(recipe, reentry)} before ${source} has produced it. Route that branch through ${source}, or clear the base-change step in Recipe settings and remove the disconnected steps.`
        : `${title} needs the ${type} from ${source}. A path reaches ${title} without that output. Route it through an outcome of ${source} that produces the ${type}.`;
      issues.push({ path, message });
    }
  }
  return issues;
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
    return node?.kind === "repository" && node.account === "project.account"
      ? [{ path: `nodes.${id}.use`, message: `${stepTitle(recipe, id)} needs a remote repository. Add one in Project Settings or remove this step.` }]
      : [];
  });
}

export function checkRecipe(recipe: Recipe, nodes: Map<string, Node>, remote: boolean): RecipeIssue[] {
  const issues: RecipeIssue[] = remote ? [] : remoteIssues(recipe, nodes);
  const resolved = new Map<string, Node>();
  for (const [id, r] of Object.entries(recipe.nodes)) {
    const node = nodes.get(r.use);
    if (!node) {
      issues.push({ path: `nodes.${id}.use`, message: `The ${stepTitle(recipe, id)} node template is missing. Choose another node.` });
      continue;
    }
    resolved.set(id, node);
    if (r.params && node.kind === "repository") issues.push({ path: `nodes.${id}.params`, message: "Recipes cannot change parameters for Repository nodes." });
    const agentOnly: string = `Choose an Agent node to use agent settings. ${stepTitle(recipe, id)} is a different kind of node.`;
    if (r.agent && node.kind !== "agent") issues.push({ path: `nodes.${id}.agent`, message: agentOnly });
    if (r.agentId !== undefined && node.kind !== "agent") issues.push({ path: `nodes.${id}.agentId`, message: agentOnly });
    if (r.agentSession !== undefined && node.kind !== "agent") issues.push({ path: `nodes.${id}.agentSession`, message: agentOnly });
    for (const p of r.agent?.providerNot ?? []) {
      const target = recipe.nodes[p];
      const tn = target && nodes.get(target.use);
      if (tn && tn.kind !== "agent") issues.push({ path: `nodes.${id}.agent.providerNot`, message: `Choose an Agent node instead of ${stepTitle(recipe, p)} for the provider restriction on ${stepTitle(recipe, id)}.` });
    }
  }
  if (resolved.size !== Object.keys(recipe.nodes).length) return issues;
  const edgeKeys = new Set(recipe.edges.map((e) => `${e.from}:${e.on}`));
  const endKeys = new Set((recipe.ends ?? []).map((e) => `${e.from}:${e.on}`));
  if (recipe.ci) {
    const producer: Node | undefined = resolved.get(recipe.ci.after);
    if (!remote || producer?.kind !== "repository" || producer.outputs[recipe.ci.on] !== "reference") {
      issues.push({ path: "ci", message: "Choose a Repository delivery step and an outcome that returns a pull request or merge request for CI to check." });
    }
    if (edgeKeys.has(`${recipe.ci.after}:${recipe.ci.on}`) || endKeys.has(`${recipe.ci.after}:${recipe.ci.on}`)) {
      issues.push({ path: "ci.on", message: "Connect the CI results to another step or End." });
    }
  }
  for (const [i, e] of recipe.edges.entries()) {
    const outcomes = nodeOutcomes(recipe, e.from, resolved.get(e.from)!);
    if (!outcomes.includes(e.on)) issues.push({ path: `edges.${i}.on`, message: `${stepTitle(recipe, e.from)} has no ${outcomeTitle(e.on)} outcome. Choose another outcome for this connection.` });
  }
  for (const [i, s] of recipe.successOutcomes.entries()) {
    const [id, outcome] = s.split(":") as [string, string];
    const node = resolved.get(id);
    if (!node) continue;
    if (!nodeOutcomes(recipe, id, node).includes(outcome)) issues.push({ path: `successOutcomes.${i}`, message: `${stepTitle(recipe, id)} has no ${outcomeTitle(outcome)} outcome. Choose another outcome for this connection.` });
    if (recipe.ci?.after === id && [recipe.ci.on, "ci_failed", "ci_timeout", "ci_exhausted"].includes(outcome)) {
      issues.push({ path: `successOutcomes.${i}`, message: "Choose CI Passed to end a job successfully after CI." });
    }
    if (node.failOutcomes.includes(outcome)) issues.push({ path: `successOutcomes.${i}`, message: `${stepTitle(recipe, id)} reports ${outcomeTitle(outcome)} as a failure. Choose another outcome to end the job successfully.` });
  }
  for (const [id, r] of Object.entries(recipe.nodes)) {
    if (r.optional && !edgeKeys.has(`${id}:skipped`) && !endKeys.has(`${id}:skipped`)) {
      issues.push({ path: `nodes.${id}.optional`, message: `Connect the Skipped outcome of ${stepTitle(recipe, id)} to another step or End.` });
    }
  }
  const live = reachable(recipe);
  for (const id of Object.keys(recipe.nodes)) if (!live.has(id)) issues.push({ path: `nodes.${id}`, message: `Connect ${stepTitle(recipe, id)} to the flow from Start or the base-change step.` });
  if (recipe.ends !== undefined) {
    const canEnd = new Set<string>();
    for (const [index, end] of recipe.ends.entries()) {
      if (nodeOutcomes(recipe, end.from, resolved.get(end.from)!).includes(end.on)) canEnd.add(end.from);
      else issues.push({ path: `ends.${index}.on`, message: `${stepTitle(recipe, end.from)} has no ${outcomeTitle(end.on)} outcome. Choose another outcome for this connection to End.` });
    }
    for (let changed: boolean = true; changed;) {
      changed = false;
      for (const edge of recipe.edges) {
        if (canEnd.has(edge.to) && !canEnd.has(edge.from)) {
          canEnd.add(edge.from);
          changed = true;
        }
      }
    }
    for (const id of live) {
      const outcomes: string[] = nodeOutcomes(recipe, id, resolved.get(id)!);
      const missing: string[] = outcomes.filter((outcome) => {
        if (id === recipe.ci?.after && outcome === recipe.ci.on) return false;
        const key: string = `${id}:${outcome}`;
        return !edgeKeys.has(key) && !endKeys.has(key);
      });
      if (missing.length) issues.push({ path: `nodes.${id}`, message: `Connect the remaining outcomes of ${stepTitle(recipe, id)} to another step or End (${missing.map(outcomeTitle).join(", ")}).` });
      if (!canEnd.has(id)) issues.push({ path: `nodes.${id}`, message: `Add a path from ${stepTitle(recipe, id)} to End.` });
    }
  }
  issues.push(...readIssues(recipe, resolved, live));
  return issues;
}

export function hasCommitNode(recipe: Recipe, nodes: Map<string, Node>): boolean {
  return Object.values(recipe.nodes).some((r) => {
    const n = nodes.get(r.use);
    return n !== undefined && Object.values(n.outputs).includes("reference");
  });
}
