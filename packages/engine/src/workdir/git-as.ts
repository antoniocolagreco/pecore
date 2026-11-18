import { appUser, baseEnv, run } from "../runners/process";

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

export async function gitApp(repoGit: string, args: string[], opts: Opts = {}): Promise<string> {
  return (await git(appUser, repoGit, [`--git-dir=${repoGit}`], args, opts)).stdout;
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
