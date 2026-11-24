import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Settings } from "@pecore/schemas";
import { z } from "zod";
import { appUser, baseEnv, run } from "../runners/process";
import type { ComposeFile } from "./compose-file";

type ServicesRuntime = Settings["servicesRuntime"];
type ComposeCommand = (args: string[], timeoutMs?: number, input?: string | Buffer) => Promise<string>;

const projectPrefix = "pecore-";
const healthTimeoutMs = 120_000;
const projectList = z.array(z.object({ Name: z.string() }));
const container = z.object({ Service: z.string(), State: z.string(), Health: z.string().nullish(), ExitCode: z.number().optional() });
type Container = z.infer<typeof container>;

export function composeBinary(runtime: NonNullable<ServicesRuntime>): "docker" | "podman" {
  return runtime === "podman" ? "podman" : "docker";
}

async function runtimeEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...(await baseEnv(appUser)), COMPOSE_DISABLE_ENV_FILE: "1" };
  for (const key of ["DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "CONTAINER_HOST", "CONTAINER_CONNECTION"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export async function detectServicesRuntime(): Promise<NonNullable<ServicesRuntime> | null> {
  const env: Record<string, string> = await runtimeEnv();
  const output = async (argv: string[]): Promise<string | null> => {
    const result = await run({ user: appUser, cwd: "/", env, argv, timeoutMs: 10_000 }).catch(() => null);
    return result && result.code === 0 && !result.timedOut ? result.stdout.trim() : null;
  };
  if (await output(["docker", "compose", "version", "--short"]) !== null && await output(["docker", "info", "--format", "{{.ServerVersion}}"])) {
    const context: string = (await output(["docker", "context", "show"]))?.toLowerCase() ?? "";
    return context.includes("orbstack") ? "orbstack" : context.includes("colima") ? "colima" : "docker";
  }
  if (await output(["podman", "info", "--format", "{{.Version.Version}}"])) return "podman";
  return null;
}

export async function withComposeDirectory<T>(
  runtime: ServicesRuntime,
  action: (directory: string, compose: ComposeCommand) => Promise<T>,
): Promise<T> {
  if (process.platform === "darwin") throw new Error("not supported on macOS yet");
  if (runtime === null) throw new Error("Set servicesRuntime before using Compose");
  const binary = composeBinary(runtime);
  const env: Record<string, string> = await runtimeEnv();
  if (runtime === "podman") env.PODMAN_COMPOSE_PROVIDER = "docker-compose";

  const directory = await mkdtemp(join(tmpdir(), "pecore-compose-"));
  try {
    const cwd = join(directory, "project");
    await mkdir(cwd);
    return await action(directory, async (args, timeoutMs = healthTimeoutMs, input) => {
      const result = await run({ user: appUser, cwd, env, argv: [binary, "compose", "--project-directory", cwd, ...args], timeoutMs, ...(input === undefined ? {} : { input }) });
      if (result.timedOut) throw new Error(`${binary} compose timed out`);
      if (result.code !== 0) throw new Error(`${binary} compose ${args.join(" ")} failed: ${result.stderr.trim() || result.code}`);
      return result.stdout;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function composeProjectName(jobId: string): string {
  const name = jobId.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error("Invalid job id for Compose");
  return projectPrefix + name;
}

function parseContainers(stdout: string): Container[] {
  const json = stdout.trim();
  if (!json) return [];
  if (json.startsWith("[")) return z.array(container).parse(JSON.parse(json));
  return json.split("\n").map((line) => container.parse(JSON.parse(line)));
}

async function awaitHealthy(compose: ComposeCommand, file: ComposeFile): Promise<void> {
  const end = Date.now() + healthTimeoutMs;
  while (Date.now() < end) {
    const containers = parseContainers(await compose(["ps", "--all", "--format", "json"], Math.max(1, end - Date.now())));
    const ready = file.services.every((service) => {
      const rows = containers.filter((row) => row.Service === service);
      return rows.length > 0 && rows.every((row) => {
        if (file.completedServices.includes(service)) return row.State === "exited" && row.ExitCode === 0;
        return row.State === "running" && (!row.Health || row.Health === "healthy");
      });
    });
    if (ready) return;
    await sleep(Math.min(1_000, Math.max(0, end - Date.now())));
  }
  throw new Error("Compose services did not become healthy within 120 seconds");
}

export class ServicesRuntimeController {
  constructor(private readonly runtime: ServicesRuntime) {}

  private withJob<T>(jobId: string, file: ComposeFile, action: (compose: ComposeCommand) => Promise<T>): Promise<T> {
    const project = composeProjectName(jobId);
    const bytes: Buffer = Buffer.from(file.bytes);
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Compose copy does not match its confirmed SHA-256");
    return withComposeDirectory(this.runtime, (_directory, compose) =>
      action((args, timeoutMs) => compose(["-p", project, "-f", "-", ...args], timeoutMs, bytes)));
  }

  private async activate(jobId: string, file: ComposeFile, command: "up" | "start"): Promise<void> {
    await this.withJob(jobId, file, async (compose) => {
      if (command === "up") await compose(["pull", "--ignore-pull-failures"], 30 * 60_000);
      await compose(command === "up" ? ["up", "-d"] : ["start"], 5 * 60_000);
      await awaitHealthy(compose, file);
    });
  }

  up(jobId: string, file: ComposeFile): Promise<void> {
    return this.activate(jobId, file, "up");
  }

  stop(jobId: string, file: ComposeFile): Promise<void> {
    return this.withJob(jobId, file, async (compose) => {
      await compose(["stop"]);
    });
  }

  start(jobId: string, file: ComposeFile): Promise<void> {
    return this.activate(jobId, file, "start");
  }

  down(jobId: string, file: ComposeFile): Promise<void> {
    return this.withJob(jobId, file, async (compose) => {
      await compose(["down", "-v"]);
    });
  }

  readPorts(jobId: string, file: ComposeFile): Promise<Record<string, string>> {
    return this.withJob(jobId, file, async (compose) => {
      const env: Record<string, string> = {};
      for (const { service, port, variable } of file.ports) {
        const address = (await compose(["port", "--", service, String(port)])).trim();
        const published = Number(/^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(address)?.[1]);
        if (!(published <= 65535)) throw new Error(`Compose port ${service}:${port} did not return a loopback address`);
        env[variable] = address;
      }
      return env;
    });
  }

  private async forProjects(command: string[], select: (jobId: string) => boolean | Promise<boolean>): Promise<string[]> {
    return withComposeDirectory(this.runtime, async (_directory, compose) => {
      const result = await compose(["ls", "--all", "--filter", `name=${projectPrefix}`, "--format", "json"]);
      const projects = projectList.parse(JSON.parse(result));
      const changed: string[] = [];
      const errors: unknown[] = [];
      for (const { Name: name } of projects) {
        if (!/^pecore-[a-z0-9][a-z0-9_-]*$/.test(name)) continue;
        try {
          if (!(await select(name.slice(projectPrefix.length).toUpperCase()))) continue;
          await compose(["-p", name, ...command]);
          changed.push(name);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `Compose ${command.join(" ")} failed for ${errors.length} projects`);
      return changed;
    });
  }

  sweep(shouldRemove: (jobId: string) => boolean | Promise<boolean>): Promise<string[]> {
    return this.forProjects(["down", "-v"], shouldRemove);
  }

  stopAll(): Promise<string[]> {
    return this.forProjects(["stop"], (): boolean => true);
  }
}
