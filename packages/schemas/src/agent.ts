import { z } from "zod";
import { Name } from "./common";
import { HexColor } from "./harnesses";
import { Profile } from "./profiles";
import { ProjectManagerIdentity } from "./project";
import { AgentTraits, Compaction } from "./settings";

const agentFields = {
  id: Name,
  name: z.string().trim().min(1).max(80),
  model: Profile.omit({ id: true }).nullable(),
  compaction: Compaction,
};

export const NodeAgent = z.strictObject({ ...agentFields, kind: z.literal("agent"), color: HexColor.nullish() });
export type NodeAgent = z.infer<typeof NodeAgent>;
export const ChatAgent = z.discriminatedUnion("kind", [
  z.strictObject({ ...agentFields, kind: z.literal("assistant"), traits: AgentTraits }),
  z.strictObject({ ...agentFields, ...ProjectManagerIdentity.omit({ agentId: true }).shape, kind: z.literal("pm"), traits: AgentTraits }),
]);
export type ChatAgent = z.infer<typeof ChatAgent>;
export const AgentDefinition = z.discriminatedUnion("kind", [...ChatAgent.options, NodeAgent]);
export type AgentDefinition = z.infer<typeof AgentDefinition>;

export const AgentDefinitions = z.strictObject({
  agents: z.array(AgentDefinition).default([]),
}).superRefine(({ agents }, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, agent] of agents.entries()) {
    if (ids.has(agent.id) || ((agent.id === "assistant") !== (agent.kind === "assistant")) || (agent.kind === "agent" && agent.id === "pm-default")) {
      ctx.addIssue({ code: "custom", path: ["agents", index, "id"], message: "Agent ID is duplicated or reserved." });
    }
    const name: string = agent.name.toLowerCase();
    if (agent.kind === "agent" && names.has(name)) ctx.addIssue({ code: "custom", path: ["agents", index, "name"], message: "Each agent needs a unique name." });
    ids.add(agent.id);
    if (agent.kind === "agent") names.add(name);
  }
});
export type AgentDefinitions = z.infer<typeof AgentDefinitions>;

export const NodeAgentCatalog = AgentDefinitions.safeExtend({ agents: z.array(NodeAgent).default([]) });
export type NodeAgentCatalog = z.infer<typeof NodeAgentCatalog>;
