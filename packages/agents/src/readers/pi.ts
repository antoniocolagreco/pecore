import { genericReader, obj } from "./claude-code";
import type { Reader } from "./claude-code";

function readModel(result: unknown): string | undefined {
  const options: unknown = obj(result)?.configOptions;
  if (!Array.isArray(options)) return undefined;
  const model: unknown = obj(options.find((option: unknown) => obj(option)?.id === "model"))?.currentValue;
  return typeof model === "string" && model ? model : undefined;
}

export const piReader: Reader = {
  notification(method, params) {
    if (method !== "session/update") return {};
    const update: ReturnType<typeof obj> = obj(obj(params)?.update);
    if (update?.sessionUpdate !== "config_option_update") return {};
    const model: string | undefined = readModel(update);
    return model ? { model } : {};
  },
  usage: genericReader.usage,
  model: readModel,
};
