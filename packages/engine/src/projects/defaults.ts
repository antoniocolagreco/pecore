import { join } from "node:path";
import { Name } from "@pecore/schemas";
import type { Recipe } from "@pecore/schemas";
import { z } from "zod";
import { readJson, zodErrors } from "../definitions/load";
import type { DefinitionError } from "../definitions/load";

const forgeDefaults = z.strictObject({
  forge: Name,
  tool: Name,
  credentialHelper: z.string().min(1).nullable(),
  delivery: Name,
  comment: Name.nullable(),
  createRepo: Name.nullable(),
});

export type ForgeDefaults = z.infer<typeof forgeDefaults>;

function definitionError(errors: DefinitionError[]): Error {
  return new Error(errors.map(({ file, path, message }) => `${file}${path ? ` at ${path}` : ""}: ${message}`).join("\n"));
}

export async function loadForgeDefaults(templatesDir: string, forge: string): Promise<ForgeDefaults> {
  const file = join(templatesDir, "forges", `${Name.parse(forge)}.json`);
  const { value, error } = await readJson(file);
  if (error) throw definitionError([error]);
  const result = forgeDefaults.safeParse(value);
  if (!result.success) throw definitionError(zodErrors(file, result.error));
  if (result.data.forge !== forge) throw new Error(`${file}: forge must be ${forge}`);
  return result.data;
}

export function recipeForBranchDelivery(input: Recipe): Recipe {
  const recipe: Recipe = structuredClone(input);
  const deliveryIds: Set<string> = new Set(Object.keys(recipe.nodes).filter((id) => recipe.nodes[id]?.use === "open-pr"));
  for (const [id, step] of Object.entries(recipe.nodes)) {
    if (step.use !== "write-pr") continue;
    const edges = recipe.edges.filter(({ from }) => from === id);
    const delivery = edges[0]?.to;
    if (!delivery || !deliveryIds.has(delivery) || edges.length !== 1 || edges[0]?.on !== "success") continue;
    if (recipe.ends?.some(({ from }) => from === id) || recipe.successOutcomes.some((outcome) => outcome.startsWith(id + ":")) || recipe.ci?.after === id) continue;
    if (Object.entries(recipe.nodes).some(([consumer, node]) => node.requires.includes(id) || (consumer !== delivery && node.reads.includes(id)))) continue;
    recipe.edges = recipe.edges.filter(({ from }) => from !== id).map((edge) => edge.to === id ? { ...edge, to: delivery } : edge);
    if (recipe.start === id) recipe.start = delivery;
    if (recipe.onBaseChanged === id) recipe.onBaseChanged = delivery;
    recipe.nodes[delivery]!.reads = recipe.nodes[delivery]!.reads.filter((read) => read !== id);
    delete recipe.nodes[id];
    if (recipe.layout) delete recipe.layout[id];
  }
  for (const step of Object.values(recipe.nodes)) step.reads = step.reads.filter((read) => !deliveryIds.has(read));
  return recipe;
}
