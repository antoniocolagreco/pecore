import { modelVariant } from "./connectors";
import { probeSession } from "./login";
import type { Login, ResolvedConnector, Spawn } from "./types";

type Options = { models: string[]; efforts: string[]; defaultModel: string | null };

export async function listOptions(p: { connector: ResolvedConnector; login: Login; spawn: Spawn; model?: string; allowUnknownIdentity?: boolean; normalizeModelVariants?: boolean }): Promise<Options | null> {
  const { state, options, models: legacyModels, defaultModel, modelAvailable } = await probeSession(p);
  if (state.state !== "logged_in" && !(p.allowUnknownIdentity && state.state === "unknown")) return null;
  const values = (category: string): string[] => options.filter((o) => o.category === category).flatMap((o) => (o.options ?? []).map((v) => v.value));
  const models: string[] = values("model");
  const efforts: string[] = values("thought_level");
  const defaultId: string | null = defaultModel ?? models[0] ?? legacyModels[0] ?? null;
  const offered: string[] = models.length || p.connector.reader !== "codex" ? models : legacyModels;
  if (p.connector.reader !== "codex" || !p.normalizeModelVariants) {
    return p.model !== undefined && !modelAvailable ? null : { models: offered, efforts, defaultModel: defaultId };
  }
  const defaultModelId: string | null = defaultId === null ? null : (modelVariant(defaultId)?.model ?? defaultId);
  if (!efforts.length) {
    for (const id of legacyModels) {
      const option: ReturnType<typeof modelVariant> = modelVariant(id);
      if (option && option.model === (p.model ?? defaultModelId)) efforts.push(option.effort);
    }
  }
  if (p.model !== undefined && !modelAvailable && !efforts.length) return null;
  return { models: [...new Set(offered.map((id) => modelVariant(id)?.model ?? id))], efforts, defaultModel: defaultModelId };
}
