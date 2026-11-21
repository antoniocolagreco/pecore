import type { Account, Settings } from "@pecore/schemas";
import { appUser, baseEnv, run, SpawnError } from "../runners/process";
import { composeBinary, withComposeDirectory } from "../services/runtime";

export type PrerequisiteTool = "git" | "sudo" | "setfacl" | "gh" | "glab" | "aws" | "compose";
export type Prerequisite = { tool: PrerequisiteTool; ok: boolean; version: string | null; problem: string | null };
export type PrerequisiteOptions = {
  accounts?: readonly Account[];
  protectedMode?: boolean;
  services?: boolean;
  servicesRuntime?: Settings["servicesRuntime"];
};

function versionFinding(tool: PrerequisiteTool, output: string): Prerequisite {
  const version = /\d+\.\d+(?:\.\d+)?(?:p\d+)?/.exec(output)?.[0] ?? null;
  if (version === null) return { tool, ok: false, version, problem: "Could not read the version" };
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (tool === "gh" && !(major > 2 || (major === 2 && minor >= 40))) {
    return { tool, ok: false, version, problem: "Requires gh 2.40 or later" };
  }
  if (tool === "compose" && major < 2) return { tool, ok: false, version, problem: "Requires Compose v2 or later" };
  return { tool, ok: true, version, problem: null };
}

async function checkTool(tool: Exclude<PrerequisiteTool, "compose">, env: Record<string, string>): Promise<Prerequisite> {
  try {
    const result = await run({ user: appUser, cwd: env.HOME!, env, argv: [tool, "--version"], timeoutMs: 10_000 });
    if (!result.timedOut && result.code === 0) return versionFinding(tool, result.stdout + "\n" + result.stderr);
    const problem = result.timedOut ? "Version check timed out" : (result.stderr.trim() || `Version check exited with ${result.code}`);
    return { tool, ok: false, version: null, problem };
  } catch (error) {
    const problem = error instanceof SpawnError && error.code === "not_found" ? `${tool} was not found on PATH` : String(error);
    return { tool, ok: false, version: null, problem };
  }
}

export async function checkCompose(runtime: Settings["servicesRuntime"]): Promise<Prerequisite> {
  try {
    const output = await withComposeDirectory(runtime, (_directory, compose) => compose(["version", "--short"], 10_000));
    return versionFinding("compose", output);
  } catch (error) {
    const problem = runtime !== null && error instanceof SpawnError && error.code === "not_found"
      ? `${composeBinary(runtime)} was not found on PATH`
      : error instanceof Error ? error.message : String(error);
    return { tool: "compose", ok: false, version: null, problem };
  }
}

export async function checkPrerequisites(options: PrerequisiteOptions = {}): Promise<Prerequisite[]> {
  if (process.platform === "darwin") throw new Error("not supported on macOS yet");
  const tools = new Set<Exclude<PrerequisiteTool, "compose">>(["git"]);
  if (options.protectedMode) {
    tools.add("sudo");
    tools.add("setfacl");
  }
  for (const account of options.accounts ?? []) {
    if (account.kind === "model") continue;
    if (account.tool === "gh" || account.tool === "glab" || account.tool === "aws") tools.add(account.tool);
  }
  const env = await baseEnv(appUser);
  const checks = [...tools].map((tool) => checkTool(tool, env));
  if (options.services) checks.push(checkCompose(options.servicesRuntime ?? null));
  return Promise.all(checks);
}
