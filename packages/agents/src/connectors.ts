import { Connector } from "@pecore/schemas";
import type { ResolvedConnector } from "./types";

export function parseConnector(value: unknown): { connector: Connector | null; errors: string[] } {
  const r = Connector.safeParse(value);
  return r.success ? { connector: r.data, errors: [] } : { connector: null, errors: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}

export function mergeConnectors(builtin: Connector[], user: Connector[]): Map<string, Connector & { overridden: boolean; builtin: boolean }> {
  const out = new Map<string, Connector & { overridden: boolean; builtin: boolean }>();
  for (const c of builtin) out.set(c.name, { ...c, overridden: false, builtin: true });
  for (const c of user) out.set(c.name, { ...c, overridden: out.has(c.name), builtin: false });
  return out;
}

export function forPlatform<T>(value: T | { linux?: T; darwin?: T } | null | undefined, platform: "linux" | "darwin"): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object" && !Array.isArray(value) && ("linux" in value || "darwin" in value)) return (value as { linux?: T; darwin?: T })[platform];
  return value as T;
}

export function fill(text: string, c: ResolvedConnector, extra: Record<string, string> = {}): string {
  return text.replace(/\{([A-Za-z]+(?::[^}]+)?)\}/g, (whole, name: string) => {
    if (name === "harnessPath") return c.harnessPath;
    if (name === "nodePath") return c.nodePath;
    if (name.startsWith("adapter:")) {
      const pkg = name.slice("adapter:".length);
      const a = c.adapters[pkg];
      if (!a) throw new Error(`adapter ${pkg} is not pinned`);
      return `${c.adaptersDir}/${pkg}@${a.version}/node_modules/${pkg}/${a.entry}`;
    }
    if (name in extra) return extra[name]!;
    return whole;
  });
}

export function connectorProcess(c: ResolvedConnector, login: { configDir: string; defaultDir: boolean; home: string }): { argv: string[]; env: Record<string, string> } {
  const extra = { home: login.home };
  const argv = c.command.map((a) => fill(a, c, extra));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.env)) env[k] = fill(v, c, extra);
  if (c.configDirEnv && !login.defaultDir) env[c.configDirEnv] = login.configDir;
  return { argv, env };
}

export function fillSessionValue(value: string, vars: { model: string; effort?: string | null }): string {
  return value.replace("{model}", vars.model).replace("{effort}", vars.effort ?? "");
}
