import { appUser, baseEnv, run } from "../runners/process";
import type { CommitAuthor } from "@pecore/schemas";

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
}

const safety = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "user.name=PeCore", "-c", "user.email=pecore@localhost", "-c", "commit.gpgsign=false"];

type Opts = { env?: Record<string, string>; input?: string; allowFail?: boolean };

async function git(user: string, cwd: string, prefix: string[], args: string[], opts: Opts): Promise<{ stdout: string; code: number | null; stderr: string }> {
  const env = { ...(await baseEnv(user)), GIT_TERMINAL_PROMPT: "0", ...opts.env };
  const r = await run({ user, cwd, env, argv: ["git", ...safety, ...prefix, ...args], ...(opts.input !== undefined ? { input: opts.input } : {}) });
  if (r.code !== 0 && !opts.allowFail) throw new GitError(args, r.code, r.stderr);
  return { stdout: r.stdout, code: r.code, stderr: r.stderr };
}

let identity: Promise<Record<string, string>> | undefined;

export async function readGitAuthor(): Promise<CommitAuthor> {
  const env: Record<string, string> = await baseEnv(appUser);
  const value = async (key: string): Promise<string> => {
    const result = await run({ user: appUser, cwd: "/", env, argv: ["git", "config", "--global", "--get", key] }).catch(() => null);
    return result?.code === 0 ? result.stdout.trim() : "";
  };
  const [name, email] = await Promise.all([value("user.name"), value("user.email")]);
  return { name, email };
}

export function gitIdentityEnv(): Promise<Record<string, string>> {
  identity ??= readGitAuthor().then((author) => {
    const name: string = author.name || "PeCore";
    const email: string = author.email || "pecore@localhost";
    return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  });
  return identity;
}

export async function gitApp(repoGit: string, args: string[], opts: Opts = {}): Promise<string> {
  return (await git(appUser, repoGit, [`--git-dir=${repoGit}`], args, opts)).stdout;
}

export async function gitAppIn(cwd: string, args: string[], opts: Opts = {}): Promise<string> {
  return (await git(appUser, cwd, [], args, opts)).stdout;
}

export async function gitAppResult(repoGit: string, args: string[], opts: Opts = {}) {
  return git(appUser, repoGit, [`--git-dir=${repoGit}`], args, { ...opts, allowFail: true });
}

export async function gitWork(user: string, workdir: string, args: string[], opts: Opts = {}): Promise<string> {
  return (await git(user, workdir, [], args, opts)).stdout;
}

export async function gitWorkResult(user: string, workdir: string, args: string[], opts: Opts = {}) {
  return git(user, workdir, [], args, { ...opts, allowFail: true });
}
