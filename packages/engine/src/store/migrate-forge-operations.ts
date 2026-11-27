import { Node } from "@pecore/schemas";
import type { ForgeOperation, Recipe } from "@pecore/schemas";
import type Database from "better-sqlite3";
import { legacyForgeOperations, migrateForgeRecipe } from "../definitions/forge-operations";
import { nodeSidecars } from "../definitions/load";
import { Catalog } from "./catalog";

function installOperation(catalog: Catalog, templates: Catalog | undefined, name: ForgeOperation): void {
  if (catalog.node(name)) return;
  const delivery: boolean = name === "open-pr";
  const node: Node = templates?.node(name) ?? Node.parse({
    name, kind: "repository", account: "project.account",
    description: delivery ? "Open or update a pull request, or deliver the job branch." : "Create a private repository and push its base branch.",
    tags: ["source control"],
    outcomes: ["success", "failure"], failOutcomes: ["failure"],
    outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
    ...(delivery ? { inputs: ["pull_request"], outputs: { success: "pull_request" }, outputRules: { success: { stdoutJson: "" } } } : {}),
  });
  catalog.saveNode(node, true);
  const entry = catalog.chatNode(name);
  if (entry) catalog.approveChatNode(name, entry.hash);
}

export function migrateForgeOperations(db: Database.Database, sql: string, project: boolean, inherited?: Database.Database): void {
  const catalog: Catalog = new Catalog(db);
  const templates: Catalog | undefined = inherited ? new Catalog(inherited) : undefined;
  const builtins: Set<ForgeOperation> = new Set();
  for (const name of ["open-pr", "create-repo"] as const) {
    const existing: Node | null = catalog.node(name);
    if (!existing || (existing.kind === "repository" && !existing.script)) continue;
    let replacement: string = name + "-custom";
    for (let index: number = 2; catalog.node(replacement); index++) replacement = `${name}-custom-${index}`;
    const approved: boolean = catalog.chatNode(name)?.approved ?? false;
    catalog.saveNode({ ...existing, name: replacement });
    const entry = catalog.chatNode(replacement);
    if (entry && approved) catalog.approveChatNode(replacement, entry.hash);
    db.prepare("UPDATE catalog_recipe_steps SET node = ? WHERE node = ?").run(replacement, name);
    if (project) db.prepare("UPDATE project_definition SET create_repo = ? WHERE create_repo = ?").run(replacement, name);
    catalog.delete("nodes", name);
  }
  if (project) db.exec(sql);
  for (const { name, shipped } of db.prepare<[], { name: string; shipped: number }>("SELECT name, shipped FROM catalog_recipes").all()) {
    const recipe: Recipe = catalog.recipe(name)!;
    if (!migrateForgeRecipe(recipe)) continue;
    for (const { use } of Object.values(recipe.nodes)) {
      if (use === "open-pr" || use === "create-repo") builtins.add(use);
    }
    if (project && !catalog.node("write-pr") && Object.values(recipe.nodes).some(({ use }) => use === "write-pr")) {
      const writer: Node | null | undefined = templates?.node("write-pr");
      if (writer) {
        catalog.saveNode(writer);
        for (const [, file] of nodeSidecars(writer)) {
          const content: string | null | undefined = templates?.content(file);
          if (content != null && catalog.content(file) === null) catalog.saveContent(file, content);
        }
      }
    }
    catalog.saveRecipe(recipe, Boolean(shipped));
  }
  if (project) for (const name of builtins) installOperation(catalog, templates, name);
  for (const [legacy] of legacyForgeOperations) catalog.delete("nodes", legacy);
  db.exec(`DELETE FROM catalog_node_content WHERE name IN
    ('git-delivery.sh', 'git-delivery-merged.sh', 'github-pr-probe.sh', 'github-create-repo-probe.sh', 'gitlab-mr.sh', 'gitlab-create-repo-probe.sh')
    AND shipped = 1`);
}
