import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { Name } from "@pecore/schemas";
import type { Project } from "@pecore/schemas";
import { z } from "zod";
import { readJson, zodErrors } from "../definitions/load";
import type { DefinitionError } from "../definitions/load";

const forgeDefaults = z.strictObject({
  forge: Name,
  tool: Name,
  credentialHelper: z.string().min(1).nullable(),
  delivery: Name,
  comment: Name.nullable(),
  createRepo: Name.nullable(),
  source: Name.nullable(),
});

export type ForgeDefaults = z.infer<typeof forgeDefaults>;
export type ProjectDefaults = { forge: ForgeDefaults | null; rename: Record<string, string> };

function definitionError(errors: DefinitionError[]): Error {
  return new Error(errors.map(({ file, path, message }) => `${file}${path ? ` at ${path}` : ""}: ${message}`).join("\n"));
}

export async function loadForgeDefaults(templatesDir: string, forge: string): Promise<ForgeDefaults> {
  const file = join(templatesDir, "forges", `${Name.parse(forge)}.json`);
  const { value, error } = await readJson(file);
  if (error) throw definitionError([error]);
  const result = forgeDefaults.safeParse(value);
  if (!result.success) throw definitionError(zodErrors(file, result.error));
  if (result.data.forge !== forge) throw new Error(`${file}: forge must be ${forge}`);
  return result.data;
}

export async function projectDefaults(templatesDir: string, repo: Project["repo"], forgeName: string | null): Promise<ProjectDefaults> {
  if (repo !== null && forgeName === null) throw new Error("A repository project needs a forge");
  const forge = repo !== null && forgeName !== null ? await loadForgeDefaults(templatesDir, forgeName) : null;
  const rename: Record<string, string> = {};
  if (forge !== null) {
    const files = (await readdir(join(templatesDir, "forges"))).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const name = basename(file, ".json");
      const defaults = name === forge.forge ? forge : await loadForgeDefaults(templatesDir, name);
      for (const role of ["delivery", "comment", "createRepo", "source"] as const) {
        const from: string | null = defaults[role];
        const to: string | null = forge[role];
        if (from !== null && to !== null) rename[from] = to;
      }
    }
  }
  return { forge, rename };
}
