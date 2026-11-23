import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ChatAgent } from "@pecore/schemas";
import type { Global } from "../../definitions/load";
import { commitDefinition, commitMessage } from "../../home/git-commit";
import { homePaths } from "../../home/layout";
import type { Engine } from "../../main";
import { HttpError } from "../server";
import type { Handlers } from "../server";

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function globalFileHandlers(engine: Engine) {
  const paths = homePaths(resolve(engine.opts.home));

  function chatSettings({ project, role }: { project?: string; role: "assistant" | "pm" }): ChatAgent {
    const value: ChatAgent | undefined = engine.chatAgentSettings(project, role);
    if (!value) throw new HttpError("not_found", "Project Manager not found.");
    return value;
  }

  function knownAgent(id: string): boolean {
    return id === "assistant" || id === "pm-default" || engine.agentCatalog().agents.some((agent) => agent.id === id)
      || engine.projectManagers().some(({ agentId }) => agentId === id);
  }

  function get<K extends keyof Global>(kind: K): Promise<{ value: Global[K]; sha256: string }> {
    return engine.withGlobalFiles(async () => {
      const bytes: Buffer | null = await readBytes(paths[kind]);
      return { value: engine.global()[kind], sha256: sha256(bytes ?? "") };
    });
  }

  function put<K extends keyof Global>(kind: K, value: Global[K], baseSha256: string, prepare?: () => Global[K]): Promise<{ sha256: string }> {
    return engine.withGlobalFiles(async () => {
      const file: string = paths[kind];
      const before: Buffer | null = await readBytes(file);
      if (sha256(before ?? "") !== baseSha256) throw new HttpError("conflict", "the file changed since it was loaded");
      if (kind === "settings" && "protectedMode" in value && value.protectedMode !== engine.global().settings.protectedMode) {
        throw new HttpError("bad_request", "protected mode changes only through POST /protected-mode");
      }
      const content: string = JSON.stringify(prepare?.() ?? value, null, 2) + "\n";
      await writeFile(file, content);
      const errors = await engine.reloadGlobal();
      if (errors.length) {
        if (before === null) await rm(file);
        else await writeFile(file, before);
        await engine.reloadGlobal();
        throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
      }
      const name: string = `${kind}.json`;
      await commitDefinition(paths.home, [file], commitMessage(kind, name, "edited"));
      const hash: string = sha256(content);
      engine.definitionChanged(name, hash);
      return { sha256: hash };
    });
  }

  return {
    getSettings: () => get("settings"),
    putSettings: ({ body }) => put("settings", body.value, body.baseSha256),
    getAgents: () => engine.withGlobalFiles(async () => ({ value: engine.agentCatalog(), sha256: sha256(await readBytes(paths.agents) ?? "") })),
    putAgents: ({ body }) => put("agents", body.value, body.baseSha256, () => {
      const saved = engine.global().agents;
      return { ...body.value, agents: [...saved.agents.filter(({ kind }) => kind !== "agent"), ...body.value.agents] };
    }),
    getChatAgentSettings: ({ query }) => engine.withGlobalFiles(async () => ({
      value: chatSettings(query),
      effectiveModel: engine.chatAgent(query.project, query.role)?.model ?? null,
      sha256: sha256(await readBytes(paths.agents) ?? ""),
    })),
    putChatAgentSettings: ({ query, body }) => put("agents", engine.global().agents, body.baseSha256, () => {
      const current: ChatAgent = chatSettings(query);
      const { value } = body;
      if (current.id !== value.id || current.kind !== value.kind) throw new HttpError("bad_request", "The chat agent's identity changed.");
      if (query.project && value.kind === "pm") engine.projectManagerFor(value, query.project);
      const saved = engine.global().agents;
      if (saved.agents.some(({ id, kind }) => id === value.id && kind !== value.kind)) throw new HttpError("conflict", "The agent ID is already in use.");
      return { ...saved, agents: [...saved.agents.filter(({ id }) => id !== value.id), value] };
    }),
    getAgentContext: ({ params }) => engine.withGlobalFiles(async () => {
      if (!knownAgent(params.id)) throw new HttpError("not_found", "Agent not found.");
      const content: string = await engine.agentContext(params.id);
      return { content, sha256: sha256(content) };
    }),
    putAgentContext: ({ params, body }) => engine.withGlobalFiles(async () => {
      if (!knownAgent(params.id)) throw new HttpError("not_found", "Agent not found.");
      const before: string = await engine.agentContext(params.id);
      if (sha256(before) !== body.baseSha256) throw new HttpError("conflict", "The context changed since it was loaded.");
      const file: string = join(paths.agentContexts, `${params.id}.md`);
      if (before !== body.content) {
        await mkdir(paths.agentContexts, { recursive: true });
        const previous: Buffer | null = await readBytes(file);
        await writeFile(file, body.content);
        try {
          await commitDefinition(paths.home, [file], commitMessage("agent context", `${params.id}.md`, previous ? "edited" : "created"));
        } catch (error) {
          if (previous === null) await rm(file, { force: true });
          else await writeFile(file, previous);
          throw error;
        }
      }
      const hash: string = sha256(body.content);
      engine.definitionChanged(`agents/${params.id}.md`, hash);
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
