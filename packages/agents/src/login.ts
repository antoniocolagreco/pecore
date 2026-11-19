import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { requestTimeoutMs } from "./acp/client";
import { connectorProcess, fill, forPlatform } from "./connectors";
import { openConnection } from "./session";
import type { Login, ResolvedConnector, Spawn } from "./types";

export function prepareLogin({ connector: c, login }: { connector: ResolvedConnector; login: Login }) {
  const loginCommand = forPlatform(c.loginCommand, c.platform);
  if (!loginCommand) throw new Error(`connector ${c.name} has no login command for ${c.platform}`);
  const { env } = connectorProcess(c, login);
  const extra = { home: login.home };
  return {
    files: login.defaultDir ? [] : c.configDirFiles.map((f) => ({ path: join(login.configDir, f.path), content: f.content })),
    before: login.defaultDir ? [] : (forPlatform(c.beforeLogin, c.platform) ?? []).map((cmd) => cmd.map((a) => fill(a, c, extra))),
    command: { argv: loginCommand.map((a) => fill(a, c, extra)), env },
    urlPattern: c.loginUrlPattern ?? "https://\\S+",
    readsCode: c.loginReadsCode,
  };
}

export type LoginState = { state: "logged_in"; email: string; plan?: string } | { state: "logged_out" } | { state: "unknown" };

type ConfigOption = { id: string; category?: string; options?: { value: string }[] };
type SessionOptions = { configOptions?: ConfigOption[]; models?: { availableModels?: unknown } };
type LoginProbeParams = { connector: ResolvedConnector; login: Login; spawn: Spawn };

export async function probeSession(p: LoginProbeParams): Promise<{ state: LoginState; options: ConfigOption[]; models: string[] }> {
  const cwd = join(p.login.configDir, "probe");
  const conn = await openConnection({ connector: p.connector, login: p.login, spawn: p.spawn, cwd });
  try {
    const meta = p.connector.sessionMeta ?? undefined;
    const s: SessionOptions | undefined = await conn.client
      .request<SessionOptions>("session/new", { cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) })
      .catch(() => undefined);
    const a = conn.account();
    const state: LoginState = a ?? { state: "unknown" };
    const availableModels: unknown = s?.models?.availableModels;
    const models: string[] = p.connector.reader === "codex" && Array.isArray(availableModels)
      ? availableModels.flatMap((model: { modelId?: unknown } | null) => typeof model?.modelId === "string" && model.modelId ? [model.modelId] : [])
      : [];
    return { state, options: s?.configOptions ?? [], models };
  } finally {
    conn.client.endInput();
    await Promise.race([conn.client.exited, new Promise((r) => setTimeout(r, 2000))]);
    await conn.client.proc.stop();
  }
}

async function checkLoggedOut(p: LoginProbeParams, command: string[], loggedOutText: string): Promise<LoginState> {
  const { env } = connectorProcess(p.connector, p.login);
  const proc = await p.spawn({ argv: command.map((arg) => fill(arg, p.connector, { home: p.login.home })), env, cwd: join(p.login.configDir, "probe") });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (chunk: Buffer | string) => (stdout += chunk));
  proc.stderr.on("data", (chunk: Buffer | string) => (stderr += chunk));
  proc.stdin.on("error", () => undefined);
  proc.stdin.end();
  const timeout: AbortController = new AbortController();
  try {
    const exit = await Promise.race([proc.exited, delay(requestTimeoutMs, null, { signal: timeout.signal })]);
    if (exit === null) await proc.stop();
    if (exit?.code === 1 && [stdout, stderr].some((output) => output.trim() === loggedOutText)) return { state: "logged_out" };
    return { state: "unknown" };
  } finally {
    timeout.abort();
  }
}

export async function checkLogin(p: LoginProbeParams): Promise<LoginState> {
  const { identityCommand, identityLoggedOutText } = p.connector;
  if (!identityCommand || !identityLoggedOutText) return (await probeSession(p)).state;
  const state: LoginState = await probeSession(p).then((probe) => probe.state, () => ({ state: "unknown" }));
  if (state.state !== "unknown") return state;
  return checkLoggedOut(p, identityCommand, identityLoggedOutText).catch(() => ({ state: "unknown" }));
}
