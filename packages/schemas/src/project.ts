import { z } from "zod";
import { JsonSchemaObject, Name, SchemaRef } from "./common";

export const ProjectId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, "lower case letters, digits and dashes, starting with a letter, at most 24");

export function projectIdCandidate(name: string, index: number): string {
  const base: string = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "") || "project";
  const suffix: string = index === 1 ? "" : `-${index}`;
  return base.slice(0, 24 - suffix.length).replace(/-+$/, "") + suffix;
}

const ProjectDefinition = z
  .object({
    $schema: SchemaRef,
    id: ProjectId,
    name: z.string().min(1),
    repo: z
      .object({
        url: z.string().min(1),
        account: z.string().min(1),
      })
      .strict()
      .nullable(),
    baseBranch: z.string().min(1).default("main"),
    createRepo: Name.nullable().default(null),
    defaultRecipe: Name.nullable().default(null),
    services: z.string().min(1).nullable().default(null),
    source: z
      .object({
        node: Name,
        params: JsonSchemaObject.default({}),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.repo === null && p.createRepo !== null) ctx.addIssue({ code: "custom", path: ["createRepo"], message: "a local-only project has no createRepo" });
  });
export const Project = z.preprocess((input: z.input<typeof ProjectDefinition> & { limits?: unknown }) => {
  if (!input || typeof input !== "object" || !Object.hasOwn(input, "limits")) return input;
  const current = { ...input };
  delete current.limits;
  return current;
}, ProjectDefinition);
export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof ProjectDefinition>;
