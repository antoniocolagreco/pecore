import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { Name, startingRecipes } from "@pecore/schemas";
import type { Project } from "@pecore/schemas";
import { z } from "zod";
import { loadRecipeFile, readJson, zodErrors } from "../definitions/load";
import type { DefinitionError } from "../definitions/load";

const forgeDefaults = z.strictObject({
  forge: Name,
  tool: Name,
  credentialHelper: z.string().min(1).nullable(),
  delivery: Name,
  comment: Name,
  createRepo: Name.nullable(),
  source: Name.nullable(),
});

export type DefaultRecipe = (typeof startingRecipes)[number];
export type ForgeDefaults = z.infer<typeof forgeDefaults>;
export type ProjectDefaults = { recipes: DefaultRecipe[]; nodes: string[]; forge: ForgeDefaults | null; rename: Record<string, string> };

function definitionError(errors: DefinitionError[]): Error {
  return new Error(errors.map(({ file, path, message }) => `${file}${path ? ` at ${path}` : ""}: ${message}`).join("\n"));
}

export async function loadForgeDefaults(libraryDir: string, forge: string): Promise<ForgeDefaults> {
  const file = join(libraryDir, "forges", `${Name.parse(forge)}.json`);
  const { value, error } = await readJson(file);
  if (error) throw definitionError([error]);
  const result = forgeDefaults.safeParse(value);
  if (!result.success) throw definitionError(zodErrors(file, result.error));
  if (result.data.forge !== forge) throw new Error(`${file}: forge must be ${forge}`);
  return result.data;
}

export async function projectDefaults(
  libraryDir: string,
  repo: Project["repo"],
  forgeName: string | null,
  selectedRecipes: readonly DefaultRecipe[] = startingRecipes,
): Promise<ProjectDefaults> {
  if (repo !== null && forgeName === null) throw new Error("A repository project needs a forge");
  const forge = repo !== null && forgeName !== null ? await loadForgeDefaults(libraryDir, forgeName) : null;
  const recipes: DefaultRecipe[] = repo === null ? ["local-only"] : startingRecipes.filter((name) => selectedRecipes.includes(name));
  const rename: Record<string, string> = {};
  if (forge !== null) {
    const files = (await readdir(join(libraryDir, "forges"))).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const name = basename(file, ".json");
      const defaults = name === forge.forge ? forge : await loadForgeDefaults(libraryDir, name);
      for (const role of ["delivery", "comment", "createRepo", "source"] as const) {
        const from: string | null = defaults[role];
        const to: string | null = forge[role];
        if (from !== null && to !== null) rename[from] = to;
      }
    }
  }
  const nodes = new Set<string>();
  for (const name of recipes) {
    const recipe = await loadRecipeFile(join(libraryDir, "recipes", `${name}.json`));
    if (!recipe.value) throw definitionError(recipe.errors);
    for (const node of Object.values(recipe.value.nodes)) {
      const replacement = Object.hasOwn(rename, node.use) ? rename[node.use] : undefined;
      nodes.add(replacement ?? node.use);
    }
  }
  if (forge?.createRepo) nodes.add(forge.createRepo);
  if (forge?.source) nodes.add(forge.source);
  return { recipes, nodes: [...nodes], forge, rename };
}
