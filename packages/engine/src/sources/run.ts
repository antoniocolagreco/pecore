import { join } from "node:path";
import { SourceNode } from "@pecore/schemas";
import { blockingImportItem, ensureConfirmed } from "../definitions/confirm";
import type { SourceScope } from "../definitions/confirm";
import type { ProjectContext } from "../graph/executor";
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

export type SourceResult =
  | { kind: "waiting"; reason: "confirmation"; itemId: string }
  | { kind: "completed"; data: unknown; trusted: string[] };

export function sourceScope(ctx: ProjectContext, nodeName: string): SourceScope | undefined {
  const { source, repo, baseBranch } = ctx.project;
  return source?.node === nodeName ? { source, repo, baseBranch } : undefined;
}

export async function runSource(ctx: ProjectContext, request: SourceRequest): Promise<SourceResult> {
  const configured: string | undefined = ctx.project.source?.node;
  const node = configured && ctx.defs.nodes.get(configured);
  const scope: SourceScope | undefined = configured ? sourceScope(ctx, configured) : undefined;
  if (!node || node.kind !== "source" || !scope) throw new Error(`project ${ctx.id} has no source node`);
  const importItem: string | null = blockingImportItem(ctx.db);
  if (importItem !== null) return { kind: "waiting", reason: "confirmation", itemId: importItem };
  const nodeDir: string = join(ctx.dir, "nodes");
  const confirmation = await ensureConfirmed(ctx.db, null, nodeDir, node, scope);
  if (!confirmation.confirmed) return { kind: "waiting", reason: "confirmation", itemId: confirmation.itemId };

  const approved: SourceNode = SourceNode.parse(confirmation.definition);
  const command: SourceNode[SourceRequest["command"]] = approved[request.command];
  const params: Record<string, unknown> = paramsWithDefaults(approved.params, scope.source.params);
  if (request.command === "replies") params.since = new Date(request.since).toISOString();
  const env: Record<string, string> = {};
  for (const account of toolAccounts(approved.credentials, scope.repo?.account, ctx.forgeAccount)) Object.assign(env, await forgeEnv(account));
  const spec: CommandRun<string>["node"] = {
    ...command,
    name: `${approved.name}-${request.command}`,
    runsAs: "engine",
    cleanCheckout: false,
    timeoutSec: approved.timeoutSec,
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
      project: { repoDir: join(ctx.dir, "repo.git"), repoUrl: scope.repo?.url ?? null, baseBranch: scope.baseBranch },
    },
    inputs: [],
    cleanTree: null,
    extraEnv: env,
    scripts: confirmation.scripts,
    comment: "comment" in request ? request.comment : undefined,
  });
  if (result.kind !== "completed") throw new Error(`source ${spec.name} failed: ${result.reason}`);

  const outputs: [string, unknown][] = result.outputs.map(({ type, content }) => [type, JSON.parse(content) as unknown]);
  const data: unknown = outputs.length === 1 ? outputs[0]![1] : Object.fromEntries(outputs);
  const defaultUser: string | undefined = scope.repo ? ctx.forgeAccount(scope.repo.account)?.user : undefined;
  const trusted: unknown = Object.hasOwn(scope.source.params, "trusted") || (Array.isArray(params.trusted) && params.trusted.length > 0)
    ? params.trusted
    : defaultUser === undefined ? [] : [defaultUser];
  return { kind: "completed", data, trusted: Array.isArray(trusted) ? trusted.filter((name): name is string => typeof name === "string") : [] };
}
