import type { Node, Recipe } from "@pecore/schemas";

export type OutcomeLookup = (node: string, outcome: string) => string;

const standard: Readonly<Record<string, string>> = { done: "success", ok: "success", passed: "success", failed: "failure" };
const review: Readonly<Record<string, string>> = { approve: "approved", changes: "changes_requested", reject: "rejected" };
const shipped: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "code-reviewer": review,
  "git-delivery": { opened: "success" },
  "git-push": { pushed: "success" },
  "git-rebase": { clean: "success", conflict: "rebase_conflict" },
  "github-create-repo": { created: "success" },
  "github-pr": { opened: "success" },
  "gitlab-create-repo": { created: "success" },
  "gitlab-mr": { opened: "success" },
  "human-review": review,
  "resolve-rebase-conflicts": { resolved: "success", unresolved: "failure" },
  "spec-writer": { accepted: "success" },
  "tests-fail-check": { failed_as_expected: "success", unexpected_pass: "failure" },
};

export function renamedOutcome(name: string, outcome: string, iface?: string | null): string {
  if (iface === "decision" || name === "human-decision") return outcome;
  const special: Readonly<Record<string, string>> = iface ? review : Object.hasOwn(shipped, name) ? shipped[name]! : {};
  if (Object.hasOwn(special, outcome)) return special[outcome]!;
  return Object.hasOwn(standard, outcome) ? standard[outcome]! : outcome;
}

export function outcomeRenames(name: string, outcomes: readonly string[], iface?: string | null): Map<string, string> {
  const targets: string[] = outcomes.map((outcome) => renamedOutcome(name, outcome, iface));
  return new Map(outcomes.flatMap((outcome, i) => {
    const target: string = targets[i]!;
    return target !== outcome && targets.indexOf(target) === targets.lastIndexOf(target) ? [[outcome, target]] : [];
  }));
}

export function renameOutcomeMentions(text: string, renames: ReadonlyMap<string, string>): string {
  return text.replace(/`([a-z_]+)`/g, (whole, outcome: string) => renames.has(outcome) ? "`" + renames.get(outcome) + "`" : whole);
}

export function renameNodeOutcomes(node: Node, renames: ReadonlyMap<string, string>): void {
  const rename = (outcome: string): string => renames.get(outcome) ?? outcome;
  node.outcomes = node.outcomes.map(rename);
  if (node.failOutcomes) node.failOutcomes = node.failOutcomes.map(rename);
  if (node.outputs) node.outputs = Object.fromEntries(Object.entries(node.outputs).map(([outcome, type]) => [rename(outcome), type]));
  if ("outcomeRules" in node) for (const rule of node.outcomeRules) rule.outcome = rename(rule.outcome);
  if ("outputRules" in node && node.outputRules) node.outputRules = Object.fromEntries(Object.entries(node.outputRules).map(([outcome, rule]) => [rename(outcome), rule]));
}

export function recipeStepOutcomes(recipe: Recipe, lookup: OutcomeLookup): OutcomeLookup {
  return (step, outcome) => {
    const use: string | undefined = recipe.nodes?.[step]?.use;
    return use ? lookup(use, outcome) : outcome;
  };
}

export function renameRouteReason(reason: string, lookup: OutcomeLookup): string {
  const prefix: string = "unrouted_outcome:";
  const start: number = reason.startsWith(prefix) ? prefix.length : 0;
  const separator: number = reason.indexOf(":", start);
  return separator < 0 ? reason : reason.slice(0, separator + 1) + lookup(reason.slice(start, separator), reason.slice(separator + 1));
}

export function renameRecipeOutcomes(recipe: Recipe, lookup: OutcomeLookup): void {
  const atStep: OutcomeLookup = recipeStepOutcomes(recipe, lookup);
  for (const edge of [...(recipe.edges ?? []), ...(recipe.ends ?? [])]) edge.on = atStep(edge.from, edge.on);
  if (recipe.ci) recipe.ci.on = atStep(recipe.ci.after, recipe.ci.on);
  if (recipe.successOutcomes) recipe.successOutcomes = recipe.successOutcomes.map((value) => renameRouteReason(value, atStep));
}
