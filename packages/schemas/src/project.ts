import { z } from "zod";
import { JsonSchemaObject, Name, SchemaRef } from "./common";

export const ProjectId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, "lower case letters, digits and dashes, starting with a letter, at most 24");

export const Budget = z
  .object({
    jobTokens: z.number().int().positive().optional(),
    dayTokens: z.number().int().positive().optional(),
    jobUsd: z.number().positive().optional(),
    dayUsd: z.number().positive().optional(),
  })
  .strict();

export const Project = z
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
    defaultRecipe: Name,
    services: z.string().min(1).nullable().default(null),
    limits: z
      .object({
        jobs: z.number().int().positive().default(2),
        budget: Budget.default({}),
      })
      .strict()
      .default({ jobs: 2, budget: {} }),
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
export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof Project>;
