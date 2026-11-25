import { z } from "zod";
import { HexColor } from "./harnesses";

export const compactionSizes: readonly number[] = [65_536, 131_072, 262_144, 524_288, 1_048_576];
const defaultCompaction = { auto: 131_072, max: 262_144 };

function nearestSize(tokens: number, sizes: readonly number[]): number {
  return sizes.reduce((best, size) => Math.abs(Math.log2(size / tokens)) < Math.abs(Math.log2(best / tokens)) ? size : best);
}

export const Compaction = z
  .object({ auto: z.number().positive().default(defaultCompaction.auto), max: z.number().positive().default(defaultCompaction.max) })
  .strict()
  .transform(({ auto, max }) => {
    const idle: number = nearestSize(auto, compactionSizes.slice(0, -1));
    return { auto: idle, max: nearestSize(max, compactionSizes.filter((size) => size >= idle * 2)) };
  });
export const Settings = z
  .object({
    user: z.object({ name: z.string().trim().min(1).max(60).nullable().default(null) }).strict().default({ name: null }),
    limits: z
      .object({
        jobs: z.number().int().positive().nullable().default(null),
        agents: z.number().int().positive().default(4),
      })
      .strict()
      .default({ jobs: null, agents: 4 }),
    servicesRuntime: z.enum(["docker", "podman", "colima", "orbstack"]).nullable().default(null),
    minFreeDiskGb: z.number().nonnegative().default(10),
    mergeCheckSec: z.number().int().positive().default(300),
    projectsFolder: z.string().min(1).default("~"),
    protectedMode: z.boolean().default(false),
    harnessColors: z.record(z.string(), HexColor).default({}),
    ui: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

export type Role = "assistant" | "pm";

export function defaultJobLimit(cpuCount: number): number {
  return Math.max(1, Math.floor(cpuCount / 2));
}
