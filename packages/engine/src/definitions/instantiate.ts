import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadNodeFile, loadRecipeFile } from "./load";
import type { DefinitionError } from "./load";

export type InstantiateResult = { written: string[]; kept: string[]; errors: DefinitionError[] };

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function instanceJson(from: string, schema: string, update?: (value: Record<string, unknown>) => void): Promise<string> {
  const value = JSON.parse(await readFile(from, "utf8")) as Record<string, unknown>;
  update?.(value);
  return JSON.stringify({ ...value, $schema: `../../../schemas/${schema}` }, null, 2) + "\n";
}

export async function instantiateNode(libraryDir: string, projectDir: string, name: string): Promise<InstantiateResult> {
  const result: InstantiateResult = { written: [], kept: [], errors: [] };
  const target = join(projectDir, "nodes", `${name}.json`);
  if (await exists(target)) {
    result.kept.push(target);
    return result;
  }
  const source = join(libraryDir, "nodes", `${name}.json`);
  const loaded = await loadNodeFile(source);
  if (!loaded.value) {
    result.errors.push(...loaded.errors);
    return result;
  }
  const node = loaded.value;
  await mkdir(join(projectDir, "nodes"), { recursive: true });
  const sidecars: string[] = [];
  if (node.kind === "agent") sidecars.push(node.prompt);
  if (node.kind === "command") {
    if (node.script) sidecars.push(node.script);
    if (node.probe && !Array.isArray(node.probe)) sidecars.push(node.probe.script);
    if (node.mergedCheck && !Array.isArray(node.mergedCheck)) sidecars.push(node.mergedCheck.script);
  }
  if (node.kind === "source") {
    for (const key of ["list", "read", "comment", "replies"] as const) if (node[key].script) sidecars.push(node[key].script!);
  }
  for (const file of new Set(sidecars)) {
    const to = join(projectDir, "nodes", file);
    await copyFile(join(libraryDir, "nodes", file), to);
    result.written.push(to);
  }
  await writeFile(target, await instanceJson(source, "node.json"));
  result.written.push(target);
  return result;
}

export async function instantiateRecipe(libraryDir: string, projectDir: string, name: string, rename: Record<string, string> = {}, validate?: (content: string) => Promise<DefinitionError[]>): Promise<InstantiateResult> {
  const result: InstantiateResult = { written: [], kept: [], errors: [] };
  const source = join(libraryDir, "recipes", `${name}.json`);
  const loaded = await loadRecipeFile(source);
  if (!loaded.value) {
    result.errors.push(...loaded.errors);
    return result;
  }
  const renamedUse = (use: string) => (Object.hasOwn(rename, use) ? rename[use] : undefined) ?? use;
  for (const use of new Set(Object.values(loaded.value.nodes).map((n) => renamedUse(n.use)))) {
    const r = await instantiateNode(libraryDir, projectDir, use);
    result.written.push(...r.written);
    result.kept.push(...r.kept);
    result.errors.push(...r.errors);
  }
  if (result.errors.length) return result;
  const target = join(projectDir, "recipes", `${name}.json`);
  if (await exists(target)) {
    result.kept.push(target);
    return result;
  }
  const content: string = await instanceJson(source, "recipe.json", (recipe) => {
    const nodes = recipe.nodes as Record<string, { use: string }> | undefined;
    for (const node of Object.values(nodes ?? {})) node.use = renamedUse(node.use);
  });
  if (validate) result.errors.push(...await validate(content));
  if (result.errors.length) return result;
  await mkdir(join(projectDir, "recipes"), { recursive: true });
  await writeFile(target, content);
  result.written.push(target);
  return result;
}
