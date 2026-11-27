import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codeCommitProfile } from "@pecore/schemas";
import type { Account, ForgeAccount } from "@pecore/schemas";
import { gitIdentityEnv } from "../workdir/git-as";

const execFileP = promisify(execFile);

export class ToolAuthError extends Error {
  constructor(readonly account: string, detail: string) {
    super(`login of ${account} is not usable: ${detail}`);
  }
}

async function token(a: ForgeAccount): Promise<string> {
  if (!a.user) return "";
  if (a.tool === "gh") return (await execFileP("gh", ["auth", "token", "--user", a.user, "--hostname", a.host], { timeout: 20_000 })).stdout.trim();
  if (a.tool === "glab") return (await execFileP("glab", ["config", "get", "token", "--host", a.host], { timeout: 20_000 })).stdout.trim();
  return "";
}

export async function identityOk(a: ForgeAccount): Promise<boolean> {
  try {
    if (a.tool === "gh" || a.tool === "glab") return (await token(a)) !== "";
    if (a.tool === "aws") return (await execFileP("aws", ["sts", "get-caller-identity", "--profile", codeCommitProfile(a), "--output", "json"], { timeout: 20_000 })).stdout.includes("Account");
    return true;
  } catch {
    return false;
  }
}

export async function forgeEnv(a: Account): Promise<Record<string, string>> {
  if (a.kind !== "forge") return {};
  const defaults: Record<string, string> = a.author.name && a.author.email ? {} : await gitIdentityEnv();
  const name: string = a.author.name || defaults.GIT_AUTHOR_NAME!;
  const email: string = a.author.email || defaults.GIT_AUTHOR_EMAIL!;
  const env: Record<string, string> = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  if (process.env.XDG_CONFIG_HOME) env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
  try {
    if (a.tool === "gh") {
      env.GH_TOKEN = await token(a);
      env.GH_ENTERPRISE_TOKEN = env.GH_TOKEN;
      env.GH_HOST = a.host;
    }
    if (a.tool === "glab") Object.assign(env, { GITLAB_TOKEN: await token(a), GITLAB_HOST: a.host });
    if (a.tool === "aws") env.AWS_PROFILE = codeCommitProfile(a);
  } catch (e) {
    throw new ToolAuthError(a.id, (e as Error).message);
  }
  if ((a.tool === "gh" || a.tool === "glab") && !(env.GH_TOKEN || env.GITLAB_TOKEN)) throw new ToolAuthError(a.id, "empty token");
  return env;
}

export function credentialHelper(helper: string): string[] {
  return credentialSettings(helper).flatMap(([key, value]) => ["-c", `${key}=${value}`]);
}

export function credentialSettings(helper: string): [string, string][] {
  const settings: [string, string][] = [["credential.helper", ""], ["credential.helper", helper]];
  if (helper === "!aws codecommit credential-helper $@") settings.push(["credential.useHttpPath", "true"]);
  return settings;
}
