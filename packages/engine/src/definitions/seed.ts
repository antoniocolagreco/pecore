import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Catalog } from "../store/catalog";
import { validIcon } from "./icon";
import { loadTemplates } from "./load";

export const templatesFormat: string = "4";

export async function seedTemplates(catalog: Catalog, shipped: string): Promise<void> {
  const db: Catalog["db"] = catalog.db;
  if (db.prepare<[], string>("SELECT format FROM catalog_version WHERE id = 1").pluck().get() === templatesFormat) return;
  const definitions: Awaited<ReturnType<typeof loadTemplates>> = await loadTemplates(shipped);
  if (definitions.errors.length) {
    throw new Error(definitions.errors.map(({ file, path, message }) => `${file} ${path} ${message}`).join("\n"));
  }
  const contents: Map<string, string> = new Map();
  for (const name of await readdir(definitions.nodeDir)) {
    if (/^[\w.-]+\.(md|sh)$/.test(name)) contents.set(name, await readFile(join(definitions.nodeDir, name), "utf8"));
  }
  const icons: Map<string, string> = new Map();
  const iconsDir: string = join(shipped, "icons");
  for (const name of await readdir(iconsDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (!/^[\w.-]+\.svg$/.test(name)) continue;
    const svg: string = await readFile(join(iconsDir, name), "utf8");
    if (!validIcon(svg)) throw new Error(`invalid shipped icon ${name}`);
    icons.set(name, svg);
  }
  db.transaction(() => {
    db.exec(`DELETE FROM catalog_nodes WHERE shipped = 1; DELETE FROM catalog_recipes WHERE shipped = 1;
      DELETE FROM catalog_node_content WHERE shipped = 1; DELETE FROM catalog_icons WHERE shipped = 1`);
    for (const node of definitions.nodes.values()) if (!catalog.node(node.name)) catalog.saveNode(node, true);
    for (const recipe of definitions.recipes.values()) if (!catalog.recipe(recipe.name)) catalog.saveRecipe(recipe, true);
    for (const [name, body] of contents) if (catalog.content(name) === null) catalog.saveContent(name, body, true);
    for (const [name, svg] of icons) if (catalog.icon(name) === null) catalog.saveIcon(name, svg, true);
    db.prepare("INSERT OR REPLACE INTO catalog_version (id, format) VALUES (1, ?)").run(templatesFormat);
  })();
}
