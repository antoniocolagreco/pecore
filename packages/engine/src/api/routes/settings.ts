import { createHash } from "node:crypto";
import { assistantAgentId, builtInAgentNames, defaultAgentId } from "@pecore/schemas";
import type { ChatAgent, ProjectManagerAgent } from "@pecore/schemas";
import { validateGlobal } from "../../definitions/load";
import type { DefinitionError, Global } from "../../definitions/load";
import type { Engine } from "../../main";
import { HttpError } from "../server";
import type { Handlers } from "../server";

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function globalFileHandlers(engine: Engine) {
  function chatSettings({ project, role }: { project?: string; role: "assistant" | "pm" }): ChatAgent {
    const value: ChatAgent | undefined = (role === "assistant" || project ? engine.chatAgent(project) : undefined);
    if (!value) throw new HttpError("not_found", "Project Manager not found.");
    return value;
  }

  function knownAgent(id: string): boolean {
    return engine.agentCatalog().agents.some((agent) => agent.id === id)
      || engine.projectManagers().some(({ agentId }) => agentId === id);
  }

  function get<K extends keyof Global>(kind: K): Promise<{ value: Global[K]; sha256: string }> {
    return engine.withConfiguration(async () => {
      const value: Global[K] = engine.global()[kind];
      return { value, sha256: sha256(JSON.stringify(value)) };
    });
  }

  function put<K extends keyof Global>(kind: K, value: Global[K], baseSha256: string, prepare?: () => Global[K], version?: () => string): Promise<{ sha256: string }> {
    return engine.withConfiguration(async () => {
      const current: Global = engine.global();
      if ((version?.() ?? sha256(JSON.stringify(current[kind]))) !== baseSha256) throw new HttpError("conflict", "the configuration changed since it was loaded");
      if (kind === "settings" && "protectedMode" in value && value.protectedMode !== current.settings.protectedMode) {
        throw new HttpError("bad_request", "protected mode changes only through POST /protected-mode");
      }
      const next: Global[K] = prepare?.() ?? value;
      const errors: DefinitionError[] = validateGlobal({ ...current, [kind]: next });
      if (errors.length) throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
      engine.configuration.write({ [kind]: next });
      await engine.reloadGlobal();
      const hash: string = sha256(JSON.stringify(engine.global()[kind]));
      engine.configurationChanged(kind);
      return { sha256: version?.() ?? hash };
    });
  }

  return {
    getSettings: () => get("settings"),
    putSettings: ({ body }) => put("settings", body.value, body.baseSha256),
    getAgents: () => engine.withConfiguration(async () => ({ value: engine.agentCatalog(), sha256: sha256(JSON.stringify(engine.global().agents)) })),
    putAgents: ({ body }) => put("agents", body.value, body.baseSha256, () => {
      const saved = engine.global().agents;
      for (const [id, name] of builtInAgentNames) {
        if (body.value.agents.find((agent) => agent.id === id)?.name !== name) throw new HttpError("bad_request", `${name} cannot be renamed or deleted.`);
        if (body.value.agents.some((agent) => agent.id !== id && agent.name.toLowerCase() === name.toLowerCase())) {
          throw new HttpError("bad_request", `The name ${name} is reserved.`);
        }
      }
      const ids: Set<string> = new Set(body.value.agents.map(({ id }) => id));
      const managers: ProjectManagerAgent[] = saved.agents.filter((agent) => agent.kind === "pm")
        .map((manager) => ids.has(manager.cardId) ? manager : { ...manager, cardId: defaultAgentId });
      return { ...body.value, agents: [...managers, ...body.value.agents] };
    }),
    getChatAgentSettings: ({ query }) => engine.withConfiguration(async () => {
      const value: ChatAgent = chatSettings(query);
      return { value, effectiveModel: value.model, sha256: sha256(JSON.stringify(value)) };
    }),
    putChatAgentSettings: ({ query, body }) => put("agents", engine.global().agents, body.baseSha256, () => {
      const current: ChatAgent = chatSettings({ ...query, role: "pm" });
      const { value } = body;
      if (current.kind !== "pm" || current.id !== value.id) throw new HttpError("bad_request", "The Project Manager's identity changed.");
      const identity = engine.projectManagerFor(value, query.project);
      const cardId: string = value.cardId ?? current.cardId;
      if (cardId === assistantAgentId || !engine.agentCatalog().agents.some(({ id }) => id === cardId)) {
        throw new HttpError("bad_request", "Choose an agent card for this Project Manager.");
      }
      const agent: ProjectManagerAgent = { id: current.id, kind: "pm", name: identity.name, color: identity.color, cardId };
      const saved = engine.global().agents;
      if (saved.agents.some(({ id, kind }) => id === agent.id && kind !== agent.kind)) throw new HttpError("conflict", "The agent ID is already in use.");
      return { ...saved, agents: [...saved.agents.filter(({ id }) => id !== agent.id), agent] };
    }, () => sha256(JSON.stringify(chatSettings({ ...query, role: "pm" })))),
    getAgentContext: ({ params }) => engine.withConfiguration(async () => {
      if (!knownAgent(params.id)) throw new HttpError("not_found", "Agent not found.");
      const content: string = engine.agentContext(params.id);
      return { content, sha256: sha256(content) };
    }),
    putAgentContext: ({ params, body }) => engine.withConfiguration(async () => {
      if (!knownAgent(params.id)) throw new HttpError("not_found", "Agent not found.");
      const before: string = engine.agentContext(params.id);
      if (sha256(before) !== body.baseSha256) throw new HttpError("conflict", "The context changed since it was loaded.");
      if (before !== body.content) engine.setAgentContext(params.id, body.content);
      const hash: string = sha256(body.content);
      engine.configurationChanged("agents");
      return { sha256: hash };
    }),
    getAccounts: () => get("accounts"),
    putAccounts: ({ body }) => put("accounts", body.value, body.baseSha256),
    getProfiles: () => get("profiles"),
    putProfiles: ({ body }) => put("profiles", body.value, body.baseSha256),
    getTiers: () => get("tiers"),
    putTiers: ({ body }) => put("tiers", body.value, body.baseSha256),
  } satisfies Partial<Handlers>;
}
