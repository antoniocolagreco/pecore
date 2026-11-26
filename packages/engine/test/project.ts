import type { ProjectInput } from "@pecore/schemas";
import type { Engine } from "../src/main";

export async function createProjectWithRecipes(engine: Engine, input: ProjectInput, recipes: string[]): Promise<void> {
  await engine.createProject({ ...input, recipes });
  const errors = await engine.reloadProject(input.id);
  if (errors.length) throw new Error(errors.map((error) => `${error.file} ${error.path}: ${error.message}`).join("\n"));
}
