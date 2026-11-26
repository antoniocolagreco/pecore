import { join } from "node:path";
import type { ForgeAccount, JobDefinitions, RepositoryNode } from "@pecore/schemas";
import { isForgeOperation } from "@pecore/schemas";
import { loadNodeFile } from "../definitions/load";
import { snapshotNode } from "../definitions/snapshot";
import type { ProjectContext } from "../graph/executor";
import { loadForgeDefaults } from "../projects/defaults";
import { forgeEnv } from "./forge-env";

export function repositoryAccount(ctx: ProjectContext, node: RepositoryNode): ForgeAccount {
  const id: string | undefined = node.account === "project.account" || (!node.script && isForgeOperation(node.name))
    ? ctx.project.repo?.account
    : ctx.project.credentials?.[node.account] ?? node.account;
  const account: ForgeAccount | undefined = id === undefined ? undefined : ctx.forgeAccount(id);
  if (!account) throw new Error(`${node.name}: choose a Git hosting account in Settings → Accounts or in the node editor.`);
  return account;
}

export async function repositoryDefinition(
  ctx: ProjectContext, node: RepositoryNode, account: ForgeAccount, contents?: Readonly<Record<string, string>>,
): Promise<JobDefinitions["nodes"][string] & { definition: RepositoryNode }> {
  if (!isForgeOperation(node.name) || node.script) {
    return snapshotNode({ ...node, account: account.id }, ctx.defs.nodeDir, contents);
  }
  const forge = await loadForgeDefaults(ctx.templates, account.forge);
  const implementation: string | null = node.name === "open-pr" ? forge.delivery : forge.createRepo;
  if (!implementation) throw new Error("This Git hosting provider requires an existing repository.");
  const dir: string = join(ctx.templates, "forges", "nodes");
  const { value } = await loadNodeFile(join(dir, implementation + ".json"));
  if (value?.kind !== "repository" || !value.script) throw new Error("This operation is unavailable for the project's Git hosting provider.");
  return snapshotNode({ ...value, name: node.name, description: node.description, account: account.id }, dir);
}

export async function repositoryEnv(ctx: ProjectContext, account: ForgeAccount): Promise<Record<string, string>> {
  const { credentialHelper } = await loadForgeDefaults(ctx.templates, account.forge);
  const settings: [string, string][] = [["core.hooksPath", "/dev/null"], ["core.fsmonitor", "false"]];
  if (credentialHelper) settings.push(["credential.helper", ""], ["credential.helper", credentialHelper]);
  return {
    ...await forgeEnv(account),
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(settings.length),
    ...Object.fromEntries(settings.flatMap(([key, value], index) => [[`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]])),
  };
}
