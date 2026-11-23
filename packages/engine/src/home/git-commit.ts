import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const identity = ["-c", "user.name=PeCore", "-c", "user.email=pecore@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"];

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", [...identity, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return stdout;
}
