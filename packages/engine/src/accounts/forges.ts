import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import { codeCommitProfile, CommitAuthor, forgeHost, forgeServices, nextForgeAccountId } from "@pecore/schemas";
import type { Accounts, ForgeAccount, ForgeDiscovery } from "@pecore/schemas";
import { readGitAuthor } from "../workdir/git-as";

const exec = promisify(execFile);
type Identity = Pick<ForgeAccount, "forge" | "host" | "user" | "awsProfile">;
const githubStatus = z.object({ hosts: z.record(z.string(), z.array(z.object({
  state: z.string(), login: z.string(), active: z.boolean(),
}))) });
const gitlabStatus = z.object({ hosts: z.array(z.object({
  host: z.string(), state: z.string(), user: z.string().optional(),
})) });

async function tool(command: string, args: string[]): Promise<{ stdout: string; stderr: string; ok: boolean } | null> {
  try {
    const result = await exec(command, args, { cwd: homedir(), timeout: 15_000, env: { ...process.env, NO_COLOR: "1", GH_PROMPT_DISABLED: "1", AWS_CLI_AUTO_PROMPT: "off", AWS_PAGER: "" } });
    return { ...result, ok: true };
  } catch (error) {
    const failed = error as { code?: string | number; stdout?: string; stderr?: string };
    return typeof failed.code === "number" ? { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", ok: false } : null;
  }
}

function json(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

async function githubLogins(host?: string): Promise<Identity[]> {
  const args: string[] = ["auth", "status", ...(host ? ["--hostname", host] : [])];
  const result = await tool("gh", [...args, ...(host ? ["--active"] : []), "--json", "hosts"]);
  if (!result) return [];
  const parsed = githubStatus.safeParse(json(result.stdout));
  if (parsed.success) return Object.entries(parsed.data.hosts).flatMap(([server, entries]) => entries.flatMap(({ state, login, active }): Identity[] =>
    state === "success" && login && (!host || active) ? [{ forge: "github", host: server, user: login }] : []));
  const legacy = await tool("gh", args);
  const status: string = `${legacy?.stdout ?? ""}\n${legacy?.stderr ?? ""}`;
  const matches = host ? status.matchAll(/Logged in to (\S+) account (\S+) \([^\r\n]*\r?\n[ \t]*- Active account: true/g)
    : status.matchAll(/Logged in to (\S+) account (\S+) \(/g);
  return Array.from(matches, ([, server, login]): Identity =>
    ({ forge: "github", host: server!, user: login! }));
}

async function gitlabLogins(host?: string): Promise<Identity[]> {
  const args: string[] = ["auth", "status", ...(host ? ["--hostname", host] : ["--all"])];
  const result = await tool("glab", [...args, "--output", "json"]);
  if (!result) return [];
  const parsed = gitlabStatus.safeParse(json(result.stdout));
  if (parsed.success) return parsed.data.hosts.flatMap(({ state, host: server, user }): Identity[] =>
    state === "success" && user ? [{ forge: "gitlab", host: server, user }] : []);
  const legacy = await tool("glab", host ? args : ["auth", "status"]);
  return Array.from(`${legacy?.stdout ?? ""}\n${legacy?.stderr ?? ""}`.matchAll(/Logged in to (\S+) as (\S+) \(/g), ([, server, user]): Identity =>
    ({ forge: "gitlab", host: server!, user: user! }));
}

export async function forgeLoginUser(account: ForgeAccount): Promise<string | undefined> {
  const found: Identity[] = account.tool === "gh" ? await githubLogins(account.host) : account.tool === "glab" ? await gitlabLogins(account.host) : [];
  return found.find(({ host }) => forgeHost(host) === forgeHost(account.host))?.user;
}

export async function codeCommitIdentity(profile: string): Promise<{ host: string; user: string } | null> {
  const config = await tool("aws", ["configure", "get", "region", "--profile", profile]);
  const region: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || config?.stdout.trim() || "";
  if (!config || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region)) return null;
  const auth = await tool("aws", ["sts", "get-caller-identity", "--profile", profile, "--region", region, "--output", "json"]);
  const parsed = z.object({ Arn: z.string() }).safeParse(auth?.ok ? json(auth.stdout) : undefined);
  const user: string = parsed.success ? parsed.data.Arn.split("/").at(-1)!.replace(/^arn:[^:]+:iam::\d+:/, "") : "";
  return { host: `git-codecommit.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`, user };
}

async function codeCommitLogins(): Promise<Identity[]> {
  const result = await tool("aws", ["configure", "list-profiles"]);
  const profiles: string[] = result?.ok ? result.stdout.split(/\r?\n/).map((profile) => profile.trim()).filter(Boolean) : [];
  const found = await Promise.all(profiles.map(async (profile): Promise<Identity | null> => {
    const identity = await codeCommitIdentity(profile);
    if (!identity?.user) return null;
    const region: string = identity.host.split(".")[1]!;
    const access = await tool("aws", ["codecommit", "list-repositories", "--profile", profile, "--region", region, "--max-items", "1", "--output", "json"]);
    return access?.ok && z.object({ repositories: z.array(z.unknown()) }).safeParse(json(access.stdout)).success
      ? { forge: "codecommit", ...identity, awsProfile: profile } : null;
  }));
  return found.filter((entry): entry is Identity => entry !== null);
}

export async function discoverForgeAccounts(forge?: ForgeDiscovery): Promise<Identity[]> {
  if (forge === "github") return githubLogins();
  if (forge === "gitlab") return gitlabLogins();
  if (forge === "codecommit") return codeCommitLogins();
  return (await Promise.all([githubLogins(), gitlabLogins(), codeCommitLogins()])).flat();
}

export async function newForgeAccounts(current: Accounts, discovered: Identity[]): Promise<ForgeAccount[]> {
  if (!discovered.length) return [];
  const git = await readGitAuthor();
  const author: CommitAuthor = CommitAuthor.safeParse(git).data ?? { name: git.name, email: "" };
  const taken = new Set(current.accounts.map(({ id }) => id));
  const existing: ForgeAccount[] = current.accounts.filter((account) => account.kind === "forge");
  const added: ForgeAccount[] = [];
  for (const identity of discovered) {
    const host: string = forgeHost(identity.host);
    if (!host || [...existing, ...added].some((account) => account.forge === identity.forge && forgeHost(account.host) === host &&
      (identity.forge === "codecommit" ? codeCommitProfile(account) === identity.awsProfile : account.user.toLowerCase() === identity.user.toLowerCase()))) continue;
    const { tool } = forgeServices[identity.forge];
    const id: string = nextForgeAccountId(tool, identity.awsProfile ?? identity.user, taken);
    added.push({ id, kind: "forge", ...identity, host, tool, author });
    taken.add(id);
  }
  return added;
}
