import { z } from "zod";
import { ArtifactType } from "./artifacts";
import { Argv, JsonSchemaObject, Name, Outcome, SchemaRef, TierName } from "./common";

const jobPlaceholders = ["job.id", "job.title", "job.branch", "job.base", "job.oldBase", "job.target", "job.commit"];
const projectPlaceholders = ["project.repoDir", "project.repo.url", "project.repo.owner", "project.repo.name"];
const fixedPlaceholders = new Set([...jobPlaceholders, ...projectPlaceholders, "ticket.id", "workdir"]);
const sourcePlaceholders = new Set([...fixedPlaceholders, "comment.path"]);

const placeholderToken = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;

export function unknownPlaceholders(text: string, opts: { source?: boolean } = {}): string[] {
  const allowed = opts.source ? sourcePlaceholders : fixedPlaceholders;
  const bad: string[] = [];
  for (const m of text.matchAll(placeholderToken)) {
    const name = m[1] as string;
    if (allowed.has(name)) continue;
    if (/^params\.[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const input = /^inputs\.([a-z-]+)\.path$/.exec(name);
    if (input && ArtifactType.safeParse(input[1]).success) continue;
    bad.push(`{${name}}`);
  }
  return bad;
}

export function placeholderEnvName(placeholder: string): string {
  return "PECORE_" + placeholder.replace(/[.-]/g, "_").toUpperCase();
}

const ScriptRef = z.object({ script: z.string().regex(/^[A-Za-z0-9._-]+\.sh$/) }).strict();
const CommandOrScript = z.union([Argv, ScriptRef]);

const JsonRule = z
  .object({
    stdoutJson: z.string(),
    done: z.array(z.unknown()).min(1),
    notDone: z.array(z.unknown()).default([]),
  })
  .strict();

export const OutcomeRule = z.union([
  z.object({ exitCode: z.union([z.number().int(), z.literal("other")]), outcome: Outcome }).strict(),
  z.object({ stdoutJson: z.string(), value: z.unknown(), outcome: Outcome }).strict(),
  z.object({ stdoutJson: z.string(), other: z.literal(true), outcome: Outcome }).strict(),
]);
export type OutcomeRule = z.infer<typeof OutcomeRule>;

export const OutputRule = z.union([
  z.object({ file: z.string() }).strict(),
  z.object({ stdoutJson: z.string() }).strict(),
  z.object({ stdoutLastLine: z.string() }).strict(),
]);
export type OutputRule = z.infer<typeof OutputRule>;

const Base = {
  $schema: SchemaRef,
  name: Name,
  description: z.string().min(1),
  params: JsonSchemaObject.default({}),
};

const Runnable = {
  inputs: z.array(ArtifactType).default([]),
  outputs: z.array(ArtifactType).default([]),
  outcomes: z.array(Outcome).min(1),
  failOutcomes: z.array(Outcome).default([]),
  changesFiles: z.boolean(),
  scratchPaths: z.array(z.string()).default([]),
  timeoutSec: z.number().int().positive(),
  retry: z.number().int().nonnegative().default(1),
};

export const CommandNode = z
  .object({
    ...Base,
    ...Runnable,
    kind: z.literal("command"),
    runsAs: z.enum(["project-user", "engine"]).default("project-user"),
    command: Argv.optional(),
    script: z.string().regex(/^[A-Za-z0-9._-]+\.sh$/).optional(),
    cleanCheckout: z.boolean().default(false),
    credentials: z.array(z.string()).default([]),
    outcomeRules: z.array(OutcomeRule).min(1),
    outputRules: z.partialRecord(ArtifactType, OutputRule).default({}),
    probe: CommandOrScript.optional(),
    probeRules: JsonRule.optional(),
    mergedCheck: CommandOrScript.optional(),
    mergedCheckRules: JsonRule.optional(),
  })
  .strict();

export const AgentNode = z
  .object({
    ...Base,
    ...Runnable,
    kind: z.literal("agent"),
    prompt: z.string().regex(/^[A-Za-z0-9._-]+\.md$/),
    agent: z
      .object({
        tier: TierName.optional(),
        profiles: z.array(z.string()).min(1).optional(),
        providerNot: z.array(z.string()).default([]),
      })
      .strict(),
    outputSchema: JsonSchemaObject,
    knowledge: z.array(z.string()).default([]),
    resume: z.boolean().default(false),
  })
  .strict();

export const HumanNode = z
  .object({
    ...Base,
    ...Runnable,
    kind: z.literal("human"),
    show: z.array(ArtifactType).default([]),
    answer: z.boolean().default(false),
  })
  .strict();

const SourceCommand = z
  .object({
    command: Argv.optional(),
    script: z.string().regex(/^[A-Za-z0-9._-]+\.sh$/).optional(),
    outputRules: z.record(z.string(), OutputRule).default({}),
  })
  .strict();

export const SourceNode = z
  .object({
    ...Base,
    kind: z.literal("source"),
    credentials: z.array(z.string()).default([]),
    timeoutSec: z.number().int().positive().default(120),
    list: SourceCommand,
    read: SourceCommand,
    comment: SourceCommand,
    replies: SourceCommand,
  })
  .strict();

type Issue = { path: (string | number)[]; message: string };

function argvPlaceholders(argv: string[] | undefined, path: (string | number)[], source = false): Issue[] {
  if (!argv) return [];
  return argv.flatMap((arg, i) => unknownPlaceholders(arg, { source }).map((p) => ({ path: [...path, i], message: `unknown placeholder ${p}` })));
}

function checkNode(node: z.infer<typeof CommandNode> | z.infer<typeof AgentNode> | z.infer<typeof HumanNode> | z.infer<typeof SourceNode>): Issue[] {
  const issues: Issue[] = [];
  if (node.kind === "source") {
    for (const key of ["list", "read", "comment", "replies"] as const) {
      const c = node[key];
      if ((c.command === undefined) === (c.script === undefined)) issues.push({ path: [key], message: "exactly one of command and script" });
      issues.push(...argvPlaceholders(c.command, [key, "command"], true));
    }
    return issues;
  }
  for (const [i, o] of node.failOutcomes.entries()) {
    if (!node.outcomes.includes(o)) issues.push({ path: ["failOutcomes", i], message: `${o} is not in outcomes` });
  }
  if (new Set(node.outcomes).size !== node.outcomes.length) issues.push({ path: ["outcomes"], message: "duplicate outcome" });
  if (node.kind === "command") {
    if ((node.command === undefined) === (node.script === undefined)) issues.push({ path: ["command"], message: "exactly one of command and script" });
    if (node.runsAs !== "engine" && node.credentials.length > 0) issues.push({ path: ["credentials"], message: "credentials need runsAs: engine" });
    if (node.runsAs === "engine" && !node.probe) issues.push({ path: ["probe"], message: "a runsAs: engine node needs a probe" });
    if (node.runsAs === "engine" && node.changesFiles) issues.push({ path: ["changesFiles"], message: "a runsAs: engine node cannot change files" });
    if (node.probeRules && !node.probe) issues.push({ path: ["probeRules"], message: "probeRules without probe" });
    if (node.mergedCheckRules && !node.mergedCheck) issues.push({ path: ["mergedCheckRules"], message: "mergedCheckRules without mergedCheck" });
    for (const [i, r] of node.outcomeRules.entries()) {
      if (!node.outcomes.includes(r.outcome)) issues.push({ path: ["outcomeRules", i, "outcome"], message: `${r.outcome} is not in outcomes` });
    }
    for (const type of Object.keys(node.outputRules)) {
      if (!node.outputs.includes(type as never)) issues.push({ path: ["outputRules", type], message: `${type} is not in outputs` });
    }
    issues.push(...argvPlaceholders(node.command, ["command"]));
    if (Array.isArray(node.probe)) issues.push(...argvPlaceholders(node.probe, ["probe"]));
    if (Array.isArray(node.mergedCheck)) issues.push(...argvPlaceholders(node.mergedCheck, ["mergedCheck"]));
  }
  if (node.kind === "agent") {
    if ((node.agent.tier === undefined) === (node.agent.profiles === undefined)) issues.push({ path: ["agent"], message: "exactly one of tier and profiles" });
    const props = node.outputSchema.properties as Record<string, unknown> | undefined;
    if (!props || typeof props !== "object" || !("outcome" in props)) issues.push({ path: ["outputSchema"], message: "outputSchema needs a property outcome" });
  }
  return issues;
}

export const Node = z.discriminatedUnion("kind", [CommandNode, AgentNode, HumanNode, SourceNode]).superRefine((node, ctx) => {
  for (const issue of checkNode(node)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export type Node = z.infer<typeof Node>;
export type NodeInput = z.input<typeof Node>;
export type CommandNode = z.infer<typeof CommandNode>;
export type AgentNode = z.infer<typeof AgentNode>;
export type HumanNode = z.infer<typeof HumanNode>;
export type SourceNode = z.infer<typeof SourceNode>;
