import { z } from "zod";
import { DefinitionName, JsonSchemaObject, Name, Outcome, SchemaRef, TierName } from "./common";

const NodeId = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const RecipeNode = z
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
    requires: z.array(NodeId).default([]),
    optional: z.boolean().default(false),
    session: z.string().min(1).optional(),
    skipWhenUnchanged: z.boolean().default(false),
  })
  .strict();
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

export const Recipe = z
  .object({
    $schema: SchemaRef,
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
    maxNodeRuns: z.number().int().positive().default(100),
    successOutcomes: z.array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9_]*$/)).default([]),
    layout: z.record(NodeId, z.object({ x: z.number(), y: z.number() }).strict()).optional(),
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
      return;
    }
    if (r.start === undefined) issue(["start"], "required when the recipe has nodes");
    else if (!ids.has(r.start)) issue(["start"], `${r.start} is not a recipe node`);
    if (r.onBaseChanged !== undefined && !ids.has(r.onBaseChanged)) issue(["onBaseChanged"], `${r.onBaseChanged} is not a recipe node`);
    if (r.ci && !ids.has(r.ci.after)) issue(["ci", "after"], `${r.ci.after} is not a recipe node`);
    if (r.successOutcomes.length === 0) issue(["successOutcomes"], "at least one success outcome");
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
    for (const [id, n] of Object.entries(r.nodes)) {
      for (const [i, req] of n.requires.entries()) if (!ids.has(req)) issue(["nodes", id, "requires", i], `${req} is not a recipe node`);
      for (const [i, p] of (n.agent?.providerNot ?? []).entries()) if (!ids.has(p)) issue(["nodes", id, "agent", "providerNot", i], `${p} is not a recipe node`);
      if (n.agent && n.agent.tier !== undefined && n.agent.profiles !== undefined) issue(["nodes", id, "agent"], "at most one of tier and profiles");
    }
  });
export type Recipe = z.infer<typeof Recipe>;
export type RecipeInput = z.input<typeof Recipe>;
