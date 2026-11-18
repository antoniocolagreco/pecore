import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const identity = ["-c", "user.name=PeCore", "-c", "user.email=pecore@localhost", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false"];

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", [...identity, ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return stdout;
}

export type DefinitionAction = "created" | "edited" | "deleted";

export function commitMessage(kind: string, name: string, action: DefinitionAction): string {
  return `${kind} ${name}: ${action}`;
}

export async function commitDefinition(repoDir: string, paths: string[], message: string): Promise<boolean> {
  await git(repoDir, ["add", "-A", "--", ...paths]);
  const staged = await git(repoDir, ["diff", "--cached", "--name-only", "--", ...paths]);
  if (staged.trim() === "") return false;
  await git(repoDir, ["commit", "-q", "-m", message, "--", ...paths]);
  return true;
}
