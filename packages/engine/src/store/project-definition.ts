import { Project } from "@pecore/schemas";
import type Database from "better-sqlite3";

type ProjectRow = {
  id: string;
  name: string;
  repo_url: string | null;
  repo_account: string | null;
  folder: string | null;
  base_branch: string;
  create_repo: string | null;
  services: string | null;
  pm_name: string | null;
  pm_color: string | null;
  pm_agent_id: string | null;
  tracker_provider: string | null;
  tracker_account: string | null;
  uses_templates: number;
  has_variables: number;
  has_credentials: number;
  has_recipe_knowledge: number;
};

export class ProjectDefinition {
  constructor(private readonly db: Database.Database) {}

  read(): Project | null {
    const row: ProjectRow | undefined = this.db.prepare<[], ProjectRow>("SELECT * FROM project_definition").get();
    if (!row) return null;
    const readParams = (table: "project_variables"): Record<string, unknown> => Object.fromEntries(
      this.db.prepare<[], { name: string; value: string }>(`SELECT name, value FROM ${table} ORDER BY name`).all().map(({ name, value }) => [name, JSON.parse(value)]),
    );
    const credentials: Record<string, string> | undefined = row.has_credentials ? Object.fromEntries(
      this.db.prepare<[], { name: string; account: string }>("SELECT name, account FROM project_credentials ORDER BY name").all().map(({ name, account }) => [name, account]),
    ) : undefined;
    return Project.parse({
      id: row.id, name: row.name,
      repo: row.repo_url === null ? null : { url: row.repo_url, account: row.repo_account },
      folder: row.folder, baseBranch: row.base_branch, createRepo: row.create_repo, services: row.services,
      pm: row.pm_name === null ? null : { name: row.pm_name, color: row.pm_color, ...(row.pm_agent_id === null ? {} : { agentId: row.pm_agent_id }) },
      tracker: row.tracker_provider === null ? null : { provider: row.tracker_provider, account: row.tracker_account ?? undefined },
      ...(row.uses_templates ? { recipes: this.db.prepare<[], string>("SELECT name FROM project_recipes ORDER BY position").pluck().all() } : {}),
      ...(row.has_variables ? { variables: readParams("project_variables") } : {}),
      ...(credentials ? { credentials } : {}),
      ...(row.has_recipe_knowledge ? { recipeKnowledge: this.knowledge() } : {}),
    });
  }

  private knowledge(): NonNullable<Project["recipeKnowledge"]> {
    const recipes: string[] = this.db.prepare<[], string>("SELECT recipe FROM project_knowledge_recipes ORDER BY recipe").pluck().all();
    const steps: Database.Statement<[string], string> = this.db.prepare<[string], string>("SELECT step FROM project_knowledge_steps WHERE recipe = ? ORDER BY step").pluck();
    const reads: Database.Statement<[string, string], string> = this.db.prepare<[string, string], string>(
      "SELECT name FROM project_knowledge_reads WHERE recipe = ? AND step = ? ORDER BY position",
    ).pluck();
    return Object.fromEntries(recipes.map((recipe) => [recipe, Object.fromEntries(steps.all(recipe).map((step) => [step, reads.all(recipe, step)]))]));
  }

  write(input: Project): void {
    const project: Project = Project.parse(input);
    this.db.transaction(() => {
      this.db.exec(`DELETE FROM project_definition; DELETE FROM project_recipes; DELETE FROM project_variables;
        DELETE FROM project_credentials; DELETE FROM project_knowledge_recipes`);
      this.db.prepare(`INSERT INTO project_definition
        (id, name, repo_url, repo_account, folder, base_branch, create_repo, services, pm_name, pm_color, pm_agent_id, tracker_provider, tracker_account,
          uses_templates, has_variables, has_credentials, has_recipe_knowledge)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        project.id, project.name, project.repo?.url ?? null, project.repo?.account ?? null, project.folder, project.baseBranch,
        project.createRepo, project.services, project.pm?.name ?? null, project.pm?.color ?? null, project.pm?.agentId ?? null,
        project.tracker?.provider ?? null, project.tracker?.account ?? null, Number(project.recipes !== undefined), Number(project.variables !== undefined),
        Number(project.credentials !== undefined), Number(project.recipeKnowledge !== undefined),
      );
      const recipe: Database.Statement<[number, string]> = this.db.prepare("INSERT INTO project_recipes (position, name) VALUES (?, ?)");
      for (const [position, name] of (project.recipes ?? []).entries()) recipe.run(position, name);
      const params = (table: "project_variables", data: Record<string, unknown>): void => {
        const insert: Database.Statement<[string, string]> = this.db.prepare(`INSERT INTO ${table} (name, value) VALUES (?, ?)`);
        for (const [name, value] of Object.entries(data)) if (value !== undefined) insert.run(name, JSON.stringify(value));
      };
      params("project_variables", project.variables ?? {});
      const credential: Database.Statement<[string, string]> = this.db.prepare("INSERT INTO project_credentials (name, account) VALUES (?, ?)");
      for (const [name, account] of Object.entries(project.credentials ?? {})) credential.run(name, account);
      this.writeKnowledge(project.recipeKnowledge ?? {});
    })();
  }

  private writeKnowledge(knowledge: NonNullable<Project["recipeKnowledge"]>): void {
    const recipe: Database.Statement<[string]> = this.db.prepare("INSERT INTO project_knowledge_recipes (recipe) VALUES (?)");
    const step: Database.Statement<[string, string]> = this.db.prepare("INSERT INTO project_knowledge_steps (recipe, step) VALUES (?, ?)");
    const read: Database.Statement<[string, string, number, string]> =
      this.db.prepare("INSERT INTO project_knowledge_reads (recipe, step, position, name) VALUES (?, ?, ?, ?)");
    for (const [name, steps] of Object.entries(knowledge)) {
      recipe.run(name);
      for (const [id, reads] of Object.entries(steps)) {
        step.run(name, id);
        for (const [position, file] of reads.entries()) read.run(name, id, position, file);
      }
    }
  }
}
