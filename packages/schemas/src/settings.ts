import { z } from "zod";
import { SchemaRef } from "./common";

const Compaction = z
  .object({ auto: z.number().int().positive().default(128_000), max: z.number().int().positive().default(256_000) })
  .strict();
const agentFields = { profile: z.string().min(1).nullable().default(null), compaction: Compaction.default({ auto: 128_000, max: 256_000 }) };
const Agent = z.object(agentFields).strict().default({ profile: null, compaction: { auto: 128_000, max: 256_000 } });

export const assistantTraits = [
  { id: "pragmatic", label: "Pragmatic", description: "Direct, concrete, solution-oriented. Few words." },
  { id: "analytical", label: "Analytical", description: "Logical, methodical, rigorous. Breaks every problem down." },
  { id: "socratic", label: "Socratic", description: "Asks smart questions that help you reason on your own." },
  { id: "critical", label: "Critical", description: "Questions assumptions, spots errors and contradictions." },
  { id: "creative", label: "Creative", description: "Imaginative, original, explores unusual possibilities." },
  { id: "visionary", label: "Visionary", description: "Thinks about the future, opportunities and big ideas." },
  { id: "philosophical", label: "Philosophical", description: "Introspective, reflective, interested in what things mean." },
  { id: "stoic", label: "Stoic", description: "Rational, balanced, focused on what can be controlled." },
  { id: "empathetic", label: "Empathetic", description: "Understanding, gentle, attentive to emotions." },
  { id: "friendly", label: "Friendly", description: "Informal, warm, spontaneous. Acts like a friend." },
  { id: "playful", label: "Playful", description: "Cheerful, witty, fond of jokes and irony." },
  { id: "sarcastic", label: "Sarcastic", description: "Sharp, provocative, ironic and unconventional." },
  { id: "rebellious", label: "Rebellious", description: "Nonconformist, challenges conventions and intellectual authority." },
  { id: "diplomatic", label: "Diplomatic", description: "Measured, courteous, able to mediate between opposing views." },
  { id: "professional", label: "Professional", description: "Formal, precise, reliable, with an institutional tone." },
  { id: "academic", label: "Academic", description: "Thorough, scientific, careful with sources and definitions." },
  { id: "mentor", label: "Mentor", description: "Teaches, encourages growth and gives constructive feedback." },
  { id: "coach", label: "Coach", description: "Energetic, motivating, focused on goals and action." },
  { id: "strategic", label: "Strategic", description: "Calculating, far-sighted, weighs risks and consequences." },
  { id: "investigative", label: "Investigative", description: "Curious, skeptical, looks for evidence and hidden links." },
  { id: "minimalist", label: "Minimalist", description: "Essential, concise, cuts any superfluous information." },
  { id: "narrative", label: "Narrative", description: "Expressive, uses stories, analogies and examples." },
  { id: "protective", label: "Protective", description: "Caring, cautious, anticipates risks and problems." },
  { id: "bold", label: "Bold", description: "Confident, enterprising, proposes daring ideas and experiments." },
] as const;
export type AssistantTraitId = (typeof assistantTraits)[number]["id"];
export const AssistantTraitId = z.enum(assistantTraits.map(({ id }) => id) as [AssistantTraitId, ...AssistantTraitId[]]);

export const incompatibleTraits: Record<AssistantTraitId, AssistantTraitId[]> = {
  pragmatic: ["socratic", "philosophical"],
  analytical: [],
  socratic: ["pragmatic"],
  critical: [],
  creative: [],
  visionary: [],
  philosophical: ["pragmatic", "minimalist"],
  stoic: ["playful"],
  empathetic: ["sarcastic"],
  friendly: ["professional"],
  playful: ["stoic", "professional"],
  sarcastic: ["empathetic", "diplomatic", "professional"],
  rebellious: ["diplomatic", "professional"],
  diplomatic: ["sarcastic", "rebellious"],
  professional: ["friendly", "playful", "sarcastic", "rebellious"],
  academic: ["minimalist"],
  mentor: [],
  coach: [],
  strategic: [],
  investigative: [],
  minimalist: ["philosophical", "academic", "narrative"],
  narrative: ["minimalist"],
  protective: ["bold"],
  bold: ["protective"],
};

export function traitConflict(traits: readonly AssistantTraitId[]): [AssistantTraitId, AssistantTraitId] | null {
  for (const trait of traits) {
    const other: AssistantTraitId | undefined = incompatibleTraits[trait].find((entry) => traits.includes(entry));
    if (other) return [trait, other];
  }
  return null;
}

const AssistantAgent = z
  .object({ ...agentFields, traits: z.array(AssistantTraitId).default([]) })
  .strict()
  .superRefine(({ traits }, ctx) => {
    if (new Set(traits).size !== traits.length) ctx.addIssue({ code: "custom", path: ["traits"], message: "lists a trait twice" });
    const conflict = traitConflict(traits);
    if (conflict) ctx.addIssue({ code: "custom", path: ["traits"], message: `${conflict[0]} does not go with ${conflict[1]}` });
  })
  .default({ profile: null, compaction: { auto: 128_000, max: 256_000 }, traits: [] });

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
