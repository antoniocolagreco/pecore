import { execFile, spawn } from "node:child_process";
import { userInfo } from "node:os";
import { PassThrough } from "node:stream";
import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const appUser = userInfo().username;

export type Exit = { code: number | null; signal: string | null };

export type Proc = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pgid: number;
  user: string;
  exited: Promise<Exit>;
  stop(): Promise<void>;
};

export type SpawnParams = { user: string; argv: string[]; env: Record<string, string>; cwd: string };

export class SpawnError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "no_pid" | "other",
  ) {
    super(message);
  }
}

const pidLine = /^PECORE_PID (\d+)$/;
const wrapper = 'cd -- "$1" || exit 126; shift; echo "PECORE_PID $$" >&2; exec env -i "$@"';
const stopGraceMs = 5000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function signalGroup(user: string, pgid: number, signal: "TERM" | "KILL"): Promise<void> {
  if (user === appUser) {
    try {
      process.kill(-pgid, `SIG${signal}`);
    } catch {
      return;
    }
    return;
  }
  await execFileP("sudo", ["-n", "-u", user, "kill", "-s", signal, "--", `-${pgid}`]).catch(() => undefined);
}

async function groupAlive(user: string, pgid: number): Promise<boolean> {
  if (user === appUser) {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }
  return execFileP("sudo", ["-n", "-u", user, "kill", "-0", "--", `-${pgid}`]).then(
    () => true,
    () => false,
  );
}

export async function stopGroup(user: string, pgid: number): Promise<void> {
  await signalGroup(user, pgid, "TERM");
  const end = Date.now() + stopGraceMs;
  while (Date.now() < end && (await groupAlive(user, pgid))) await sleep(100);
  await signalGroup(user, pgid, "KILL");
}

const killJobScript = `for p in /proc/[0-9]*; do
  tr '\\0' '\\n' < "$p/environ" 2>/dev/null | grep -qx "PECORE_JOB_ID=$1" && kill -KILL "\${p#/proc/}" 2>/dev/null
done
exit 0`;

export async function killJobProcesses(user: string, jobId: string): Promise<void> {
  if (process.platform !== "linux") throw new Error("not supported on macOS yet");
  await run({ user, argv: ["/bin/sh", "-c", killJobScript, "sh", jobId], env: await baseEnv(user), cwd: "/", timeoutMs: 30_000 });
}

function makeStop(user: string, pgid: number, exited: Promise<Exit>): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  return () => {
    stopping ??= (async () => {
      await signalGroup(user, pgid, "TERM");
      await Promise.race([exited, sleep(stopGraceMs)]);
      await signalGroup(user, pgid, "KILL");
      await exited;
    })();
    return stopping;
  };
}

export async function spawnAs(p: SpawnParams): Promise<Proc> {
  const sudo = p.user !== appUser;
  const vars = Object.entries(p.env).map(([k, v]) => `${k}=${v}`);
  const [cmd, args, env] = sudo
    ? (["sudo", ["-n", "-H", "-u", p.user, "--", "/usr/bin/setsid", "/bin/sh", "-c", wrapper, "sh", p.cwd, ...vars, ...p.argv], {}] as const)
    : ([p.argv[0]!, p.argv.slice(1), p.env] as const);
  const child = spawn(cmd, args, { cwd: sudo ? "/" : p.cwd, env: env as NodeJS.ProcessEnv, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<Exit>((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const failed = new Promise<never>((_, reject) =>
    child.once("error", (e: NodeJS.ErrnoException) => reject(new SpawnError(e.message, e.code === "ENOENT" ? "not_found" : "other"))),
  );
  if (!sudo) {
    await Promise.race([new Promise<void>((r) => child.once("spawn", () => r())), failed]);
    const pgid = child.pid!;
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, pgid, user: p.user, exited, stop: makeStop(p.user, pgid, exited) };
  }
  const stderr = new PassThrough();
  const pid = await Promise.race([
    failed,
    new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new SpawnError("no pid line within 5 s", "no_pid")), stopGraceMs);
      let first = true;
      const lines = createInterface({ input: child.stderr });
      lines.on("line", (line) => {
        if (!first) return void stderr.write(line + "\n");
        first = false;
        clearTimeout(timer);
        const m = pidLine.exec(line);
        if (m) resolve(Number(m[1]));
        else reject(new SpawnError(`unexpected first stderr line: ${line}`, "no_pid"));
      });
      lines.on("close", () => {
        stderr.end();
        if (first) {
          clearTimeout(timer);
          reject(new SpawnError("sudo exited before the pid line", "no_pid"));
        }
      });
    }),
  ]).catch((e: unknown) => {
    child.kill("SIGKILL");
    throw e;
  });
  return { stdin: child.stdin, stdout: child.stdout, stderr, pgid: pid, user: p.user, exited, stop: makeStop(p.user, pid, exited) };
}

export type RunResult = Exit & { stdout: string; stderr: string; timedOut: boolean };

export type RunParams = SpawnParams & { input?: string | Buffer; timeoutMs?: number; onStart?: (pgid: number) => void };

export async function run(p: RunParams): Promise<RunResult> {
  const proc = await spawnAs(p);
  p.onStart?.(proc.pgid);
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  proc.stdout.on("data", (d: Buffer) => out.push(d));
  proc.stderr.on("data", (d: Buffer) => err.push(typeof d === "string" ? Buffer.from(d) : d));
  proc.stdin.on("error", () => undefined);
  proc.stdin.end(p.input ?? "");
  let timedOut = false;
  const timer = p.timeoutMs === undefined ? null : setTimeout(() => ((timedOut = true), void proc.stop()), p.timeoutMs);
  const exit = await proc.exited;
  if (timer) clearTimeout(timer);
  return { ...exit, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), timedOut };
}

const homes = new Map<string, string>();

async function homeOf(user: string): Promise<string> {
  const cached = homes.get(user);
  if (cached !== undefined) return cached;
  const { stdout } = await execFileP("getent", ["passwd", user]);
  const home = stdout.trim().split(":")[5] ?? "/";
  homes.set(user, home);
  return home;
}

export async function baseEnv(user: string): Promise<Record<string, string>> {
  const lang = process.env.LANG ?? "C.UTF-8";
  if (user === appUser) return { HOME: process.env.HOME ?? (await homeOf(user)), PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: lang };
  return { HOME: await homeOf(user), PATH: "/usr/local/bin:/usr/bin:/bin", LANG: lang };
}
