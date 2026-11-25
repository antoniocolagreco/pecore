import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { ServiceAccount } from "@pecore/schemas";
import { appUser, baseEnv } from "../runners/process";

const exec = promisify(execFile);

export async function activeJiraAccount(): Promise<{ account: ServiceAccount; site: string } | null> {
  try {
    const { stdout } = await exec("acli", ["jira", "auth", "status"], { env: await baseEnv(appUser), timeout: 10_000 });
    const site: string | undefined = /\bSite:\s*(?:https?:\/\/)?([\w.-]+)/i.exec(stdout)?.[1]?.toLowerCase();
    const email: string | undefined = /\bEmail:\s*([^\s]+@[^\s]+)/i.exec(stdout)?.[1]?.toLowerCase();
    if (!site || !email) return null;
    const id: string = `jira-${createHash("sha256").update(`${site}\n${email}`).digest("hex").slice(0, 16)}`;
    return { site, account: { id, kind: "service", service: "Jira", tool: "acli", user: email } };
  } catch {
    return null;
  }
}
