import { z } from "zod";
import { KnowledgeFileName, Name } from "./common";
import { Node, upgradeLegacyNode } from "./node";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);

export const JobDefinitions = z.object({
  recipeHash: Hash,
  knowledgeByStep: z.record(Name, z.array(KnowledgeFileName)).optional(),
  nodes: z.record(Name, z.object({
    definition: z.unknown(),
    sidecars: z.record(z.string(), z.string()),
    hash: Hash,
  }).transform((entry, ctx) => {
    const result = Node.safeParse(upgradeLegacyNode(entry.definition, entry.sidecars));
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: ["definition", ...issue.path] });
      return z.NEVER;
    }
    return { ...entry, definition: result.data };
  })),
});
export type JobDefinitions = z.infer<typeof JobDefinitions>;
