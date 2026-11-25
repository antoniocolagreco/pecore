import type { ForgeAccount, RepositoryNode } from "@pecore/schemas";
import type { ProjectContext } from "../graph/executor";
import { loadForgeDefaults } from "../projects/defaults";
import { forgeEnv } from "./forge-env";

export function repositoryAccount(ctx: ProjectContext, node: RepositoryNode): ForgeAccount {
  const id: string | undefined = node.account === "project.account"
    ? ctx.project.repo?.account
    : ctx.project.credentials?.[node.account] ?? node.account;
  const account: ForgeAccount | undefined = id === undefined ? undefined : ctx.forgeAccount(id);
  if (!account) throw new Error(`${node.name}: choose a Git hosting account in Settings → Accounts or in the node editor.`);
  return account;
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
