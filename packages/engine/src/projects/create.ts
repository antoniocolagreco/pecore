import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Project } from "@pecore/schemas";
import type { ProjectInput } from "@pecore/schemas";
import { instantiateRecipe } from "../definitions/instantiate";
import { commitDefinition, commitMessage } from "../home/git-commit";
import { homePaths, projectPaths } from "../home/layout";
import { ProjectDb } from "../store/project-db";
import { createLocalRepo } from "../workdir/repo";

export class ProjectCreateError extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(`step ${step}: ${message}`);
  }
}

export async function createProject(home: string, input: ProjectInput, recipes: string[]): Promise<Project> {
  const parsed = Project.safeParse({ $schema: "../../schemas/project.json", ...input });
  if (!parsed.success) throw new ProjectCreateError(1, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const project = parsed.data;
  if (project.repo !== null) throw new ProjectCreateError(1, "projects with a remote repository are not available yet");
  const dir = join(homePaths(home).projects, project.id);
  if (await stat(dir).then(() => true, () => false)) throw new ProjectCreateError(1, `project ${project.id} already exists`);
  const p = projectPaths(dir);
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 });
    for (const d of [p.nodes, p.recipes, p.knowledge, p.work, p.artifacts, p.logs]) await mkdir(d, { recursive: true });
    for (const name of recipes) {
      const r = await instantiateRecipe(homePaths(home).library, dir, name);
      if (r.errors.length) throw new ProjectCreateError(3, r.errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join("; "));
    }
    await writeFile(p.project, JSON.stringify(project, null, 2) + "\n");
    new ProjectDb(p.db).close();
    await createLocalRepo(p.repo, project.baseBranch);
    await commitDefinition(home, [dir], commitMessage("project", project.id, "created"));
    return project;
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    if (e instanceof ProjectCreateError) throw e;
    throw new ProjectCreateError(4, (e as Error).message);
  }
}
