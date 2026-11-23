import type { ProjectInput } from "@pecore/schemas";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Project, Recipe } from "@pecore/schemas";
import { homePaths } from "../src/home/layout";
import type { Engine } from "../src/main";
import { forgeAccountOf } from "../src/projects/create";
import { projectDefaults } from "../src/projects/defaults";

export async function createProjectWithRecipes(engine: Engine, input: ProjectInput, recipes: string[]): Promise<void> {
  const templates: string = homePaths(engine.opts.home).templates;
  const project: Project = Project.parse(input);
  const account = forgeAccountOf(project, engine.global().accounts);
  const { rename } = await projectDefaults(templates, project.repo, account?.forge ?? null);
  for (const name of recipes) {
    const file: string = join(templates, "recipes", `${name}.json`);
    const recipe: Recipe = Recipe.parse(JSON.parse(await readFile(file, "utf8")));
    if (Object.values(recipe.nodes).some(({ use }) => Object.hasOwn(rename, use) && rename[use] !== use)) {
      for (const step of Object.values(recipe.nodes)) if (Object.hasOwn(rename, step.use)) step.use = rename[step.use]!;
      await writeFile(file, JSON.stringify(recipe, null, 2) + "\n");
    }
  }
  await engine.createProject({ ...input, recipes });
  const errors = await engine.reloadProject(input.id);
  if (errors.length) throw new Error(errors.map((error) => `${error.file} ${error.path}: ${error.message}`).join("\n"));
}
