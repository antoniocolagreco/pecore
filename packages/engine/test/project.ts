import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectInput } from "@pecore/schemas";
import { instantiateRecipe } from "../src/definitions/instantiate";
import { homePaths } from "../src/home/layout";
import type { Engine } from "../src/main";
import { forgeAccountOf } from "../src/projects/create";
import { projectDefaults } from "../src/projects/defaults";

export async function createProjectWithRecipes(engine: Engine, input: ProjectInput, recipes: string[]): Promise<void> {
  await engine.createProject({ ...input, defaultRecipe: null });
  const { ctx } = engine.project(input.id);
  const library: string = homePaths(engine.opts.home).library;
  const account = forgeAccountOf(ctx.project, engine.global().accounts);
  const { rename } = await projectDefaults(library, ctx.project.repo, account?.forge ?? null);
  for (const name of recipes) {
    const result = await instantiateRecipe(library, ctx.dir, name, rename);
    if (result.errors.length) throw new Error(result.errors.map((error) => error.message).join("\n"));
  }
  const file: string = join(ctx.dir, "project.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), defaultRecipe: input.defaultRecipe ?? null }, null, 2) + "\n");
  const errors = await engine.reloadProject(input.id);
  if (errors.length) throw new Error(errors.map((error) => `${error.file} ${error.path}: ${error.message}`).join("\n"));
}
