import { genericReader, obj } from "./claude-code";
import type { Reader } from "./claude-code";

function readModel(result: unknown): string | undefined {
  const options: unknown = obj(result)?.configOptions;
  if (!Array.isArray(options)) return undefined;
  const model: unknown = obj(options.find((option: unknown) => obj(option)?.id === "model"))?.currentValue;
  return typeof model === "string" && model ? model : undefined;
}

export const opencodeReader: Reader = {
  notification(method, params) {
    if (method !== "session/update") return {};
    const update: ReturnType<typeof obj> = obj(obj(params)?.update);
    if (update?.sessionUpdate === "config_option_update") {
      const model: string | undefined = readModel(update);
      return model ? { model } : {};
    }
    if (update?.sessionUpdate !== "usage_update") return {};
    const cost: ReturnType<typeof obj> = obj(update.cost);
    if (typeof cost?.amount !== "number" || typeof cost.currency !== "string") return {};
    return { cost: { amount: cost.amount, currency: cost.currency } };
  },
  usage: genericReader.usage,
  model: readModel,
};
