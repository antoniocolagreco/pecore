import type { Node, Recipe } from "@pecore/schemas";
import type Database from "better-sqlite3";
import { nodeSidecars } from "../definitions/load";
import { Catalog } from "./catalog";

const deliveryNodes: ReadonlySet<string> = new Set(["github-pr", "gitlab-mr"]);
const retiredOutputs: ReadonlySet<string> = new Set(["git-push", "git-delivery", "github-create-repo", "gitlab-create-repo"]);
const changedTemplates: ReadonlySet<string> = new Set([
  "spec-writer", "tests-writer", "builder", "code-reviewer", "approver", "human-review", "write-pr",
  "git-commit", "wait-for-ci", "resolve-rebase-conflicts", "post-delivery-to-ticket", ...deliveryNodes, ...retiredOutputs,
]);

export function migrateArtifactContracts(db: Database.Database, sql: string, inherited?: Database.Database): void {
  db.exec(sql);
  const catalog: Catalog = new Catalog(db);
  const templates: Catalog | undefined = inherited ? new Catalog(inherited) : undefined;
  const nodes = db.prepare<[], { name: string; shipped: number }>("SELECT name, shipped FROM catalog_nodes").all();
  for (const { name, shipped } of nodes) {
    if (shipped) continue;
    const replacement: Node | null | undefined = changedTemplates.has(name) ? templates?.node(name) : undefined;
    if (!replacement) continue;
    catalog.saveNode(replacement);
    for (const [, key] of nodeSidecars(replacement)) {
      const content: string | null = templates!.content(key);
      if (content !== null) catalog.saveContent(key, content);
    }
  }
  db.exec(`
    DELETE FROM catalog_output_rules WHERE EXISTS (
      SELECT 1 FROM catalog_node_outputs o WHERE o.node = catalog_output_rules.node AND o.outcome = catalog_output_rules.output
      AND o.type IN ('document', 'reference', 'diff')
    );
    DELETE FROM catalog_node_outputs WHERE type IN ('document', 'reference', 'diff');
    DELETE FROM catalog_node_lists WHERE field IN ('inputs', 'optionalInputs') AND value IN ('document', 'reference');
  `);
  for (const { name, shipped } of db.prepare<[], { name: string; shipped: number }>("SELECT name, shipped FROM catalog_recipes").all()) {
    if (shipped) continue;
    const recipe: Recipe = catalog.recipe(name)!;
    let changed: boolean = false;
    for (const [id, step] of Object.entries(recipe.nodes)) {
      if (step.use === "git-delivery" && step.reads.length) {
        step.reads = [];
        changed = true;
      }
      for (const consumer of Object.values(recipe.nodes)) {
        if (consumer.use === "post-delivery-to-ticket" && step.use === "git-delivery" && consumer.reads.includes(id)) {
          consumer.reads = consumer.reads.filter((read) => read !== id);
          changed = true;
        }
      }
      if (!deliveryNodes.has(step.use) || step.reads.some((read) => recipe.nodes[read]?.use === "write-pr")) continue;
      const template: Node | null = catalog.node("write-pr") ?? templates?.node("write-pr") ?? null;
      if (!template) continue;
      if (!catalog.node("write-pr")) {
        catalog.saveNode(template);
        for (const [, key] of nodeSidecars(template)) {
          const content: string | null = templates?.content(key) ?? null;
          if (content !== null) catalog.saveContent(key, content);
        }
      }
      let writer: string = "write-pr";
      for (let index: number = 2; recipe.nodes[writer]; index++) writer = `write-pr-${index}`;
      recipe.nodes[writer] = { use: "write-pr", reads: step.reads, requires: [], skipWhenUnchanged: false };
      step.reads = [writer];
      recipe.edges = recipe.edges.map((edge) => edge.to === id ? { ...edge, to: writer } : edge);
      recipe.edges.push({ from: writer, on: "success", to: id });
      if (recipe.start === id) recipe.start = writer;
      if (recipe.onBaseChanged === id) recipe.onBaseChanged = writer;
      changed = true;
    }
    if (changed) catalog.saveRecipe(recipe);
  }
}
