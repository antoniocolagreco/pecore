import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactTypes } from "@pecore/schemas";
import type { ArtifactType, CommandNode, FailureReason, OutcomeRule, OutputRule, RepositoryNode } from "@pecore/schemas";
import { FsAsError, readFileAs } from "../workdir/fs-as";
import { gitIdentityEnv } from "../workdir/git-as";
import { placeholderEnv, placeholderValues, substituteArgv } from "./placeholders";
import type { PlaceholderContext } from "./placeholders";
import { appUser, baseEnv, run, SpawnError } from "./process";
import type { RunResult } from "./process";
import { readJsonField, runProbe } from "./probe";
import type { ProbeResult } from "./probe";

export type CommandInput = { type: ArtifactType; content: string };

export type CommandRun<Output extends string = ArtifactType> = {
  node: Pick<CommandNode, "name" | "timeoutSec" | "command" | "script" | "outcomeRules"> & Pick<RepositoryNode, "probe" | "probeRules" | "mergedCheck" | "mergedCheckRules">;
  outputs: (outcome: string) => [Output, OutputRule][];
  nodeDir: string;
  sidecars?: Readonly<Record<string, string>> | undefined;
  params: Record<string, unknown>;
  user: string;
  workdir: string;
  context: Omit<PlaceholderContext, "params" | "workdir">;
  inputs: CommandInput[];
  inlineScript?: string;
  remote?: boolean;
  repeatCheck?: boolean;
  extraEnv?: Record<string, string>;
  onStart?: (pgid: number, user: string) => void;
  stopping?: () => boolean;
  effect?: { requested(hash: string): void; done(ok: boolean, result: unknown): void };
};

export type CommandOutcome<Output extends string = ArtifactType> =
  | { kind: "completed"; outcome: string; outputs: { type: Output; content: string }[]; log: string; fromProbe: boolean }
  | { kind: "failed"; reason: FailureReason; log: string }
  | { kind: "waiting"; reason: "network" | "auth"; log: string };

export function outcomeOutputs(node: Pick<CommandNode, "outputs" | "outputRules">): (outcome: string) => [ArtifactType, OutputRule][] {
  return (outcome) => {
    const type: ArtifactType | undefined = node.outputs[outcome];
    const rule: OutputRule | undefined = node.outputRules[outcome];
    return type && rule ? [[type, rule]] : [];
  };
}


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

async function readOutput(type: string, rule: OutputRule, stdout: string, read: (rel: string) => Promise<string>): Promise<string> {
  if ("stdoutLastLine" in rule) return type in artifactTypes && artifactTypes[type as ArtifactType].plain ? lastLine(stdout) : JSON.stringify({ [rule.stdoutLastLine]: lastLine(stdout) });
  if ("stdoutJson" in rule) {
    const value: unknown = readJsonField(stdout, rule.stdoutJson);
    return type in artifactTypes && artifactTypes[type as ArtifactType].plain && typeof value === "string" ? value : JSON.stringify(value ?? null);
  }
  return read(rule.file);
}

async function argvOf(spec: string[] | { script: string } | undefined, inline: string | undefined, source: Pick<CommandRun, "nodeDir" | "sidecars">, label: string, values: Record<string, string>): Promise<string[]> {
  if (Array.isArray(spec)) return substituteArgv(spec, values);
  const file = spec?.script ?? inline;
  if (!file) throw new Error(`${label}: no command`);
  const body: string | undefined = source.sidecars ? source.sidecars[file] : await readFile(join(source.nodeDir, file), "utf8");
  if (body === undefined) throw new Error(`${label}: missing saved script ${file}`);
  return ["/bin/sh", "-c", body, label];
}

function commandInput(inputs: CommandInput[], job: CommandRun["context"]["job"]): string {
  const values: Record<string, unknown> = Object.fromEntries(inputs.map(({ type, content }) => {
    const value: unknown = artifactTypes[type].plain ? content : JSON.parse(content);
    return [type, value];
  }));
  return JSON.stringify(job ? { ...values, job: { title: job.title, request: job.request } } : values);
}

export function commandHash(argv: string[]): string {
  return createHash("sha256").update(JSON.stringify(argv)).digest("hex");
}

function repositoryWait(stderr: string): "network" | "auth" | null {
  if (/\bHTTP 401\b|authentication failed|invalid (?:username|token|credentials)|could not read (?:username|password)|permission denied \(publickey\)|expiredtoken/i.test(stderr)) return "auth";
  if (/could not resolve (?:host|hostname|proxy)|failed to connect|error connecting|connection (?:refused|reset|timed out)|network is unreachable|operation timed out|\bHTTP (?:502|503|504)\b/i.test(stderr)) return "network";
  return null;
}

export async function runMergedCheck(c: Pick<CommandRun, "node" | "nodeDir" | "sidecars" | "params" | "context" | "inputs" | "extraEnv">): Promise<ProbeResult> {
  const cwd = await mkdtemp(join(tmpdir(), "pecore-remote-"));
  try {
    const values = placeholderValues({ ...c.context, params: c.params, workdir: cwd });
    const env = { ...(await baseEnv(appUser)), ...placeholderEnv(values), ...c.extraEnv };
    const argv = await argvOf(c.node.mergedCheck, undefined, c, `${c.node.name}-merged`, values);
    return (await runProbe({ argv, user: appUser, cwd, env, input: commandInput(c.inputs, c.context.job), timeoutMs: c.node.timeoutSec * 1000 }, c.node.mergedCheckRules)).result;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export async function runCommandNode<Output extends string = ArtifactType>(c: CommandRun<Output>): Promise<CommandOutcome<Output>> {
  const remote: boolean = c.remote === true;
  const user = remote ? appUser : c.user;
  const temp: string[] = [];
  let cwd = c.workdir;
  try {
    if (remote) {
      cwd = await mkdtemp(join(tmpdir(), "pecore-remote-"));
      temp.push(cwd);
    }
    const input: string = commandInput(c.inputs, c.context.job);
    const values = placeholderValues({ ...c.context, params: c.params, workdir: cwd });
    const env = { ...(await baseEnv(user)), ...(await gitIdentityEnv()), ...placeholderEnv(values), ...c.extraEnv };
    const secrets: string[] = remote
      ? Object.entries(c.extraEnv ?? {}).flatMap(([key, value]) => value && /TOKEN|SECRET|PASSWORD|ACCESS_KEY/.test(key) ? [value] : [])
      : [];
    const redact = (content: string): string => secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), content);
    const timeoutMs = c.node.timeoutSec * 1000;
    let log = "";

    if (c.node.probe || c.repeatCheck) {
      const label: string = `${c.node.name}-probe`;
      const argv: string[] = c.repeatCheck ? ["/bin/sh", "-c", c.inlineScript!, label] : await argvOf(c.node.probe, undefined, c, label, values);
      const p = await runProbe({ argv, user, cwd, env, input, timeoutMs, onStart: (pgid) => c.onStart?.(pgid, user) }, c.node.probeRules);
      env.PECORE_PROBE_STDOUT = p.stdout;
      const check: string = "Repeat check";
      log += `$ ${check}\n${redact(p.stdout + p.stderr)}${check}: ${p.result}\n`;
      if (p.result === "unknown") {
        if (remote && p.code === 127) return { kind: "failed", reason: "COMMAND_NOT_FOUND", log };
        if (remote && (/\bHTTP (?:403|404)\b|repository not found|access denied|not permitted/i.test(p.stderr) || p.code === 126)) return { kind: "failed", reason: "HARNESS_ERROR", log };
        return { kind: "waiting", reason: remote ? repositoryWait(p.stderr) ?? "network" : "network", log };
      }
      if (p.result === "done") {
        const outcome = pickOutcome(c.node.outcomeRules, { code: 0, stdout: p.stdout });
        if (outcome === null) return { kind: "failed", reason: "HARNESS_ERROR", log: log + `no outcome rule matched the ${check} output\n` };
        const outputs = [];
        for (const [type, rule] of c.outputs(outcome)) {
          if ("file" in rule) continue;
          outputs.push({ type, content: redact(await readOutput(type, rule, p.stdout, async () => "")) });
        }
        return { kind: "completed", outcome, outputs, log, fromProbe: true };
      }
    }

    if (c.stopping?.()) return { kind: "failed", reason: "PROCESS_KILLED", log };
    const argv: string[] = c.inlineScript === undefined ? await argvOf(c.node.command, c.node.script, c, c.node.name, values) : ["/bin/sh", "-c", c.inlineScript, c.node.name];
    const hash = commandHash(argv);
    if (remote) c.effect?.requested(hash);
    let r: RunResult;
    try {
      r = await run({ user, argv, cwd, env, input, timeoutMs, onStart: (pgid) => c.onStart?.(pgid, user) });
    } catch (e) {
      if (remote) c.effect?.done(false, { error: redact(String(e)) });
      if (e instanceof SpawnError && e.code === "not_found") return { kind: "failed", reason: "COMMAND_NOT_FOUND", log: log + `${argv[0]}: not found\n` };
      throw e;
    }
    log += redact(`$ ${c.inlineScript === undefined ? c.node.script ?? argv.join(" ") : c.node.name}\n${r.stdout}${r.stderr}exit: ${r.code ?? r.signal}\n`);
    if (remote) c.effect?.done(r.code === 0, { code: r.code });
    if (r.timedOut) return { kind: "failed", reason: "TIMEOUT", log };
    if (r.code === null) return { kind: "failed", reason: "PROCESS_KILLED", log };
    if (r.code === 127) return { kind: "failed", reason: "COMMAND_NOT_FOUND", log };
    const wait: "network" | "auth" | null = remote && r.code !== 0 ? repositoryWait(r.stderr) : null;
    if (wait) return { kind: "waiting", reason: wait, log };
    const outcome = pickOutcome(c.node.outcomeRules, r);
    if (outcome === null && remote) return { kind: "waiting", reason: "network", log: log + "no outcome rule matched\n" };
    if (outcome === null) return { kind: "failed", reason: "HARNESS_ERROR", log: log + "no outcome rule matched\n" };
    const outputs = [];
    for (const [type, rule] of c.outputs(outcome)) {
      try {
        outputs.push({ type, content: redact(await readOutput(type, rule, r.stdout, (rel) => (remote ? readFile(join(cwd, rel), "utf8") : readFileAs(c.user, cwd, rel)))) });
      } catch (e) {
        if (e instanceof FsAsError) return { kind: "failed", reason: "HARNESS_ERROR", log: log + `output ${type}: ${e.message}\n` };
        throw e;
      }
    }
    return { kind: "completed", outcome, outputs, log, fromProbe: false };
  } finally {
    for (const d of temp) await rm(d, { recursive: true, force: true });
  }
}
