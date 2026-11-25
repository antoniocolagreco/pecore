import { z } from "zod";
import { Name } from "./common";
import { HexColor } from "./harnesses";
import { Profile } from "./profiles";
import { ProjectManagerIdentity } from "./project";
import { Compaction } from "./settings";

const agentFields = {
  id: Name,
  name: z.string().trim().min(1).max(80),
  model: Profile.omit({ id: true }).nullable(),
  compaction: Compaction,
};

export const defaultAgentColor: string = "#FFFFFF";
export const agentKindColor: string = "#68389A";
export const defaultAgentId: string = "agent-default";
export const assistantAgentId: string = "assistant";

export const NodeAgent = z.strictObject({ ...agentFields, kind: z.literal("agent"), color: HexColor });
export type NodeAgent = z.infer<typeof NodeAgent>;
export const builtInAgentNames: ReadonlyMap<string, string> = new Map([
  [assistantAgentId, "Assistant"],
  [defaultAgentId, "Default Agent"],
]);

export const ProjectManagerAgent = z.strictObject({
  ...ProjectManagerIdentity.omit({ agentId: true }).shape, id: Name, kind: z.literal("pm"), cardId: Name.default(defaultAgentId),
});
export type ProjectManagerAgent = z.infer<typeof ProjectManagerAgent>;

export const ChatAgent = z.discriminatedUnion("kind", [
  z.strictObject({ ...agentFields, kind: z.literal("assistant"), color: HexColor.nullish() }),
  ProjectManagerAgent.extend({ model: agentFields.model, compaction: Compaction }),
]);
export type ChatAgent = z.infer<typeof ChatAgent>;

export const AgentDefinition = z.discriminatedUnion("kind", [NodeAgent, ProjectManagerAgent]);
export type AgentDefinition = z.infer<typeof AgentDefinition>;

export const AgentDefinitions = z.strictObject({
  agents: z.array(AgentDefinition).default([]),
}).superRefine(({ agents }, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, agent] of agents.entries()) {
    if (ids.has(agent.id) || (agent.kind === "pm" && builtInAgentNames.has(agent.id))) {
      ctx.addIssue({ code: "custom", path: ["agents", index, "id"], message: "Agent ID is duplicated or reserved." });
    }
    const name: string = agent.name.toLowerCase();
    if (agent.kind === "agent" && !builtInAgentNames.has(agent.id) && names.has(name)) ctx.addIssue({ code: "custom", path: ["agents", index, "name"], message: "Each agent needs a unique name." });
    ids.add(agent.id);
    if (agent.kind === "agent" && !builtInAgentNames.has(agent.id)) names.add(name);
  }
});
export type AgentDefinitions = z.infer<typeof AgentDefinitions>;

export const NodeAgentCatalog = AgentDefinitions.safeExtend({ agents: z.array(NodeAgent).default([]) });
export type NodeAgentCatalog = z.infer<typeof NodeAgentCatalog>;
