import { z } from "zod";
import { SchemaRef } from "./common";

const Price = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  })
  .strict();

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Settings = z
  .object({
    $schema: SchemaRef,
    limits: z
      .object({
        jobs: z.number().int().positive().nullable().default(null),
        agents: z.number().int().positive().default(4),
        providers: z.record(z.string(), z.number().int().positive()).default({}),
      })
      .strict()
      .default({ jobs: null, agents: 4, providers: {} }),
    servicesRuntime: z.enum(["docker", "podman", "colima", "orbstack"]).nullable().default(null),
    projectPaths: z.record(z.string(), z.string().min(1)).default({}),
    minFreeDiskGb: z.number().nonnegative().default(10),
    mergeCheckSec: z.number().int().positive().default(300),
    prices: z.record(z.string(), Price).default({}),
    programPaths: z.record(z.string(), z.string().regex(/^\//, "absolute path")).default({}),
    quietHours: z.object({ from: Time, to: Time }).strict().nullable().default(null),
    assistant: z.object({ profile: z.string().min(1) }).strict().nullable().default(null),
    orchestrator: z.object({ profile: z.string().min(1) }).strict().nullable().default(null),
    compaction: z
      .object({ auto: z.number().int().positive().default(128_000), max: z.number().int().positive().default(256_000) })
      .strict()
      .default({ auto: 128_000, max: 256_000 }),
    protectedMode: z.boolean().default(false),
    ui: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type Settings = z.infer<typeof Settings>;

export type Role = "assistant" | "orchestrator";

export function roleProfile(settings: Pick<Settings, "assistant" | "orchestrator">, role: Role): string | null {
  const assistant: string | null = settings.assistant?.profile ?? settings.orchestrator?.profile ?? null;
  return role === "assistant" ? assistant : settings.orchestrator?.profile ?? assistant;
}

export function defaultJobLimit(cpuCount: number): number {
  return Math.max(1, Math.floor(cpuCount / 2));
}
