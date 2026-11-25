import { z } from "zod";
import { assistantAgentId } from "./agent";
import { DefinitionName, JsonSchemaObject, Name, Outcome, TierName } from "./common";
import { AgentContext } from "./node";

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
    agentContext: AgentContext.optional(),
    skipWhenUnchanged: z.boolean().default(false),
  })
  .strict();
export const RecipeNode = z.preprocess((input: z.input<typeof RecipeStep> & { session?: unknown }) => {
  if (!input || typeof input !== "object" || !Object.hasOwn(input, "session")) return input;
  const current = { ...input };
  delete current.session;
  return current;
}, RecipeStep);
export type RecipeNode = z.infer<typeof RecipeNode>;

export const EdgePort = z.enum(["left", "right", "top", "bottom"]);
export type EdgePort = z.infer<typeof EdgePort>;

export const Edge = z
  .object({
    from: NodeId,
    on: Outcome,
    to: NodeId,
    maxRounds: z.number().int().positive().optional(),
    sourcePort: EdgePort.optional(),
    targetPort: EdgePort.optional(),
  })
  .strict();
export type Edge = z.infer<typeof Edge>;

export const RecipeEndResult = z.enum(["succeeded", "failed", "not_delivered"]);
export type RecipeEndResult = z.infer<typeof RecipeEndResult>;

export const RecipeEnd = z.object({
  from: NodeId,
  on: Outcome,
  result: RecipeEndResult,
  sourcePort: EdgePort.optional(),
  targetPort: EdgePort.optional(),
}).strict();
export type RecipeEnd = z.infer<typeof RecipeEnd>;

const RecipeDefinition = z
  .object({
    name: DefinitionName,
    description: z.string().min(1),
    icon: Name.optional(),
    start: NodeId.optional(),
    startPorts: z.object({ sourcePort: EdgePort.optional(), targetPort: EdgePort.optional() }).strict().optional(),
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
    if (ids.size === 0) {
      if (r.start !== undefined) issue(["start"], "a recipe with no nodes has no start");
      if (r.edges.length > 0) issue(["edges"], "a recipe with no nodes has no edges");
      if (r.ends?.length) issue(["ends"], "a recipe with no steps goes directly from Start to End");
      return;
    }
    if (r.start === undefined) issue(["start"], "required when the recipe has nodes");
    else if (!ids.has(r.start)) issue(["start"], `${r.start} is not a recipe node`);
    if (r.onBaseChanged !== undefined && !ids.has(r.onBaseChanged)) issue(["onBaseChanged"], `${r.onBaseChanged} is not a recipe node`);
    if (r.ci && !ids.has(r.ci.after)) issue(["ci", "after"], `${r.ci.after} is not a recipe node`);
    if (r.ends === undefined && r.successOutcomes.length === 0) issue(["successOutcomes"], "at least one success outcome");
    if (r.ends?.length === 0) issue(["ends"], "connect at least one outcome to End");
    if (r.ends !== undefined && r.successOutcomes.length) issue(["successOutcomes"], "set results on the connections to End");
    const seen = new Set<string>();
    for (const [i, e] of r.edges.entries()) {
      if (!ids.has(e.from)) issue(["edges", i, "from"], `${e.from} is not a recipe node`);
      if (!ids.has(e.to)) issue(["edges", i, "to"], `${e.to} is not a recipe node`);
      const key = `${e.from}:${e.on}`;
      if (seen.has(key)) issue(["edges", i], `two edges from ${e.from} on ${e.on}`);
      seen.add(key);
    }
    for (const [i, s] of r.successOutcomes.entries()) {
      const [node] = s.split(":");
      if (!ids.has(node as string)) issue(["successOutcomes", i], `${node} is not a recipe node`);
      if (seen.has(s)) issue(["successOutcomes", i], `${s} has an edge`);
    }
    for (const [i, end] of (r.ends ?? []).entries()) {
      if (!ids.has(end.from)) issue(["ends", i, "from"], `${end.from} is not a recipe node`);
      const key: string = `${end.from}:${end.on}`;
      if (seen.has(key)) issue(["ends", i], `${key} already has a connection`);
      seen.add(key);
    }
    for (const [id, n] of Object.entries(r.nodes)) {
      for (const [i, req] of n.requires.entries()) if (!ids.has(req)) issue(["nodes", id, "requires", i], `${req} is not a recipe node`);
      for (const [i, read] of n.reads.entries()) if (!ids.has(read)) issue(["nodes", id, "reads", i], `${read} is not a recipe node`);
      if (new Set(n.reads).size !== n.reads.length) issue(["nodes", id, "reads"], "a node is read twice");
      for (const [i, p] of (n.agent?.providerNot ?? []).entries()) if (!ids.has(p)) issue(["nodes", id, "agent", "providerNot", i], `${p} is not a recipe node`);
      if (n.agent && n.agent.tier !== undefined && n.agent.profiles !== undefined) issue(["nodes", id, "agent"], "at most one of tier and profiles");
    }
  });
export const Recipe = z.preprocess((input: z.input<typeof RecipeDefinition> & { maxNodeRuns?: unknown }) => {
  if (!input || typeof input !== "object" || !Object.hasOwn(input, "maxNodeRuns")) return input;
  const current = { ...input };
  delete current.maxNodeRuns;
  return current;
}, RecipeDefinition);
export type Recipe = z.infer<typeof Recipe>;
export type RecipeInput = z.input<typeof RecipeDefinition>;
