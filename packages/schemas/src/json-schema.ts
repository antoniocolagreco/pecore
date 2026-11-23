import { z } from "zod";
import { Accounts } from "./accounts";
import { AgentDefinitions } from "./agent";
import { Connector } from "./connector";
import { Node } from "./node";
import { Profiles } from "./profiles";
import { Project } from "./project";
import { Recipe } from "./recipe";
import { Settings } from "./settings";
import { Tiers } from "./tiers";

export const definitionSchemas = {
  node: Node,
  recipe: Recipe,
  project: Project,
  accounts: Accounts,
  agents: AgentDefinitions,
  profiles: Profiles,
  tiers: Tiers,
  settings: Settings,
  connector: Connector,
} as const;

export type DefinitionKind = keyof typeof definitionSchemas;

export function jsonSchemas(): Record<`${DefinitionKind}.json`, unknown> {
  const out = {} as Record<`${DefinitionKind}.json`, unknown>;
  for (const [kind, schema] of Object.entries(definitionSchemas)) {
    out[`${kind as DefinitionKind}.json`] = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  }
  return out;
}
