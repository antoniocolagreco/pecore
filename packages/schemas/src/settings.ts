import { z } from "zod";
import { SchemaRef } from "./common";

const Compaction = z
  .object({ auto: z.number().int().positive().default(128_000), max: z.number().int().positive().default(256_000) })
  .strict();
const Agent = z
  .object({ profile: z.string().min(1).nullable().default(null), compaction: Compaction.default({ auto: 128_000, max: 256_000 }) })
  .strict()
  .default({ profile: null, compaction: { auto: 128_000, max: 256_000 } });

export const Settings = z
  .object({
    $schema: SchemaRef,
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
    assistant: Agent,
    pm: Agent,
    protectedMode: z.boolean().default(false),
    ui: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

export type Role = "assistant" | "pm";

export function roleProfile(settings: Pick<Settings, Role>, role: Role): string | null {
  return role === "pm" ? settings.pm.profile ?? settings.assistant.profile : settings.assistant.profile;
}

export function defaultJobLimit(cpuCount: number): number {
  return Math.max(1, Math.floor(cpuCount / 2));
}
