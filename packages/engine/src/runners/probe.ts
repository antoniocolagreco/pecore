import type { RepositoryNode } from "@pecore/schemas";
import { run } from "./process";
import type { RunResult } from "./process";

export type ProbeResult = "done" | "not_done" | "unknown";

type JsonRule = NonNullable<RepositoryNode["probeRules"]>;

export function readJsonField(stdout: string, field: string): unknown {
  let value: unknown = JSON.parse(stdout);
  for (const key of field.split(".").filter(Boolean)) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function readProbe(r: Pick<RunResult, "code" | "stdout" | "timedOut">, rule: JsonRule | undefined): ProbeResult {
  if (r.timedOut || r.code !== 0) return "unknown";
  if (!rule) return r.stdout.trim() === "" ? "not_done" : "done";
  let value: unknown;
  try {
    value = readJsonField(r.stdout, rule.stdoutJson);
  } catch {
    return "unknown";
  }
  if (rule.done.some((d) => same(d, value))) return "done";
  if (rule.notDone.some((d) => same(d, value))) return "not_done";
  return rule.notDone.length === 0 ? "not_done" : "unknown";
}

export type ProbeRun = { argv: string[]; user: string; cwd: string; env: Record<string, string>; input: string; timeoutMs: number };

export async function runProbe(p: ProbeRun, rule: JsonRule | undefined): Promise<{ result: ProbeResult; stdout: string; stderr: string }> {
  const r = await run(p).catch(() => ({ code: null, signal: null, stdout: "", stderr: "", timedOut: false }));
  return { result: readProbe(r, rule), stdout: r.stdout, stderr: r.stderr };
}
