import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { ArtifactType, CommandNode, FailureReason, OutcomeRule, OutputRule } from "@pecore/schemas";
import { createCleanCheckout, removeCleanCheckout } from "../workdir/content-state";
import { FsAsError, readFileAs, writeFileAs } from "../workdir/fs-as";
import { placeholderEnv, placeholderValues, substituteArgv } from "./placeholders";
import type { PlaceholderContext } from "./placeholders";
import { appUser, baseEnv, run, SpawnError } from "./process";
import type { RunResult } from "./process";
import { readJsonField, runProbe } from "./probe";

export type CommandInput = { type: ArtifactType; path: string };

export type CommandRun = {
  node: CommandNode;
  nodeDir: string;
  params: Record<string, unknown>;
  user: string;
  workdir: string;
  context: Omit<PlaceholderContext, "inputs" | "params" | "workdir">;
  inputs: CommandInput[];
  cleanTree: string | null;
  extraEnv?: Record<string, string>;
  onStart?: (pgid: number, user: string) => void;
  effect?: { requested(hash: string): void; done(ok: boolean, result: unknown): void };
};

export type CommandOutcome =
  | { kind: "completed"; outcome: string; outputs: { type: ArtifactType; content: string }[]; log: string; fromProbe: boolean }
  | { kind: "failed"; reason: FailureReason; log: string }
  | { kind: "waiting"; reason: "network"; log: string };

export function pickOutcome(rules: OutcomeRule[], r: Pick<RunResult, "code" | "stdout">): string | null {
  for (const rule of rules) {
    if ("exitCode" in rule) {
      if (rule.exitCode === "other" || rule.exitCode === r.code) return rule.outcome;
      continue;
    }
    let value: unknown;
    try {
      value = readJsonField(r.stdout, rule.stdoutJson);
    } catch {
      continue;
    }
    if ("other" in rule || JSON.stringify(value) === JSON.stringify(rule.value)) return rule.outcome;
  }
  return null;
}

function lastLine(stdout: string): string {
  return stdout.trimEnd().split("\n").pop() ?? "";
}

async function readOutput(rule: OutputRule, stdout: string, read: (rel: string) => Promise<string>): Promise<string> {
  if ("stdoutLastLine" in rule) return JSON.stringify({ [rule.stdoutLastLine]: lastLine(stdout) });
  if ("stdoutJson" in rule) return JSON.stringify(readJsonField(stdout, rule.stdoutJson) ?? null);
  return read(rule.file);
}

async function argvOf(spec: string[] | { script: string } | undefined, inline: string | undefined, nodeDir: string, label: string, values: Record<string, string>): Promise<string[]> {
  if (Array.isArray(spec)) return substituteArgv(spec, values);
  const file = spec?.script ?? inline;
  if (!file) throw new Error(`${label}: no command`);
  return ["/bin/sh", "-c", await readFile(join(nodeDir, file), "utf8"), label];
}

function inputFile(type: ArtifactType, source: string): string {
  return `.pecore/inputs/${type}${extname(source) || ".txt"}`;
}

export function commandHash(argv: string[]): string {
  return JSON.stringify(argv);
}

export async function runCommandNode(c: CommandRun): Promise<CommandOutcome> {
  const engine = c.node.runsAs === "engine";
  const user = engine ? appUser : c.user;
  const temp: string[] = [];
  let cleanDir: string | null = null;
  let cwd = c.workdir;
  try {
    if (engine) {
      cwd = await mkdtemp(join(tmpdir(), "pecore-engine-"));
      temp.push(cwd);
    } else if (c.node.cleanCheckout && c.cleanTree) {
      cleanDir = join(c.workdir, "..", `.clean-${c.context.job.id}`);
      await removeCleanCheckout(c.user, c.workdir, cleanDir);
      await createCleanCheckout(c.user, c.workdir, c.cleanTree, cleanDir);
      cwd = cleanDir;
    }
    const inputs: Record<string, string> = {};
    for (const i of c.inputs) {
      if (engine) {
        inputs[i.type] = i.path;
        continue;
      }
      const rel = inputFile(i.type, i.path);
      await writeFileAs(c.user, cwd, rel, await readFile(i.path));
      inputs[i.type] = join(cwd, rel);
    }
    const values = placeholderValues({ ...c.context, params: c.params, workdir: cwd, inputs });
    const env = { ...(await baseEnv(user)), ...placeholderEnv(values), ...c.extraEnv };
    const timeoutMs = c.node.timeoutSec * 1000;
    let log = "";

    if (c.node.probe) {
      const argv = await argvOf(c.node.probe, undefined, c.nodeDir, `${c.node.name}-probe`, values);
      const p = await runProbe({ argv, user, cwd, env, timeoutMs }, c.node.probeRules);
      log += `$ probe\n${p.stdout}${p.stderr}probe: ${p.result}\n`;
      if (p.result === "unknown") return { kind: "waiting", reason: "network", log };
      if (p.result === "done") {
        const outcome = pickOutcome(c.node.outcomeRules, { code: 0, stdout: p.stdout });
        if (outcome === null) return { kind: "failed", reason: "HARNESS_ERROR", log: log + "no outcome rule matched the probe output\n" };
        const outputs = [];
        for (const [type, rule] of Object.entries(c.node.outputRules) as [ArtifactType, OutputRule][]) {
          if ("file" in rule) continue;
          outputs.push({ type, content: await readOutput(rule, p.stdout, async () => "") });
        }
        return { kind: "completed", outcome, outputs, log, fromProbe: true };
      }
    }

    const argv = await argvOf(c.node.command, c.node.script, c.nodeDir, c.node.name, values);
    const hash = commandHash(argv);
    if (engine) c.effect?.requested(hash);
    let r: RunResult;
    try {
      r = await run({ user, argv, cwd, env, timeoutMs, onStart: (pgid) => c.onStart?.(pgid, user) });
    } catch (e) {
      if (engine) c.effect?.done(false, { error: String(e) });
      if (e instanceof SpawnError && e.code === "not_found") return { kind: "failed", reason: "COMMAND_NOT_FOUND", log: log + `${argv[0]}: not found\n` };
      throw e;
    }
    log += `$ ${c.node.script ?? argv.join(" ")}\n${r.stdout}${r.stderr}exit: ${r.code ?? r.signal}\n`;
    if (engine) c.effect?.done(r.code === 0, { code: r.code, stdout: r.stdout.slice(-4096) });
    if (r.timedOut) return { kind: "failed", reason: "TIMEOUT", log };
    if (r.code === null) return { kind: "failed", reason: "PROCESS_KILLED", log };
    if (r.code === 127) return { kind: "failed", reason: "COMMAND_NOT_FOUND", log };
    const outcome = pickOutcome(c.node.outcomeRules, r);
    if (outcome === null) return { kind: "failed", reason: "HARNESS_ERROR", log: log + "no outcome rule matched\n" };
    const outputs = [];
    for (const [type, rule] of Object.entries(c.node.outputRules) as [ArtifactType, OutputRule][]) {
      try {
        outputs.push({ type, content: await readOutput(rule, r.stdout, (rel) => (engine ? readFile(join(cwd, rel), "utf8") : readFileAs(c.user, cwd, rel))) });
      } catch (e) {
        if (e instanceof FsAsError) return { kind: "failed", reason: "HARNESS_ERROR", log: log + `output ${type}: ${e.message}\n` };
        throw e;
      }
    }
    return { kind: "completed", outcome, outputs, log, fromProbe: false };
  } finally {
    if (cleanDir) await removeCleanCheckout(c.user, c.workdir, cleanDir);
    for (const d of temp) await rm(d, { recursive: true, force: true });
  }
}
