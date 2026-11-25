import { join } from "node:path";
import { TicketSnapshot } from "@pecore/schemas";
import type { ArtifactType, ForgeAccount, TrackerNode, TrackerProvider } from "@pecore/schemas";
import { activeJiraAccount } from "../accounts/jira";
import type { ProjectContext } from "../graph/executor";
import { withProjectLocation } from "../projects/location";
import { outcomeOutputs, runCommandNode } from "./command";
import type { CommandOutcome, CommandRun } from "./command";
import { forgeEnv } from "./forge-env";
import { appUser } from "./process";

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
): Promise<CommandOutcome<ArtifactType>> {
  const login = await trackerLogin(ctx, node);
  return runCommandNode({
    ...options,
    node: { name: node.name, runsAs: "engine", timeoutSec: node.timeoutSec, outcomeRules: node.outcomeRules },
    outputs: outcomeOutputs(node),
    inlineScript: node.script,
    repeatCheck: node.repeatCheck,
    extraEnv: { ...options.extraEnv, ...(login.forge ? await forgeEnv(login.forge) : { PECORE_JIRA_SITE: login.jiraSite! }) },
  });
}

export async function runChatTracker(
  ctx: ProjectContext,
  action: "read" | "comment",
  ticketId: string,
  comment?: string,
): Promise<TicketSnapshot | null> {
  return withProjectLocation(ctx, async () => {
    const { repo, tracker, baseBranch } = ctx.project;
    const forge = repo ? ctx.forgeAccount(repo.account)?.forge : undefined;
    const jiraTicket: boolean = /^(?:https:\/\/[^/]+\/browse\/)?[A-Z][A-Z0-9]+-\d+$/.test(ticketId);
    const provider: TrackerProvider | undefined = tracker?.provider ?? (jiraTicket ? "jira" : forge === "github" || forge === "gitlab" ? forge : undefined);
    if (!provider) throw new Error("Connect a GitHub or GitLab repository, or configure Jira for this project.");
    const name: string = `${provider}-${action === "read" ? "ticket-read" : "issue-comment"}`;
    const node = ctx.trackerTemplate?.(name);
    if (node?.kind !== "tracker") throw new Error("This project's tracker is unavailable.");
    const result = await runTrackerNode(ctx, node, {
      params: {},
      nodeDir: ctx.defs.nodeDir,
      user: appUser,
      workdir: ctx.dir,
      context: { ticketId, project: { repoDir: join(ctx.dir, "repo.git"), repoUrl: repo?.url ?? null, baseBranch } },
      inputs: comment === undefined ? [] : [{ type: "text", content: comment }],
    });
    if (result.kind !== "completed" || node.failOutcomes.includes(result.outcome)) throw new Error(`Could not ${action === "read" ? "read" : "comment on"} the ticket. Check the account and ticket ID.`);
    return action === "read" ? TicketSnapshot.parse(JSON.parse(result.outputs[0]?.content ?? "null")) : null;
  });
}
