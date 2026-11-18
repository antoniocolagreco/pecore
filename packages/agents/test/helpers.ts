import { spawn as nodeSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { Connector } from "@pecore/schemas";
import type { ResolvedConnector, Spawn, SpawnedProcess } from "../src/types";

export const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const fakeAgent = fileURLToPath(new URL("./fake-agent/agent.mjs", import.meta.url));

type Line = { dir: string; msg?: Record<string, unknown>; line?: string };

export function readFixture(path: string): Line[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
}

export function replaySpawn(lines: Line[]): Spawn {
  return async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let resolveExit!: (v: { code: number | null; signal: string | null }) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => (resolveExit = r));
    let pos = 0;
    const finish = () => {
      stdout.end();
      stderr.end();
      setTimeout(() => resolveExit({ code: 0, signal: null }), 10);
    };
    let buf = "";
    stdin.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl)) as Record<string, unknown>;
        buf = buf.slice(nl + 1);
        const isResponse = msg.method === undefined;
        while (pos < lines.length) {
          const l = lines[pos++]!;
          if (l.dir !== "out") continue;
          const m = l.msg!;
          if ((isResponse && m.method === undefined) || m.method === msg.method) {
            const fixtureId = m.id;
            while (pos < lines.length && lines[pos]!.dir !== "out") {
              const inl = lines[pos++]!;
              if (inl.dir === "err") stderr.write(inl.line + "\n");
              else if (inl.dir === "in") {
                const out = { ...inl.msg! };
                if (out.method === undefined && out.id === fixtureId && !isResponse) out.id = msg.id;
                stdout.write(JSON.stringify(out) + "\n");
              }
            }
            break;
          }
        }
        if (pos >= lines.length) setTimeout(finish, 20);
      }
    });
    stdin.on("finish", finish);
    const proc: SpawnedProcess = { stdin, stdout, stderr, pgid: 1, exited, stop: async () => finish() };
    return proc;
  };
}

export const processSpawn =
  (extraEnv: Record<string, string> = {}): Spawn =>
  async (p) => {
    const child = nodeSpawn(p.argv[0]!, p.argv.slice(1), { cwd: p.cwd, env: { PATH: process.env.PATH ?? "", ...p.env, ...extraEnv }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => child.once("close", (code, signal) => r({ code, signal })));
    await new Promise<void>((r, j) => {
      child.once("spawn", () => r());
      child.once("error", j);
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      pgid: child.pid!,
      exited,
      stop: async () => {
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          return;
        }
        await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          return;
        }
      },
    };
  };

export function resolved(overrides: Partial<Connector> = {}): ResolvedConnector {
  const c = Connector.parse({
    name: "test",
    title: "Test",
    kind: "native",
    harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" },
    command: ["{harnessPath}", fakeAgent],
    reader: "claude-code",
    sessionConfig: [],
    ...overrides,
  });
  return { ...c, harnessPath: process.execPath, nodePath: process.execPath, adaptersDir: "/nonexistent", adapters: {}, platform: "linux" };
}

export const login = { account: "claude", osUser: "me", configDir: "/tmp/pecore-config", defaultDir: true, home: "/tmp" };
