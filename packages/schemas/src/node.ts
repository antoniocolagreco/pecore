import { z } from "zod";
import { ArtifactType } from "./artifacts";
import { Argv, DefinitionName, JsonSchemaObject, Name, Outcome, TierName } from "./common";

const jobPlaceholders = ["job.id", "job.title", "job.branch", "job.base", "job.oldBase", "job.target", "job.commit"];
const projectPlaceholders = ["project.repoDir", "project.repo.url", "project.repo.owner", "project.repo.name"];
const fixedPlaceholders = new Set([...jobPlaceholders, ...projectPlaceholders, "ticket.id", "workdir"]);

const placeholderToken = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;

export function unknownPlaceholders(text: string): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(placeholderToken)) {
    const name = m[1] as string;
    if (fixedPlaceholders.has(name)) continue;
    if (/^params\.[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
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

export function isNodeKindTag(tag: string): boolean {
  return /^(agent|human|command|run command|shell|script)$/i.test(tag.trim());
}

const Base = {
  name: DefinitionName,
  description: z.string().min(1),
  icon: Name.optional(),
  tags: z.array(z.string().trim().min(1)).default([]).transform((tags) => tags.filter((tag) => !isNodeKindTag(tag))),
  params: JsonSchemaObject.default({}),
};

const Runnable = {
  outcomes: z.array(Outcome).min(1),
  outputs: z.record(Outcome, ArtifactType).default({}),
  failOutcomes: z.array(Outcome).default([]),
  scratchPaths: z.array(z.string()).default([]),
  retry: z.number().int().nonnegative().default(1),
};

const Timeout = z.number().int().positive();

export const CommandNode = z
  .object({
    ...Base,
    ...Runnable,
    timeoutSec: Timeout,
    changesFiles: z.boolean(),
    kind: z.literal("command"),
    inputs: z.array(ArtifactType).default([]),
    optionalInputs: z.array(ArtifactType).default([]),
    runsAs: z.enum(["project-user", "engine"]).default("project-user"),
    command: Argv.optional(),
    script: z.string().regex(/^[A-Za-z0-9._-]+\.sh$/).optional(),
    credentials: z.array(z.string()).default([]),
    outcomeRules: z.array(OutcomeRule).min(1),
    outputRules: z.record(Outcome, OutputRule).default({}),
    probe: CommandOrScript.optional(),
    probeRules: JsonRule.optional(),
    mergedCheck: CommandOrScript.optional(),
    mergedCheckRules: JsonRule.optional(),
  })
  .strict();

export const AgentSession = z.enum(["job", "node", "new"]);
export type AgentSession = z.infer<typeof AgentSession>;

export function legacyAgentSession(value: unknown): AgentSession | undefined {
  if (value === "shared") return "job";
  if (value === "isolated") return "new";
  return undefined;
}

export const AgentNode = z
  .object({
    ...Base,
    ...Runnable,
    timeoutSec: Timeout,
    changesFiles: z.boolean(),
    kind: z.literal("agent"),
    prompt: z.string().regex(/^[A-Za-z0-9._-]+\.md$/),
    agent: z
      .object({
        tier: TierName.optional(),
        profiles: z.array(z.string()).min(1).optional(),
        providerNot: z.array(z.string()).default([]),
      })
      .strict(),
    knowledge: z.array(z.string()).default([]),
    agentSession: AgentSession.default("job"),
  })
  .strict();

export const HumanInterface = z.enum(["decision", "code-review", "report-review"]);
export type HumanInterface = z.infer<typeof HumanInterface>;

export const humanInterfaces: Readonly<Record<HumanInterface, { readonly label: string; readonly description: string; readonly outcomes: readonly string[] | null }>> = {
  decision: { label: "Decision", description: "Asks a question in Notifications and follows the answer you choose.", outcomes: null },
  "code-review": { label: "Code review", description: "Shows the job's code changes, with the findings of the nodes it reads, and asks you to approve, request changes or reject.", outcomes: ["approve", "changes", "reject"] },
  "report-review": { label: "Report review", description: "Shows what the nodes it reads produced and asks you to approve, request changes or reject.", outcomes: ["approve", "changes", "reject"] },
};

export const HumanNode = z.strictObject({ ...Base, ...Runnable, kind: z.literal("human"), interface: HumanInterface });
export type HumanNode = z.infer<typeof HumanNode>;

export const TrackerProvider = z.enum(["github", "gitlab", "jira"]);
export type TrackerProvider = z.infer<typeof TrackerProvider>;

export const TrackerNode = CommandNode.pick({
  inputs: true, optionalInputs: true, outcomeRules: true, outputRules: true,
}).extend({
  ...Base,
  ...Runnable,
  kind: z.literal("tracker"),
  timeoutSec: Timeout.default(120),
  changesFiles: z.literal(false).default(false),
  provider: TrackerProvider,
  account: z.string({ error: "Choose an account for this tracker." }).trim().min(1, "Choose an account for this tracker."),
  script: z.string().trim().min(1, "Enter a script for this tracker."),
  repeatCheck: z.literal(true).optional(),
}).strict();
export type TrackerNode = z.infer<typeof TrackerNode>;

type Issue = { path: (string | number)[]; message: string };

function argvPlaceholders(argv: string[] | undefined, path: (string | number)[]): Issue[] {
  if (!argv) return [];
  return argv.flatMap((arg, i) => unknownPlaceholders(arg).map((p) => ({ path: [...path, i], message: `unknown placeholder ${p}` })));
}

function checkNode(node: z.infer<typeof CommandNode> | z.infer<typeof AgentNode> | HumanNode | TrackerNode): Issue[] {
  const issues: Issue[] = [];
  for (const [i, o] of node.failOutcomes.entries()) {
    if (!node.outcomes.includes(o)) issues.push({ path: ["failOutcomes", i], message: `${o} is not in outcomes` });
  }
  if (new Set(node.outcomes).size !== node.outcomes.length) issues.push({ path: ["outcomes"], message: "duplicate outcome" });
  for (const outcome of Object.keys(node.outputs)) {
    if (!node.outcomes.includes(outcome)) issues.push({ path: ["outputs", outcome], message: `${outcome} is not in outcomes` });
  }
  if (node.kind === "command") {
    if ((node.command === undefined) === (node.script === undefined)) issues.push({ path: ["command"], message: "exactly one of command and script" });
    if (node.runsAs !== "engine" && node.credentials.length > 0) issues.push({ path: ["credentials"], message: "Turn on Use source control credentials to use the accounts saved on this node." });
    if (node.runsAs === "engine" && !node.probe) issues.push({ path: ["probe"], message: "Enter a check command that can tell whether the remote action already happened." });
    if (node.runsAs === "engine" && node.changesFiles) issues.push({ path: ["changesFiles"], message: "Turn off Can edit files when using source control credentials." });
    if (node.probeRules && !node.probe) issues.push({ path: ["probeRules"], message: "probeRules without probe" });
    if (node.mergedCheckRules && !node.mergedCheck) issues.push({ path: ["mergedCheckRules"], message: "mergedCheckRules without mergedCheck" });
  }
  if (node.kind === "command" || node.kind === "tracker") {
    for (const [i, r] of node.outcomeRules.entries()) {
      if (!node.outcomes.includes(r.outcome)) issues.push({ path: ["outcomeRules", i, "outcome"], message: `${r.outcome} is not in outcomes` });
    }
    for (const outcome of Object.keys(node.outputRules)) {
      if (node.outputs[outcome] === undefined) issues.push({ path: ["outputRules", outcome], message: `${outcome} has no output` });
    }
    for (const outcome of Object.keys(node.outputs)) {
      if (node.outputRules[outcome] === undefined) issues.push({ path: ["outputs", outcome], message: `${outcome} needs an output rule` });
    }
    for (const [i, type] of node.optionalInputs.entries()) {
      if (node.inputs.includes(type)) issues.push({ path: ["optionalInputs", i], message: `${type} is already a required input` });
    }
  }
  if (node.kind === "command") {
    issues.push(...argvPlaceholders(node.command, ["command"]));
    if (Array.isArray(node.probe)) issues.push(...argvPlaceholders(node.probe, ["probe"]));
    if (Array.isArray(node.mergedCheck)) issues.push(...argvPlaceholders(node.mergedCheck, ["mergedCheck"]));
  }
  if (node.kind === "agent" && (node.agent.tier === undefined) === (node.agent.profiles === undefined)) {
    issues.push({ path: ["agent"], message: "exactly one of tier and profiles" });
  }
  if (node.kind === "human") {
    for (const [outcome, type] of Object.entries(node.outputs)) {
      if (type !== "text") issues.push({ path: ["outputs", outcome], message: "a person can only write text" });
    }
    const outcomes: readonly string[] | null = humanInterfaces[node.interface].outcomes;
    if (outcomes && (node.outcomes.length !== outcomes.length || !outcomes.every((outcome) => node.outcomes.includes(outcome)))) {
      issues.push({ path: ["outcomes"], message: `${humanInterfaces[node.interface].label} needs ${outcomes.join(", ")}` });
    }
  }
  return issues;
}

const NodeShape = z.discriminatedUnion("kind", [CommandNode, AgentNode, HumanNode, TrackerNode]);
const NodeDefinition = NodeShape.superRefine((node, ctx) => {
  for (const issue of checkNode(node)) ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
});
export const Node = z.preprocess((input: z.input<typeof NodeDefinition> & { resume?: unknown; agentContext?: unknown; cleanCheckout?: unknown }) => {
  if (!input || typeof input !== "object") return input;
  if (input.kind === "command" && Object.hasOwn(input, "cleanCheckout")) {
    const current = { ...input };
    delete current.cleanCheckout;
    return current;
  }
  if (input.kind !== "agent") return input;
  const session: AgentSession | undefined = legacyAgentSession(input.agentContext);
  if (!Object.hasOwn(input, "resume") && session === undefined) return input;
  const current = { ...input };
  delete current.resume;
  if (session !== undefined) {
    current.agentSession ??= session;
    delete current.agentContext;
  }
  return current;
}, NodeDefinition);
export type Node = z.infer<typeof Node>;
export type NodeInput = z.input<typeof NodeDefinition>;
export type CommandNode = z.infer<typeof CommandNode>;
export type AgentNode = z.infer<typeof AgentNode>;

export function isHumanNode(node: Node): node is HumanNode {
  return node.kind === "human";
}

export function automaticOutputs(node: Node): ArtifactType[] {
  if (node.kind === "human") return [];
  return [...(node.changesFiles ? ["diff" as const] : []), ...((node.kind === "command" || node.kind === "tracker") ? ["text" as const] : [])];
}
