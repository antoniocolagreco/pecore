import type { ProjectInput, Recipe } from "@pecore/schemas";
import { Project } from "@pecore/schemas";
import type { Engine } from "../src/main";
import { forgeAccountOf } from "../src/projects/create";
import { projectDefaults } from "../src/projects/defaults";

export async function createProjectWithRecipes(engine: Engine, input: ProjectInput, recipes: string[]): Promise<void> {
  const project: Project = Project.parse(input);
  const account = forgeAccountOf(project, engine.global().accounts);
  const { rename } = await projectDefaults(engine.opts.templates, project.repo, account?.forge ?? null);
  for (const name of recipes) {
    const recipe: Recipe = engine.catalog.recipe(name)!;
    if (Object.values(recipe.nodes).some(({ use }) => Object.hasOwn(rename, use) && rename[use] !== use)) {
      for (const step of Object.values(recipe.nodes)) if (Object.hasOwn(rename, step.use)) step.use = rename[step.use]!;
      engine.catalog.saveRecipe(recipe);
    }
  }
  await engine.createProject({ ...input, recipes });
  const errors = await engine.reloadProject(input.id);
  if (errors.length) throw new Error(errors.map((error) => `${error.file} ${error.path}: ${error.message}`).join("\n"));
}
