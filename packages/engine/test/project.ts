import type { AgentDefinition, AgentDefinitions, ProjectInput } from "@pecore/schemas";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Project, Recipe } from "@pecore/schemas";
import { homePaths } from "../src/home/layout";
import type { Engine } from "../src/main";
import { forgeAccountOf } from "../src/projects/create";
import { projectDefaults } from "../src/projects/defaults";

export async function seedProjectManagers(home: string, model: AgentDefinition["model"] = null, compaction: { auto: number; max: number } = { auto: 131072, max: 262144 }): Promise<void> {
  const value: AgentDefinitions = { agents: [
    { id: "eva", kind: "pm", name: "Eva", color: "#FFDE38", model, compaction, traits: [] },
    { id: "viola", kind: "pm", name: "Viola", color: "#9D57FF", model, compaction, traits: [] },
    { id: "mara", kind: "pm", name: "Mara", color: "#2F8E76", model, compaction, traits: [] },
    { id: "nora", kind: "pm", name: "Nora", color: "#D65C05", model, compaction, traits: [] },
    { id: "cleo", kind: "pm", name: "Cleo", color: "#75C6FF", model, compaction, traits: [] },
    { id: "ruby", kind: "pm", name: "Ruby", color: "#F91F44", model, compaction, traits: [] },
  ] };
  await writeFile(homePaths(home).agents, JSON.stringify(value));
}

export async function createProjectWithRecipes(engine: Engine, input: ProjectInput, recipes: string[]): Promise<void> {
  if (!engine.agentCatalog().agents.some(({ kind }) => kind === "pm")) {
    await seedProjectManagers(engine.opts.home);
    const errors = await engine.reloadGlobal();
    if (errors.length) throw new Error(errors.map(({ message }) => message).join("\n"));
  }
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
