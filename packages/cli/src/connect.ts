import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { apiClient } from "@pecore/schemas";
import type { ApiClient } from "@pecore/schemas";

export class NotRunningError extends Error {
  constructor() {
    super("PeCore is not running: open the app");
  }
}

export async function pecoreHome(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.PECORE_HOME) return env.PECORE_HOME;
  const config = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const stored = await readFile(join(config, "PeCore", "home.json"), "utf8").then((t) => (JSON.parse(t) as { home?: string }).home ?? null, () => null);
  return stored ?? join(homedir(), ".pecore");
}

export async function connect(home: string): Promise<ApiClient> {
  const file = await readFile(join(home, "run", "api.json"), "utf8").catch(() => null);
  if (file === null) throw new NotRunningError();
  const { port, token } = JSON.parse(file) as { port: number; token: string };
  const call = apiClient({ port, token });
  try {
    await call("getStatus");
  } catch (e) {
    if (e instanceof TypeError) throw new NotRunningError();
    throw e;
  }
  return call;
}
