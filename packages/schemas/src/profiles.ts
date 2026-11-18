import { z } from "zod";
import { SchemaRef } from "./common";

export const Profile = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    account: z.string().min(1),
    model: z.string().min(1),
    effort: z.string().min(1).nullable().default(null),
  })
  .strict();
export type Profile = z.infer<typeof Profile>;

export const Profiles = z
  .object({
    $schema: SchemaRef,
    profiles: z.array(Profile).default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const [i, prof] of p.profiles.entries()) {
      if (seen.has(prof.id)) ctx.addIssue({ code: "custom", path: ["profiles", i, "id"], message: `duplicate id ${prof.id}` });
      seen.add(prof.id);
    }
  });
export type Profiles = z.infer<typeof Profiles>;
