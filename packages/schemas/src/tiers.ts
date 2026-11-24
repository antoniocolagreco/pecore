import { z } from "zod";

const ProfileList = z.array(z.string().min(1)).default([]);

export const Tiers = z
  .object({
    tiers: z
      .object({
        frontier: ProfileList,
        strong: ProfileList,
        standard: ProfileList,
        cheap: ProfileList,
      })
      .strict()
      .default({ frontier: [], strong: [], standard: [], cheap: [] }),
  })
  .strict();
export type Tiers = z.infer<typeof Tiers>;
