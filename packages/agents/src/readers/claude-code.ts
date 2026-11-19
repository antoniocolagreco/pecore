import type { Quota, Usage } from "../types";

export type Account = { state: "logged_in"; email: string; plan?: string } | { state: "logged_out" };

export type Reader = {
  notification(method: string, params: unknown): { account?: Account; quota?: Quota; model?: string; cost?: { amount: number; currency: string } };
  usage(result: unknown): Usage;
  model?(result: unknown): string | undefined;
};

type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | undefined => (v !== null && typeof v === "object" ? (v as Obj) : undefined);
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function readQuota(rl: Obj): Quota {
  const q: Quota = { status: String(rl.status ?? "unknown") };
  if (typeof rl.resetsAt === "number") q.resetAt = rl.resetsAt * 1000;
  const windows = obj(rl.unifiedWindows);
  if (windows) {
    q.windows = {};
    for (const [name, w] of Object.entries(windows)) {
      const o = obj(w);
      if (o) q.windows[name] = { utilization: num(o.utilization), resetAt: num(o.resetsAt) * 1000 };
    }
  }
  return q;
}

export const claudeCodeReader: Reader = {
  notification(method, params) {
    const p = obj(params);
    if (!p) return {};
    if (method === "auth/status_update") {
      if (p.state === "unauthenticated") return { account: { state: "logged_out" } };
      const accounts = Array.isArray(p.accounts) ? (p.accounts as unknown[]).map(obj) : [];
      const active = accounts.find((a) => a?.active === true) ?? accounts[0];
      if (p.state === "authenticated" && active && typeof active.email === "string") {
        const plan = obj(obj(active._meta)?.claudeCode)?.plan;
        return { account: { state: "logged_in", email: active.email, ...(typeof plan === "string" ? { plan } : {}) } };
      }
      return {};
    }
    if (method !== "session/update") return {};
    const update = obj(p.update);
    if (update?.sessionUpdate !== "usage_update") return {};
    const meta = obj(update._meta);
    const out: ReturnType<Reader["notification"]> = {};
    if (typeof meta?.["_claude/model"] === "string") out.model = meta["_claude/model"] as string;
    const rl = obj(meta?.["_claude/rateLimit"]);
    if (rl) out.quota = readQuota(rl);
    const cost = obj(update.cost);
    if (cost && typeof cost.amount === "number") out.cost = { amount: cost.amount, currency: String(cost.currency ?? "") };
    return out;
  },
  usage(result) {
    const r = obj(result);
    const models = obj(obj(r?._meta)?.quota)?.model_usage;
    if (Array.isArray(models) && models.length > 0) {
      const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const m of models) {
        const t = obj(obj(m)?.token_count);
        u.input += num(t?.inputTokens);
        u.output += num(t?.outputTokens);
        u.cacheRead += num(t?.cachedInputTokens);
        u.cacheWrite += num(t?.cachedWriteTokens);
      }
      return u;
    }
    const usage = obj(r?.usage);
    return { input: num(usage?.inputTokens), output: num(usage?.outputTokens), cacheRead: num(usage?.cachedReadTokens), cacheWrite: num(usage?.cachedWriteTokens) };
  },
};

export const genericReader: Reader = {
  notification() {
    return {};
  },
  usage(result) {
    const usage = obj(obj(result)?.usage);
    return { input: num(usage?.inputTokens), output: num(usage?.outputTokens), cacheRead: num(usage?.cachedReadTokens), cacheWrite: num(usage?.cachedWriteTokens) };
  },
};
