import { join } from "node:path";
import { z } from "zod";
import { projectIdCandidate, ProjectManagerIdentity } from "@pecore/schemas";
import type { ProjectInput } from "@pecore/schemas";
import type { Engine } from "../main";
import { ProjectCreateError, repoHost } from "../projects/create";
import { loadForgeDefaults } from "../projects/defaults";
import { credentialHelper, forgeEnv, identityOk } from "../runners/forge-env";
import { repoOwnerAndName } from "../runners/placeholders";
import { gitAppIn } from "../workdir/git-as";

const requiredText = z.string().trim().min(1);
const remote = { url: requiredText, account: requiredText };
export const ProjectCreation = z.strictObject({
  name: requiredText,
  repository: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("local") }),
    z.strictObject({ mode: z.literal("existing"), ...remote }),
    z.strictObject({ mode: z.literal("new"), ...remote }),
  ]),
  folder: requiredText.optional(),
  baseBranch: requiredText,
  pm: ProjectManagerIdentity.optional().describe("The Project Manager's name and colour. Omit it to assign a default identity."),
});

export const defaultFolder = (engine: Engine, id: string): string => join(engine.global().settings.projectsFolder, id);

type Settings = z.infer<typeof ProjectCreation>;

export async function validateBaseBranch(home: string, baseBranch: string): Promise<void> {
  try {
    const checked: string = await gitAppIn(home, ["check-ref-format", "--branch", baseBranch]);
    if (checked.trim() !== baseBranch) throw new Error("Expected a literal branch name.");
  } catch {
    throw new Error("Enter a valid Git base branch name.");
  }
}

export async function validateProjectCreation(engine: Engine, { name, repository, baseBranch, pm: chosen }: Settings) {
  const home: string = engine.opts.home;
  const pm: ProjectManagerIdentity = engine.projectManagerFor(chosen);
  await validateBaseBranch(home, baseBranch);

  let repo: ProjectInput["repo"] = null;
  let createRepo: string | null = null;
  if (repository.mode !== "local") {
    const { url, account: accountId } = repository;
    const account = engine.global().accounts.accounts.find((entry) => entry.id === accountId);
    if (account?.kind !== "forge") throw new Error(`Forge account ${accountId} not found.`);
    const parsed: URL | null = URL.canParse(url) ? new URL(url) : null;
    const scp: boolean = /^[\w.-]+@[^:/\s]+:[^\s]+$/.test(url);
    if (/\s/.test(url) || (!scp && (!parsed || !["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)
      || parsed.pathname === "/" || parsed.search || parsed.hash || parsed.password || (parsed.protocol !== "ssh:" && parsed.username)))) {
      throw new Error("Enter a Git repository URL without embedded credentials.");
    }
    if (repoHost(url) !== account.host) throw new Error(`Forge account ${accountId} requires a repository on ${account.host}.`);
    const defaults = await loadForgeDefaults(engine.opts.templates, account.forge);
    if (repository.mode === "new") {
      if (!defaults.createRepo) {
        throw new Error("Creating a repository requires a GitHub or GitLab account.");
      }
      const { owner, name: repositoryName } = repoOwnerAndName(url);
      const segments: string[] = [...owner.split("/"), repositoryName];
      if (segments.some((segment) => !/^[a-z0-9_][a-z0-9_.-]*$/i.test(segment)) || (account.forge === "github" && segments.length !== 2)) {
        throw new Error("The new repository URL must include its owner and repository name.");
      }
      if (!(await identityOk(account))) throw new Error(`Sign in again with forge account ${accountId} before creating the repository.`);
      createRepo = "create-repo";
    } else {
      const config: string[] = defaults.credentialHelper === null ? [] : credentialHelper(defaults.credentialHelper);
      try {
        await gitAppIn(home, [...config, "ls-remote", "--exit-code", "--refs", "--", url, `refs/heads/${baseBranch}`], { env: await forgeEnv(account) });
      } catch {
        throw new Error("Could not read the base branch. Check the repository URL, account access and branch name.");
      }
    }
    repo = { url, account: accountId };
  }
  return { name, repo, createRepo, baseBranch, pm };
}

export function projectCreationRows(engine: Engine, { name, repository, folder, baseBranch, pm }: Settings): { label: string; value: string }[] {
  const manager: ProjectManagerIdentity = engine.projectManagerFor(pm);
  return [
    { label: "Name", value: name },
    { label: "Repository", value: { local: "Local only", existing: "Existing repository", new: "New repository" }[repository.mode] },
    ...(repository.mode === "local" ? [] : [
      { label: "Repository URL", value: repository.url },
      { label: "Forge account", value: repository.account },
    ]),
    ...(repository.mode === "new" ? [{ label: "Remote setup", value: `Create a private repository if needed and push ${baseBranch}` }] : []),
    { label: "Folder", value: folder ?? defaultFolder(engine, projectIdCandidate(name, 1)) },
    { label: "Base branch", value: baseBranch },
    { label: "Project Manager", value: `${manager.name} (${manager.color})` },
  ];
}

export async function createApprovedProject(engine: Engine, settings: Settings): Promise<{ project: string; creating: boolean; error?: string }> {
  const { name, repo, createRepo, baseBranch, pm } = await validateProjectCreation(engine, settings);
  for (let index: number = 1; ; index++) {
    const id: string = projectIdCandidate(name, index);
    try {
      await engine.createProject({ id, name, repo, createRepo, baseBranch, pm, folder: settings.folder ?? defaultFolder(engine, id) });
    } catch (error) {
      if (error instanceof ProjectCreateError && error.message === `step 1: project ${id} already exists`) continue;
      if (engine.creating.has(id)) return { project: id, creating: true, error: error instanceof Error ? error.message : String(error) };
      throw error;
    }
    return { project: id, creating: engine.creating.has(id) };
  }
}
