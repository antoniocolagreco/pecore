import { z } from "zod";
import { JsonSchemaObject, Name, SchemaRef } from "./common";

export const ProjectId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, "lower case letters, digits and dashes, starting with a letter, at most 24");

export function projectIdCandidate(name: string, index: number): string {
  const base: string = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "") || "project";
  const suffix: string = index === 1 ? "" : `-${index}`;
  return base.slice(0, 24 - suffix.length).replace(/-+$/, "") + suffix;
}

export const ProjectManagerIdentity = z.strictObject({
  name: z.string().trim().min(1).max(24),
  color: z.string().regex(/^#[0-9A-F]{6}$/, "a colour like #FFDE38"),
  agentId: Name.optional(),
});
export type ProjectManagerIdentity = z.infer<typeof ProjectManagerIdentity>;

export const projectManagers: readonly ProjectManagerIdentity[] = [
  { name: "Eva", color: "#FFDE38" },
  { name: "Viola", color: "#9D57FF" },
  { name: "Mara", color: "#2F8E76" },
  { name: "Nora", color: "#D65C05" },
  { name: "Cleo", color: "#75C6FF" },
  { name: "Rosa", color: "#FC9CC4" },
  { name: "Luna", color: "#919191" },
  { name: "Zoe", color: "#9C7D21" },
  { name: "Ada", color: "#9FFF1A" },
  { name: "Enya", color: "#75FFFF" },
  { name: "Ivy", color: "#E1EDC9" },
  { name: "Olivia", color: "#699C21" },
  { name: "Jade", color: "#05D690" },
  { name: "Iris", color: "#007DFA" },
  { name: "Mila", color: "#EDD2C9" },
  { name: "Ruby", color: "#F91F44" },
  { name: "Lin", color: "#C3B8FF" },
  { name: "Faye", color: "#F406A5" },
  { name: "Alba", color: "#FFAB57" },
  { name: "Mary", color: "#1391AA" },
];

export function projectManagerClash(identity: ProjectManagerIdentity, others: ProjectManagerIdentity[]): "name" | "color" | null {
  if (others.some(({ name }) => name.toLowerCase() === identity.name.toLowerCase())) return "name";
  if (others.some(({ color }) => color === identity.color)) return "color";
  return null;
}

export function freeProjectManager(used: ProjectManagerIdentity[]): ProjectManagerIdentity | null {
  return projectManagers.find((identity) => projectManagerClash(identity, used) === null) ?? null;
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
    folder: z.string().min(1).nullable().default(null),
    baseBranch: z.string().min(1).default("main"),
    createRepo: Name.nullable().default(null),
    recipes: z.array(Name).optional(),
    variables: JsonSchemaObject.optional(),
    credentials: z.record(z.string(), z.string().min(1)).optional(),
    services: z.string().min(1).nullable().default(null),
    pm: ProjectManagerIdentity.nullable().default(null),
    source: z
      .object({
        node: Name,
        account: z.string().min(1).optional(),
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
export const Project = z.preprocess((input: z.input<typeof ProjectDefinition> & { limits?: unknown; defaultRecipe?: unknown }) => {
  if (!input || typeof input !== "object" || (!Object.hasOwn(input, "limits") && !Object.hasOwn(input, "defaultRecipe"))) return input;
  const current = { ...input };
  delete current.limits;
  delete current.defaultRecipe;
  return current;
}, ProjectDefinition);
export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof ProjectDefinition>;
