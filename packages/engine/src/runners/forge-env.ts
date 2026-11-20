import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Account, ForgeAccount } from "@pecore/schemas";

const execFileP = promisify(execFile);

export class ToolAuthError extends Error {
  constructor(readonly account: string, detail: string) {
    super(`login of ${account} is not usable: ${detail}`);
  }
}

export function toolAccounts(
  credentials: string[],
  projectAccount: string | undefined,
  forgeAccount: (id: string) => ForgeAccount | undefined,
): ForgeAccount[] {
  return credentials.map((name) => {
    const id: string | undefined = name === "project.account" ? projectAccount : name;
    const account: ForgeAccount | undefined = id === undefined ? undefined : forgeAccount(id);
    if (!account) throw new Error(`forge account ${id ?? name} not found`);
    return account;
  });
}

async function token(a: ForgeAccount): Promise<string> {
  if (a.tool === "gh") return (await execFileP("gh", ["auth", "token", "--user", a.user, "--hostname", a.host], { timeout: 20_000 })).stdout.trim();
  if (a.tool === "glab") return (await execFileP("glab", ["config", "get", "token", "--host", a.host], { timeout: 20_000 })).stdout.trim();
  return "";
}

export async function identityOk(a: ForgeAccount): Promise<boolean> {
  try {
    if (a.tool === "gh" || a.tool === "glab") return (await token(a)) !== "";
    if (a.tool === "aws") return (await execFileP("aws", ["sts", "get-caller-identity", "--profile", a.user], { timeout: 20_000 })).stdout.includes("Account");
    return true;
  } catch {
    return false;
  }
}

export async function forgeEnv(a: Account): Promise<Record<string, string>> {
  if (a.kind !== "forge") return {};
  const env: Record<string, string> = { GIT_AUTHOR_NAME: a.author.name, GIT_AUTHOR_EMAIL: a.author.email, GIT_COMMITTER_NAME: a.author.name, GIT_COMMITTER_EMAIL: a.author.email };
  if (a.tool === "git") {
    if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
    if (process.env.XDG_CONFIG_HOME) env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
  }
  try {
    if (a.tool === "gh") Object.assign(env, { GH_TOKEN: await token(a), GH_HOST: a.host });
    if (a.tool === "glab") Object.assign(env, { GITLAB_TOKEN: await token(a), GITLAB_HOST: a.host });
    if (a.tool === "aws") env.AWS_PROFILE = a.user;
  } catch (e) {
    throw new ToolAuthError(a.id, (e as Error).message);
  }
  if ((a.tool === "gh" || a.tool === "glab") && !(env.GH_TOKEN || env.GITLAB_TOKEN)) throw new ToolAuthError(a.id, "empty token");
  return env;
}

export function credentialHelper(helper: string): string[] {
  return ["-c", "credential.helper=", "-c", `credential.helper=${helper}`];
}
