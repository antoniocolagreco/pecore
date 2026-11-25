import type { ArtifactType, ForgeAccount, TrackerNode } from "@pecore/schemas";
import { activeJiraAccount } from "../accounts/jira";
import type { ProjectContext } from "../graph/executor";
import { outcomeOutputs, runCommandNode } from "./command";
import type { CommandOutcome, CommandRun } from "./command";
import { forgeEnv } from "./forge-env";

export async function trackerLogin(ctx: ProjectContext, node: TrackerNode): Promise<{ id: string; forge?: ForgeAccount; jiraSite?: string }> {
  const configured: string | undefined = ctx.project.tracker?.provider === node.provider ? ctx.project.tracker.account : undefined;
  const fallback: string | undefined = configured ?? (node.provider === "jira" ? "active-jira" : ctx.project.repo?.account);
  const choice: string | undefined = node.account === "project.account" ? fallback : node.account;
  const id: string | undefined = choice ? ctx.project.credentials?.[choice] ?? choice : undefined;
  if (node.provider === "jira") {
    const active = await activeJiraAccount();
    if (active && (id === "active-jira" || id === active.account.id)) return { id: active.account.id, jiraSite: active.site };
    throw new Error(`${node.name}: the selected Jira login is unavailable. Use the active Jira login shown in Settings → Accounts.`);
  }
  const forge: ForgeAccount | undefined = id ? ctx.forgeAccount(id) : undefined;
  if (forge?.forge !== node.provider) throw new Error(`${node.name}: choose a matching Git hosting account in Settings → Accounts or in the node editor.`);
  return { id: forge.id, forge };
}

export async function runTrackerNode(
  ctx: ProjectContext,
  node: TrackerNode,
  options: Omit<CommandRun, "node" | "outputs" | "inlineScript" | "repeatCheck">,
  resolved?: Awaited<ReturnType<typeof trackerLogin>>,
): Promise<CommandOutcome<ArtifactType>> {
  const login = resolved ?? await trackerLogin(ctx, node);
  return runCommandNode({
    ...options,
    node: { name: node.name, timeoutSec: node.timeoutSec, outcomeRules: node.outcomeRules },
    remote: true,
    outputs: outcomeOutputs(node),
    inlineScript: node.script,
    repeatCheck: node.repeatCheck,
    extraEnv: { ...options.extraEnv, ...(login.forge ? await forgeEnv(login.forge) : { PECORE_JIRA_SITE: login.jiraSite! }) },
  });
}
