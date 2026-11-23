import { z } from "zod";
import { Name } from "./common";
import { StoredNode } from "./node";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);

export const JobDefinitions = z.object({
  recipeHash: Hash,
  nodes: z.record(Name, z.object({
    definition: StoredNode,
    sidecars: z.record(z.string(), z.string()),
    hash: Hash,
  })),
});
export type JobDefinitions = z.infer<typeof JobDefinitions>;
