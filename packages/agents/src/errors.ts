import type { ErrorRule } from "@pecore/schemas";
import type { JsonRpcError } from "./acp/client";
import type { ErrorKind, Quota, TurnResult } from "./types";

const errorKinds: Record<string, { kind: ErrorKind; reset: boolean }> = {
  rate_limit: { kind: "quota", reset: true },
  billing_error: { kind: "quota", reset: false },
  account_on_hold: { kind: "quota", reset: false },
  authentication_failed: { kind: "auth", reset: false },
  oauth_org_not_allowed: { kind: "auth", reset: false },
  overloaded: { kind: "other", reset: false },
  server_error: { kind: "other", reset: false },
};

function resetFrom(value: string, format: ErrorRule["resetFormat"], at: number): number | undefined {
  if (format === "epoch") return Number(value) * 1000;
  if (format === "iso") return Date.parse(value);
  if (format === "seconds") return at + Number(value) * 1000;
  return undefined;
}

export function classify(input: { error?: JsonRpcError; stopReason?: string; quota?: Quota; text: string; rules: ErrorRule[]; at: number }): TurnResult["error"] {
  const raw = input.error ? JSON.stringify(input.error) : input.text.slice(-2000);
  const e = input.error;
  if (e && e.code === -32000 && e.message.startsWith("Authentication required")) return { kind: "auth", raw };
  const data = e?.data !== null && typeof e?.data === "object" ? (e.data as Record<string, unknown>) : undefined;
  const ek = typeof data?.errorKind === "string" ? errorKinds[data.errorKind] : undefined;
  if (ek) {
    const rl = data?.rateLimit as { resetsAt?: unknown } | undefined;
    const resetAt = ek.reset && typeof rl?.resetsAt === "number" ? rl.resetsAt * 1000 : undefined;
    return { kind: ek.kind, raw, ...(resetAt !== undefined ? { resetAt } : {}) };
  }
  if (input.quota?.status === "rejected") return { kind: "quota", raw: JSON.stringify(input.quota), ...(input.quota.resetAt !== undefined ? { resetAt: input.quota.resetAt } : {}) };
  for (const rule of input.rules) {
    const subject = rule.in === "error" ? e?.message : input.text;
    if (subject === undefined) continue;
    const m = new RegExp(rule.pattern).exec(subject);
    if (!m) continue;
    const group = rule.resetAt ? m.groups?.[rule.resetAt] : undefined;
    const resetAt = group !== undefined ? resetFrom(group, rule.resetFormat, input.at) : undefined;
    return { kind: rule.kind, raw, ...(resetAt !== undefined && !Number.isNaN(resetAt) ? { resetAt } : {}) };
  }
  if (e) return { kind: "other", raw };
  if (input.stopReason !== "end_turn") return { kind: "other", raw: `stopReason ${input.stopReason ?? "none"}` };
  return undefined;
}
