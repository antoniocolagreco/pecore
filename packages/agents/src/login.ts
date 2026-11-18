import { join } from "node:path";
import { connectorProcess, fill, forPlatform } from "./connectors";
import { openConnection } from "./session";
import type { Login, ResolvedConnector, Spawn } from "./types";

export function prepareLogin({ connector: c, login }: { connector: ResolvedConnector; login: Login }) {
  const loginCommand = forPlatform(c.loginCommand, c.platform);
  if (!loginCommand) throw new Error(`connector ${c.name} has no login command for ${c.platform}`);
  const { env } = connectorProcess(c, login);
  const extra = { home: login.home };
  return {
    files: c.configDirFiles.map((f) => ({ path: join(login.configDir, f.path), content: f.content })),
    before: login.defaultDir ? [] : (forPlatform(c.beforeLogin, c.platform) ?? []).map((cmd) => cmd.map((a) => fill(a, c, extra))),
    command: { argv: loginCommand.map((a) => fill(a, c, extra)), env },
    urlPattern: c.loginUrlPattern ?? "https://\\S+",
    readsCode: c.loginReadsCode,
  };
}

export type LoginState = { state: "logged_in"; email: string; plan?: string } | { state: "logged_out" } | { state: "unknown" };

type ConfigOption = { id: string; category?: string; options?: { value: string }[] };

export async function probeSession(p: { connector: ResolvedConnector; login: Login; spawn: Spawn }): Promise<{ state: LoginState; options: ConfigOption[] }> {
  const cwd = join(p.login.configDir, "probe");
  const conn = await openConnection({ connector: p.connector, login: p.login, spawn: p.spawn, cwd });
  try {
    const meta = p.connector.sessionMeta ?? undefined;
    const s = await conn.client
      .request<{ configOptions?: ConfigOption[] }>("session/new", { cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) })
      .catch(() => ({ configOptions: [] as ConfigOption[] }));
    const a = conn.account();
    const state: LoginState = a ?? { state: "unknown" };
    return { state, options: s.configOptions ?? [] };
  } finally {
    conn.client.endInput();
    await Promise.race([conn.client.exited, new Promise((r) => setTimeout(r, 2000))]);
    await conn.client.proc.stop();
  }
}

export async function checkLogin(p: { connector: ResolvedConnector; login: Login; spawn: Spawn }): Promise<LoginState> {
  return (await probeSession(p)).state;
}
