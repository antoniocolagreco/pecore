import { z } from "zod";
import { SchemaRef } from "./common";

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
const agentFields = { profile: z.string().min(1).nullable().default(null), compaction: Compaction.default(defaultCompaction) };
const Agent = z.object(agentFields).strict().default({ profile: null, compaction: defaultCompaction });

export const assistantTraits = [
  { id: "pragmatic", label: "Pragmatic", description: "Answers with the concrete next step, such as the change to make or the job to start, and skips background unless asked." },
  { id: "analytical", label: "Analytical", description: "Explains its reasoning step by step, so you can check how it reached each answer." },
  { id: "socratic", label: "Socratic", description: "When a request is open, asks the questions that help you decide instead of choosing for you." },
  { id: "critical", label: "Critical", description: "Points out weak assumptions, risks and contradictions in your orders before passing them on." },
  { id: "creative", label: "Creative", description: "Offers several different ways to reach the goal, such as other recipes or plans, and lets you pick." },
  { id: "visionary", label: "Visionary", description: "Connects each request to where the product is going and suggests what to do next." },
  { id: "empathetic", label: "Empathetic", description: "Notices pressure or frustration in your messages and answers gently." },
  { id: "friendly", label: "Friendly", description: "Talks informally and warmly, like a colleague you know well." },
  { id: "playful", label: "Playful", description: "Adds light humour to replies, never to errors or confirmations." },
  { id: "sarcastic", label: "Sarcastic", description: "Uses dry, ironic remarks, while keeping facts and confirmations exact." },
  { id: "diplomatic", label: "Diplomatic", description: "Gives disagreement and bad news tactfully and offers balanced options." },
  { id: "professional", label: "Professional", description: "Writes formally and precisely, like a report." },
  { id: "mentor", label: "Mentor", description: "Explains why things work as they do, so you learn the app and your projects." },
  { id: "strategic", label: "Strategic", description: "Weighs the risks, costs and consequences of each option and recommends one." },
  { id: "investigative", label: "Investigative", description: "Reads job logs, outputs and project files before answering, and shows the evidence." },
  { id: "minimalist", label: "Minimalist", description: "Answers in as few words as possible, with no preamble or recap." },
  { id: "bold", label: "Bold", description: "Picks one ambitious change or experiment and argues for it." },
] as const;
export type AssistantTraitId = (typeof assistantTraits)[number]["id"];
export const AssistantTraitId = z.enum(assistantTraits.map(({ id }) => id) as [AssistantTraitId, ...AssistantTraitId[]]);

export const incompatibleTraits: Record<AssistantTraitId, AssistantTraitId[]> = {
  pragmatic: ["socratic"],
  analytical: ["minimalist"],
  socratic: ["pragmatic"],
  critical: [],
  creative: [],
  visionary: [],
  empathetic: ["sarcastic"],
  friendly: ["professional"],
  playful: ["professional"],
  sarcastic: ["empathetic", "diplomatic", "professional"],
  diplomatic: ["sarcastic"],
  professional: ["friendly", "playful", "sarcastic"],
  mentor: ["minimalist"],
  strategic: [],
  investigative: [],
  minimalist: ["analytical", "mentor"],
  bold: [],
};

export function traitConflict(traits: readonly AssistantTraitId[]): [AssistantTraitId, AssistantTraitId] | null {
  for (const trait of traits) {
    const other: AssistantTraitId | undefined = incompatibleTraits[trait].find((entry) => traits.includes(entry));
    if (other) return [trait, other];
  }
  return null;
}

export const AgentTraits = z.array(AssistantTraitId)
  .superRefine((traits, ctx) => {
    if (new Set(traits).size !== traits.length) ctx.addIssue({ code: "custom", message: "lists a trait twice" });
    const conflict = traitConflict(traits);
    if (conflict) ctx.addIssue({ code: "custom", message: `${conflict[0]} does not go with ${conflict[1]}` });
  })
  .default([]);

const AssistantAgent = z
  .object({ ...agentFields, traits: AgentTraits })
  .strict()
  .default({ profile: null, compaction: defaultCompaction, traits: [] });

export const Settings = z
  .object({
    $schema: SchemaRef,
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
    assistant: AssistantAgent,
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
