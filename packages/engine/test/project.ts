import type { ProjectInput } from "@pecore/schemas";
import { instantiateRecipe } from "../src/definitions/instantiate";
import { homePaths } from "../src/home/layout";
import type { Engine } from "../src/main";
import { forgeAccountOf } from "../src/projects/create";
import { projectDefaults } from "../src/projects/defaults";

export async function createProjectWithRecipes(engine: Engine, input: ProjectInput, recipes: string[]): Promise<void> {
  await engine.createProject(input);
  const { ctx } = engine.project(input.id);
  const templates: string = homePaths(engine.opts.home).templates;
  const account = forgeAccountOf(ctx.project, engine.global().accounts);
  const { rename } = await projectDefaults(templates, ctx.project.repo, account?.forge ?? null);
  for (const name of recipes) {
    const result = await instantiateRecipe(templates, ctx.dir, name, rename);
    if (result.errors.length) throw new Error(result.errors.map((error) => error.message).join("\n"));
  }
  const errors = await engine.reloadProject(input.id);
  if (errors.length) throw new Error(errors.map((error) => `${error.file} ${error.path}: ${error.message}`).join("\n"));
}
