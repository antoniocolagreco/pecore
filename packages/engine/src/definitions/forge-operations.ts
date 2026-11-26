import type { ForgeOperation, Recipe } from "@pecore/schemas";

export const legacyForgeOperations: ReadonlyMap<string, ForgeOperation> = new Map([
  ["github-pr", "open-pr"],
  ["gitlab-mr", "open-pr"],
  ["git-delivery", "open-pr"],
  ["github-create-repo", "create-repo"],
  ["gitlab-create-repo", "create-repo"],
]);

export function migrateForgeRecipe(recipe: Recipe): boolean {
  let changed: boolean = false;
  for (const [id, step] of Object.entries(recipe.nodes)) {
    const operation: ForgeOperation | undefined = legacyForgeOperations.get(step.use);
    if (!operation) continue;
    const branchDelivery: boolean = step.use === "git-delivery" && step.reads.length === 0;
    step.use = operation;
    changed = true;
    if (!branchDelivery) continue;
    let writer: string = "write-pr";
    for (let index: number = 2; Object.hasOwn(recipe.nodes, writer); index++) writer = `write-pr-${index}`;
    recipe.nodes[writer] = { use: "write-pr", reads: [], requires: [], skipWhenUnchanged: false };
    step.reads = [writer];
    recipe.edges = recipe.edges.map((edge) => edge.to === id ? { ...edge, to: writer } : edge);
    recipe.edges.push({ from: writer, on: "success", to: id });
    if (recipe.start === id) recipe.start = writer;
    if (recipe.onBaseChanged === id) recipe.onBaseChanged = writer;
  }
  return changed;
}
