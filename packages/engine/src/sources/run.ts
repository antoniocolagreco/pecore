import { join } from "node:path";
import type { SourceNode } from "@pecore/schemas";
import type { ProjectContext } from "../graph/executor";
import { withProjectLocation } from "../projects/location";
import { runCommandNode } from "../runners/command";
import type { CommandRun } from "../runners/command";
import { forgeEnv, toolAccounts } from "../runners/forge-env";
import { paramsWithDefaults } from "../runners/placeholders";
import { appUser } from "../runners/process";

export type SourceRequest =
  | { command: "list" }
  | { command: "read"; ticketId: string }
  | { command: "comment"; ticketId: string; comment: string }
  | { command: "replies"; ticketId: string; since: number };

export type SourceResult = { data: unknown; trusted: string[] };

export async function runSource(ctx: ProjectContext, request: SourceRequest): Promise<SourceResult> {
  return withProjectLocation(ctx, () => runSourceAtLocation(ctx, request));
}

async function runSourceAtLocation(ctx: ProjectContext, request: SourceRequest): Promise<SourceResult> {
  const { source, repo, baseBranch } = ctx.project;
  const node = source && ctx.defs.nodes.get(source.node);
  if (node?.kind !== "source" || !source) throw new Error(`project ${ctx.id} has no source node`);
  const nodeDir: string = join(ctx.dir, "nodes");
  const command: SourceNode[SourceRequest["command"]] = node[request.command];
  const params: Record<string, unknown> = paramsWithDefaults(node.params, source.params);
  if (request.command === "replies") params.since = new Date(request.since).toISOString();
  const env: Record<string, string> = {};
  for (const account of toolAccounts(node.credentials, repo?.account, ctx.forgeAccount)) Object.assign(env, await forgeEnv(account));
  const spec: CommandRun<string>["node"] = {
    ...command,
    name: `${node.name}-${request.command}`,
    runsAs: "engine",
    cleanCheckout: false,
    timeoutSec: node.timeoutSec,
    outcomeRules: [{ exitCode: 0, outcome: "ok" }],
    outputRules: request.command !== "comment" && Object.keys(command.outputRules).length === 0 ? { result: { stdoutJson: "" } } : command.outputRules,
  };
  const result = await runCommandNode({
    node: spec,
    nodeDir,
    params,
    user: appUser,
    workdir: ctx.dir,
    context: {
      ticketId: "ticketId" in request ? request.ticketId : null,
      project: { repoDir: join(ctx.dir, "repo.git"), repoUrl: repo?.url ?? null, baseBranch },
    },
    inputs: [],
    cleanTree: null,
    extraEnv: env,
    comment: "comment" in request ? request.comment : undefined,
  });
  if (result.kind !== "completed") throw new Error(`source ${spec.name} failed: ${result.reason}`);

  const outputs: [string, unknown][] = result.outputs.map(({ type, content }) => [type, JSON.parse(content) as unknown]);
  const data: unknown = outputs.length === 1 ? outputs[0]![1] : Object.fromEntries(outputs);
  const defaultUser: string | undefined = repo ? ctx.forgeAccount(repo.account)?.user : undefined;
  const trusted: unknown = Object.hasOwn(source.params, "trusted") || (Array.isArray(params.trusted) && params.trusted.length > 0)
    ? params.trusted
    : defaultUser === undefined ? [] : [defaultUser];
  return { data, trusted: Array.isArray(trusted) ? trusted.filter((name): name is string => typeof name === "string") : [] };
}
