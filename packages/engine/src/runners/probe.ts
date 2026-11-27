import type { RepositoryNode } from "@pecore/schemas";
import { run, SpawnError } from "./process";
import type { RunParams, RunResult } from "./process";

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

export async function runProbe(p: RunParams, rule: JsonRule | undefined): Promise<RunResult & { result: ProbeResult }> {
  const r = await run(p).catch((error: unknown) => ({
    code: error instanceof SpawnError && error.code === "not_found" ? 127 : null,
    signal: null,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
    timedOut: false,
  }));
  return { ...r, result: readProbe(r, rule) };
}
