import { z } from "zod";
import { KnowledgeFileName, Name } from "./common";
import { Node } from "./node";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);

export const JobDefinitions = z.object({
  recipeHash: Hash,
  knowledgeByStep: z.record(Name, z.array(KnowledgeFileName)).optional(),
  nodes: z.record(Name, z.object({
    definition: Node,
    sidecars: z.record(z.string(), z.string()),
    hash: Hash,
  })),
});
export type JobDefinitions = z.infer<typeof JobDefinitions>;
