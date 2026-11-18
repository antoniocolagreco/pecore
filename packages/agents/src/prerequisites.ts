import type { ResolvedConnector, Spawn } from "./types";

export function firstSemver(text: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function satisfies(version: string, range: string): boolean {
  return range
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => {
      const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(part);
      if (!m) return false;
      const c = cmp(version, m[2]!);
      switch (m[1] ?? "=") {
        case ">=":
          return c >= 0;
        case "<=":
          return c <= 0;
        case ">":
          return c > 0;
        case "<":
          return c < 0;
        default:
          return c === 0;
      }
    });
}

async function output(spawn: Spawn, argv: string[]): Promise<{ code: number | null; text: string }> {
  const p = await spawn({ argv, env: {}, cwd: "/" });
  let text = "";
  p.stdout.on("data", (d) => (text += d));
  p.stderr.on("data", (d) => (text += d));
  p.stdin.end();
  const exit = await p.exited;
  return { code: exit.code, text };
}

export async function harnessVersion(connector: ResolvedConnector, spawn: Spawn): Promise<string | null> {
  const r = await output(spawn, [connector.harnessPath, ...connector.harness.versionArgs]).catch(() => ({ code: null, text: "" }));
  return r.code === 0 ? firstSemver(r.text) : null;
}

export async function checkPrerequisites({ connector, spawn }: { connector: ResolvedConnector; spawn: Spawn }): Promise<{ ok: boolean; problems: string[]; version: string | null }> {
  const problems: string[] = [];
  const version = await harnessVersion(connector, spawn);
  if (version === null) problems.push(`${connector.harness.program} does not run or prints no version`);
  else if (!satisfies(version, connector.harness.versionRange)) problems.push(`${connector.harness.program} ${version} is outside ${connector.harness.versionRange}`);
  if (connector.kind === "adapter") {
    const node = await output(spawn, [connector.nodePath, "--version"]).catch(() => ({ code: null, text: "" }));
    if (node.code !== 0) problems.push(`the shipped Node at ${connector.nodePath} does not run`);
  }
  return { ok: problems.length === 0, problems, version };
}
