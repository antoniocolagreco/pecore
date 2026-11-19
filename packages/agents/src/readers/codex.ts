import type { Usage } from "../types";
import { genericReader, obj } from "./claude-code";
import type { Reader } from "./claude-code";

export const codexReader: Reader = {
  notification(method, params) {
    if (method !== "_auth/status_update") return {};
    const status: ReturnType<typeof obj> = obj(obj(params)?.authStatus);
    if (status?.kind === "none") return { account: { state: "logged_out" } };
    if (status?.kind !== "account") return {};
    const account: ReturnType<typeof obj> = obj(status.account);
    if (typeof account?.email !== "string" || !account.email) return {};
    const plan: unknown = account.plan;
    return { account: { state: "logged_in", email: account.email, ...(typeof plan === "string" ? { plan } : {}) } };
  },
  usage(result) {
    const usage: Usage = genericReader.usage(result);
    return { ...usage, input: Math.max(0, usage.input - usage.cacheRead) };
  },
  model(result) {
    const meta: ReturnType<typeof obj> = obj(obj(result)?._meta);
    const models: unknown = obj(meta?.quota)?.model_usage;
    if (!Array.isArray(models) || models.length !== 1) return undefined;
    const model: unknown = obj(models[0])?.model;
    return typeof model === "string" && model ? model : undefined;
  },
};
