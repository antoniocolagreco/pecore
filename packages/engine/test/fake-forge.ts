import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./tmp";

export type Pr = { number: number; url: string; repo: string; head: string; base: string; title: string; state: "OPEN" | "MERGED" };
export type ForgeState = {
  offline: boolean;
  tokenValid: boolean;
  hang: string | null;
  repos: string[];
  prs: Pr[];
  comments: { issue: string; body: string }[];
  calls: string[];
};

const gh = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const dir = path.join(__dirname, "..");
const file = path.join(dir, "state.json");
const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (s) => fs.writeFileSync(file, JSON.stringify(s, null, 2));
const args = process.argv.slice(2);
const valued = new Set(["--repo", "-R", "--head", "--base", "--json", "--jq", "--title", "--body-file", "--body", "--user", "--hostname"]);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.slice(2).filter((a, i, rest) => !a.startsWith("-") && !valued.has(rest[i - 1]));
const cmd = args[0] === "api" ? "api" : args.slice(0, 2).join(" ");
const s = read();
s.calls.push(args.join(" "));
write(s);
const fail = (msg) => { process.stderr.write(msg + "\n"); process.exit(1); };
const done = (out) => {
  if (out !== undefined) process.stdout.write(out + "\n");
  if (s.hang === cmd) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  process.exit(0);
};
if (cmd === "auth token") { if (!s.tokenValid) fail("no oauth token found for github.com"); done("gho_fake"); }
if (cmd === "auth git-credential") done();
if (s.offline) fail("error connecting to api.github.com");
const repo = flag("--repo") ?? flag("-R");
if (cmd === "pr list") {
  const pr = s.prs.find((p) => p.repo === repo && p.head === flag("--head") && (flag("--base") === undefined || p.base === flag("--base")) && p.state === "OPEN");
  done(pr ? pr.url : undefined);
}
if (cmd === "pr create") {
  const n = s.prs.length + 1;
  const url = "https://github.com/" + repo + "/pull/" + n;
  s.prs.push({ number: n, url, repo, head: flag("--head"), base: flag("--base"), title: flag("--title"), state: "OPEN" });
  write(s);
  done(url);
}
if (cmd === "pr edit") {
  const pr = s.prs.find((p) => p.url === positional[0]);
  if (!pr) fail("no pull request " + positional[0]);
  pr.base = flag("--base");
  write(s);
  done();
}
if (cmd === "pr view") {
  const pr = s.prs.find((p) => p.repo === repo && (p.head === positional[0] || p.url === positional[0]));
  if (!pr) fail("no pull requests found for branch " + positional[0]);
  done(pr.state === "MERGED" ? "MERGED" : undefined);
}
if (cmd === "issue view") done(JSON.stringify(s.comments.filter((c) => c.issue === positional[0]).map((c) => ({ body: c.body }))));
if (cmd === "issue comment") {
  s.comments.push({ issue: positional[0], body: flag("--body") });
  write(s);
  done();
}
if (cmd === "repo view") {
  if (!s.repos.includes(positional[0])) fail("GraphQL: Could not resolve to a Repository with the name '" + positional[0] + "'.");
  done("https://github.com/" + positional[0]);
}
if (cmd === "repo create") {
  s.repos.push(positional[0]);
  write(s);
  execFileSync("git", ["init", "-q", "--bare", path.join(dir, "remotes", positional[0] + ".git")]);
  done("https://github.com/" + positional[0]);
}
if (cmd === "api") {
  const [, owner, name, , branch] = positional[0].split("/");
  try {
    execFileSync("git", ["--git-dir", path.join(dir, "remotes", owner, name + ".git"), "rev-parse", "--verify", "refs/heads/" + branch], { stdio: "ignore" });
  } catch {
    fail("HTTP 404: Not Found");
  }
  done();
}
fail("fake gh: unsupported command " + args.join(" "));
`;

const gitWrapper = (realGit: string) => `#!/bin/sh
"${realGit}" "$@"
rc=$?
for a; do
  if [ "$a" = push ] && grep -q '"hang": "git push"' "$(dirname "$0")/../state.json"; then exec sleep 100000; fi
done
exit $rc
`;

export class FakeForge {
  private constructor(readonly dir: string) {}

  static async start(): Promise<FakeForge> {
    const dir = await tempDir();
    const f = new FakeForge(dir);
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    for (const d of ["bin", "remotes", "home"]) await mkdir(join(dir, d));
    await writeFile(join(dir, "bin", "gh"), gh);
    await writeFile(join(dir, "bin", "git"), gitWrapper(realGit));
    await chmod(join(dir, "bin", "gh"), 0o755);
    await chmod(join(dir, "bin", "git"), 0o755);
    await f.write({ offline: false, tokenValid: true, hang: null, repos: [], prs: [], comments: [], calls: [] });
    await writeFile(
      join(dir, "home", ".gitconfig"),
      `[user]\n\tname = Test\n\temail = test@example.com\n[url "${join(dir, "remotes")}/"]\n\tinsteadOf = https://github.com/\n`,
    );
    process.env.PATH = `${join(dir, "bin")}:${process.env.PATH}`;
    process.env.HOME = join(dir, "home");
    return f;
  }

  async state(): Promise<ForgeState> {
    return JSON.parse(await readFile(join(this.dir, "state.json"), "utf8")) as ForgeState;
  }

  async write(s: ForgeState): Promise<void> {
    await writeFile(join(this.dir, "state.json"), JSON.stringify(s, null, 2));
  }

  async set(patch: Partial<ForgeState>): Promise<void> {
    await this.write({ ...(await this.state()), ...patch });
  }

  remote(repo: string): string {
    return join(this.dir, "remotes", `${repo}.git`);
  }

  async createRepo(repo: string, branch = "main"): Promise<string> {
    const remote = this.remote(repo);
    execFileSync("git", ["init", "-q", "--bare", "-b", branch, remote]);
    const tree = execFileSync("git", ["--git-dir", remote, "mktree"], { input: "", encoding: "utf8" }).trim();
    const commit = execFileSync("git", ["--git-dir", remote, "commit-tree", tree, "-m", "Initial commit"], { encoding: "utf8" }).trim();
    execFileSync("git", ["--git-dir", remote, "update-ref", `refs/heads/${branch}`, commit]);
    await this.set({ repos: [...(await this.state()).repos, repo] });
    return commit;
  }

  remoteHead(repo: string, branch: string): string | null {
    try {
      return execFileSync("git", ["--git-dir", this.remote(repo), "rev-parse", "--verify", `refs/heads/${branch}`], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  }

  async merge(url: string): Promise<void> {
    const s = await this.state();
    await this.write({ ...s, prs: s.prs.map((p) => (p.url === url ? { ...p, state: "MERGED" } : p)) });
  }
}

export const forgeAccount = { id: "gh-test", kind: "forge", forge: "github", host: "github.com", tool: "gh", user: "tester", author: { name: "Test", email: "test@example.com" } } as const;
