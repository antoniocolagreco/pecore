import { z } from "zod";
import type { ForgeAccount } from "@pecore/schemas";
import { forgeEnv } from "../runners/forge-env";
import { repoOwnerAndName } from "../runners/placeholders";
import { appUser, baseEnv, run } from "../runners/process";

const checksSchema = z.array(z.object({
  name: z.string(),
  bucket: z.enum(["pass", "fail", "pending", "skipping", "cancel"]),
  link: z.string(),
  description: z.string().optional(),
}));

type Result =
  | { state: "pending" | "passed" }
  | { state: "changed"; head: string }
  | { state: "failed"; report: string };

type Connection = {
  account: ForgeAccount;
  url: string;
  dir: string;
  pullRequest: number;
  timeoutMs: number;
};

async function githubCommands(args: Connection) {
  const { owner, name } = repoOwnerAndName(args.url);
  const repo: string = `${args.account.host}/${owner}/${name}`;
  const env: Record<string, string> = { ...await baseEnv(appUser), ...await forgeEnv(args.account) };
  const deadline: number = Date.now() + args.timeoutMs;
  const read = async (...argv: string[]): Promise<string> => {
    const timeoutMs: number = deadline - Date.now();
    if (timeoutMs <= 0) return "";
    const result = await run({ argv: ["gh", "pr", ...argv, String(args.pullRequest), "--repo", repo], user: appUser, cwd: args.dir, env, timeoutMs });
    return result.timedOut ? "" : result.stdout.trim();
  };
  const head = async (): Promise<string> => read("view", "--json", "headRefOid", "--jq", ".headRefOid");
  return { head, read };
}

export async function githubHead(args: Connection): Promise<string | null> {
  const { head } = await githubCommands(args);
  const sha: string = await head();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

export async function checkGithubCi(args: Connection & { commit: string; checks: string[] }): Promise<Result> {
  const { head, read } = await githubCommands(args);
  const before: string = await head();
  if (!/^[0-9a-f]{40}$/i.test(before)) return { state: "pending" };
  if (before !== args.commit) return { state: "changed", head: before };
  const output: string = await read("checks", "--json", "name,bucket,link,description");
  const after: string = await head();
  if (!/^[0-9a-f]{40}$/i.test(after)) return { state: "pending" };
  if (after !== args.commit) return { state: "changed", head: after };
  const parsed = checksSchema.safeParse(output ? JSON.parse(output) : []);
  if (!parsed.success) return { state: "pending" };
  const checks = parsed.data.filter((check) => args.checks.includes(check.name));
  if (args.checks.some((name) => !checks.some((check) => check.name === name))) return { state: "pending" };
  if (checks.some((check) => check.bucket === "pending")) return { state: "pending" };
  const failed = checks.filter((check) => check.bucket === "fail" || check.bucket === "cancel");
  if (!failed.length) return { state: "passed" };
  const report: string = [`CI failed for commit ${args.commit}`, ...failed.map((check) => `${check.name}: ${check.description || check.bucket}\n${check.link}`)].join("\n");
  return { state: "failed", report };
}
