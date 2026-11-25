import { z } from "zod";
import { assistantAgentId } from "./agent";
import { DefinitionName, JsonSchemaObject, Name, Outcome, TierName } from "./common";
import { AgentSession, legacyAgentSession } from "./node";
import { templateTitle } from "./template-title";

const NodeId = z.string().regex(/^[a-z][a-z0-9-]*$/);

const RecipeStep = z
  .object({
    use: Name,
    params: JsonSchemaObject.optional(),
    agent: z
      .object({
        tier: TierName.optional(),
        profiles: z.array(z.string()).min(1).optional(),
        providerNot: z.array(NodeId).optional(),
      })
      .strict()
      .optional(),
    reads: z.array(NodeId).default([]),
    requires: z.array(NodeId).default([]),
    optional: z.boolean().default(false),
    agentId: Name.refine((id) => id !== assistantAgentId, "Choose an agent other than Assistant").optional(),
    agentSession: AgentSession.optional(),
    skipWhenUnchanged: z.boolean().default(false),
  })
  .strict();
export const RecipeNode = z.preprocess((input: z.input<typeof RecipeStep> & { session?: unknown; agentContext?: unknown }) => {
  if (!input || typeof input !== "object") return input;
  const session: AgentSession | undefined = legacyAgentSession(input.agentContext);
  if (!Object.hasOwn(input, "session") && session === undefined) return input;
  const current = { ...input };
  delete current.session;
  if (session !== undefined) {
    current.agentSession ??= session;
    delete current.agentContext;
  }
  return current;
}, RecipeStep);
export type RecipeNode = z.infer<typeof RecipeNode>;


export const Edge = z
  .object({
    from: NodeId,
    on: Outcome,
    to: NodeId,
    maxRounds: z.number().int().positive().optional(),
  })
  .strict();
export type Edge = z.infer<typeof Edge>;

export const RecipeEndResult = z.enum(["succeeded", "failed", "not_delivered"]);
export type RecipeEndResult = z.infer<typeof RecipeEndResult>;

export const RecipeEnd = z.object({
  from: NodeId,
  on: Outcome,
  result: RecipeEndResult,
}).strict();
export type RecipeEnd = z.infer<typeof RecipeEnd>;

const RecipeDefinition = z
  .object({
    name: DefinitionName,
    description: z.string().min(1),
    icon: Name.optional(),
    start: NodeId.optional(),
    onBaseChanged: NodeId.optional(),
    ci: z.object({
      after: NodeId,
      on: Outcome,
      intervalSec: z.number().int().positive().default(30),
      timeoutSec: z.number().int().positive(),
      maxCorrections: z.number().int().nonnegative(),
      checks: z.array(z.string().trim().min(1)).min(1),
    }).strict().optional(),
    successOutcomes: z.array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9_]*$/)).default([]),
    ends: z.array(RecipeEnd).optional(),
    layout: z.record(z.union([NodeId, z.literal("@start"), z.literal("@end")]), z.object({ x: z.number(), y: z.number() }).strict()).optional(),
    nodes: z.record(NodeId, RecipeNode).default({}),
    edges: z.array(Edge).default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    const ids = new Set(Object.keys(r.nodes));
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const title = (id: string): string => templateTitle(r.nodes[id]?.use ?? id);
    const outcome = (name: string): string => templateTitle(name.replaceAll("_", "-"));
    if (ids.size === 0) {
      if (r.start !== undefined) issue(["start"], "Connect Start directly to End when the recipe has no steps.");
      if (r.edges.length > 0) issue(["edges"], "Remove the connections to steps that are no longer in the recipe.");
      if (r.ends?.length) issue(["ends"], "A recipe with no steps goes directly from Start to End.");
      return;
    }
    if (r.start === undefined) issue(["start"], "Connect Start to the first step.");
    else if (!ids.has(r.start)) issue(["start"], `Start points to ${title(r.start)}, which is missing. Connect Start to an existing step.`);
    if (r.onBaseChanged !== undefined && !ids.has(r.onBaseChanged)) issue(["onBaseChanged"], `The base-change step ${title(r.onBaseChanged)} is missing. Choose an existing step in Recipe settings.`);
    if (r.ci && !ids.has(r.ci.after)) issue(["ci", "after"], `The step ${title(r.ci.after)} is missing. Choose an existing delivery step for CI.`);
    if (r.ends === undefined && r.successOutcomes.length === 0) issue(["successOutcomes"], "Choose at least one outcome that ends the job successfully.");
    if (r.ends?.length === 0) issue(["ends"], "Connect at least one outcome to End.");
    if (r.ends !== undefined && r.successOutcomes.length) issue(["successOutcomes"], "Set the job results on the connections to End.");
    const seen = new Set<string>();
    for (const [i, e] of r.edges.entries()) {
      if (!ids.has(e.from)) issue(["edges", i, "from"], `A connection starts at ${title(e.from)}, which is missing. Remove or replace that connection.`);
      if (!ids.has(e.to)) issue(["edges", i, "to"], `${title(e.from)} connects to ${title(e.to)}, which is missing. Choose another destination.`);
      const key = `${e.from}:${e.on}`;
      if (seen.has(key)) issue(["edges", i], `${title(e.from)} has two connections for ${outcome(e.on)}. Keep only one.`);
      seen.add(key);
    }
    for (const [i, s] of r.successOutcomes.entries()) {
      const [node, name] = s.split(":") as [string, string];
      if (!ids.has(node)) issue(["successOutcomes", i], `The step ${title(node)} is missing. Choose an outcome from an existing step.`);
      if (seen.has(s)) issue(["successOutcomes", i], `${outcome(name)} on ${title(node)} already goes to another step. Choose one destination.`);
    }
    for (const [i, end] of (r.ends ?? []).entries()) {
      if (!ids.has(end.from)) issue(["ends", i, "from"], `A connection to End comes from ${title(end.from)}, which is missing. Remove or replace that connection.`);
      const key: string = `${end.from}:${end.on}`;
      if (seen.has(key)) issue(["ends", i], `${title(end.from)} already has a connection for ${outcome(end.on)}. Keep only one.`);
      seen.add(key);
    }
    for (const [id, n] of Object.entries(r.nodes)) {
      for (const [i, req] of n.requires.entries()) if (!ids.has(req)) issue(["nodes", id, "requires", i], `${title(id)} requires ${title(req)}, which is missing. Choose an existing step in Requires.`);
      for (const [i, read] of n.reads.entries()) if (!ids.has(read)) issue(["nodes", id, "reads", i], `${title(id)} reads from ${title(read)}, which is missing. Choose an existing step in Reads from.`);
      if (new Set(n.reads).size !== n.reads.length) issue(["nodes", id, "reads"], `${title(id)} reads the same step twice. Select it once in Reads from.`);
      for (const [i, p] of (n.agent?.providerNot ?? []).entries()) if (!ids.has(p)) issue(["nodes", id, "agent", "providerNot", i], `The provider restriction on ${title(id)} refers to ${title(p)}, which is missing. Choose an existing Agent step.`);
      if (n.agent && n.agent.tier !== undefined && n.agent.profiles !== undefined) issue(["nodes", id, "agent"], `Choose a tier or specific profiles for ${title(id)}.`);
    }
  });
export function stripRecipeAnchors<T extends object>(recipe: T): T {
  const current: T & { startPorts?: unknown; edges?: unknown; ends?: unknown } = { ...recipe };
  delete current.startPorts;
  for (const key of ["edges", "ends"] as const) {
    if (!Array.isArray(current[key])) continue;
    current[key] = current[key].map((edge: unknown) => {
      if (!edge || typeof edge !== "object") return edge;
      const connection: { sourcePort?: unknown; targetPort?: unknown } = { ...edge };
      delete connection.sourcePort;
      delete connection.targetPort;
      return connection;
    });
  }
  return current;
}

export const Recipe = z.preprocess((input: z.input<typeof RecipeDefinition> & { maxNodeRuns?: unknown }) => {
  if (!input || typeof input !== "object") return input;
  const current = stripRecipeAnchors(input);
  delete current.maxNodeRuns;
  return current;
}, RecipeDefinition);
export type Recipe = z.infer<typeof Recipe>;
export type RecipeInput = z.input<typeof RecipeDefinition>;
