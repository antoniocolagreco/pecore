import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { appName, freeProjectManager, projectIdCandidate } from "@pecore/schemas";
import type { CreationView, CreateProjectBody, ForgeAccount, ProjectManagerIdentity } from "@pecore/schemas";
import { ProjectManagerField, projectManagerError } from "../components/ProjectManager";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { reasonLabel } from "../components/states";
import { Button, ErrorText, Page, Panel, ui } from "../components/ui";
import { RadioGroup } from "../ds/choice";
import { Alert, Badge, Card, Spinner } from "../ds/feedback";
import type { Tone } from "../ds/feedback";
import { TextField } from "../ds/field";
import { AlertIcon, CheckIcon } from "../ds/icons";
import { Select } from "../ds/select";
import w from "./NewProjectWizard.module.css";

type RepoMode = "existing" | "new" | "local";
type Inputs = { name: string; mode: RepoMode; url: string | null; account: string; folder: string | null; baseBranch: string; pm: ProjectManagerIdentity | null };

const initialInputs: Inputs = { name: "", mode: "local", url: null, account: "", folder: null, baseBranch: "main", pm: null };
const customProjectManager: ProjectManagerIdentity = { name: "", color: "#808080" };
const formWidth: number = 680;
const folderIn = (root: string, id: string): string => `${root.replace(/\/+$/, "")}/${id}`;
const tasks: string[] = [
  "Validate project inputs",
  "Check project user",
  "Create project directory, settings, and database",
  "Set up repository",
  "Configure repo.git, check home permissions, and commit definitions",
  "Grant project access in protected mode",
];

function CreationTasks({ creation, pending }: { creation: CreationView | undefined; pending: boolean }) {
  const finished: number = creation?.step ?? 0;
  const report: string | null | undefined = creation?.error;
  const failedStep: number = Number(/^step (\d):/.exec(report ?? "")?.[1]) || finished + 1;
  return (
    <ol className={w.steps}>
      {tasks.map((name, index) => {
        const step: number = index + 1;
        const state: string = report && step === failedStep ? "Failed" :
          step <= finished ? "Done" : !report && step === finished + 1 && (pending || creation) ? "In progress" : "Pending";
        const setup: CreationView["setupJob"] | undefined = step === 4 ? creation?.setupJob : null;
        const tone: Tone = state === "Done" ? "success" : state === "Failed" ? "danger" : state === "In progress" ? "accent" : "neutral";
        return (
          <li key={name} className={w.step} data-state={state}>
            <Badge tone={tone} iconOnly>
              {state === "Done" ? <CheckIcon bold /> : state === "Failed" ? <AlertIcon /> : state === "In progress" ? <Spinner /> : step}
            </Badge>
            <span className={w.stepBody}>
              <span className={w.stepName}>{name}</span>
              <span className={w.stepState}>{state}</span>
              {setup?.waitingReason && <span className={ui.muted}>{reasonLabel(setup.waitingReason)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function NewProjectWizard() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const resume: string | null = params.get("resume");
  const connected: boolean = useConnected();
  const [inputs, setInputs] = useState<Inputs>(initialInputs);
  const [creationId, setCreationId] = useState<string | null>(resume);
  const [restoring, setRestoring] = useState<boolean>(resume !== null);
  const accounts = useData(() => call("getAccounts"), [], (m) => m.type === "login.progress" && m.done);
  const settings = useData(() => call("getSettings"), [], (m) => m.type === "definition.changed" && m.path === "settings.json");
  const projectsFolder: string = settings.data?.value.projectsFolder ?? "";
  const creation = useData(
    () => creationId ? call("getCreation", { params: { id: creationId } }) : Promise.resolve(undefined),
    [creationId],
    (m) => !!creationId && (m.type === "project.updated" || m.type === "queue.updated" || m.type === "job.updated") && m.projectId === creationId,
  );
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated");
  const usedManagers: ProjectManagerIdentity[] = (projects.data ?? []).flatMap(({ project }) => project?.pm ? [project.pm] : []);
  const pm: ProjectManagerIdentity = inputs.pm ?? (projects.data ? freeProjectManager(usedManagers) ?? customProjectManager : customProjectManager);
  const forgeAccounts: ForgeAccount[] = (accounts.data?.value.accounts ?? []).filter((account) => account.kind === "forge");
  const available: ForgeAccount[] = forgeAccounts.filter((account) => inputs.mode !== "new" || account.forge === "github" || account.forge === "gitlab");
  const account: ForgeAccount | undefined = available.find((entry) => entry.id === inputs.account);
  const privateGit: boolean = account?.forge === "git";
  const newRepoUnavailable: boolean = forgeAccounts.length > 0 && !forgeAccounts.some((entry) => entry.forge === "github" || entry.forge === "gitlab");
  const createRepo: string | null = inputs.mode === "new" && account ? `${account.forge}-create-repo` : null;
  const suggestedUrl: string = createRepo && account && inputs.name.trim()
    ? `https://${account.host}/${account.user}/${projectIdCandidate(inputs.name.trim(), 1)}.git`
    : "";
  const repoUrl: string = inputs.url ?? suggestedUrl;
  const folder: string = inputs.folder ?? (projectsFolder && folderIn(projectsFolder, projectIdCandidate(inputs.name.trim(), 1)));
  const valid: boolean = !!inputs.name.trim() && !!inputs.baseBranch.trim() && !!folder.trim() && !!projects.data && projectManagerError(pm, usedManagers) === null &&
    (inputs.mode === "local" || (!!account && !!repoUrl.trim()));
  const update = (changes: Partial<Inputs>) => setInputs((current) => ({ ...current, ...changes }));
  const create = useAction(async () => {
    if (!valid) return;
    const name: string = inputs.name.trim();
    const taken: Set<string> = new Set((await call("listProjects")).map(({ id }) => id));
    const body: CreateProjectBody = {
      project: {
        id: projectIdCandidate(name, 1),
        name,
        repo: inputs.mode === "local" ? null : { url: repoUrl.trim(), account: inputs.account },
        folder: null,
        baseBranch: inputs.baseBranch.trim(),
        createRepo,
        services: null,
        pm: { name: pm.name.trim(), color: pm.color },
        source: null,
      },
    };
    for (let index: number = 1; ; index++) {
      const candidate: string = projectIdCandidate(name, index);
      if (taken.has(candidate)) continue;
      body.project.id = candidate;
      body.project.folder = inputs.folder?.trim() ?? folderIn(projectsFolder, candidate);
      try {
        const { id } = await call("createProject", { body });
        setCreationId(id);
        return;
      } catch (error) {
        const message: string = errorText(error);
        if (message === `step 1: project ${candidate} already exists`) continue;
        if (/^step [456]:/.test(message)) setCreationId(candidate);
        throw error;
      }
    }
  });
  const retry = useAction(async (id: string) => {
    try {
      await call("retryCreation", { params: { id } });
      create.clear();
    } finally {
      creation.reload();
    }
  });
  const cancel = useAction(async (id: string) => {
    if (restoring) {
      const view = await call("getProject", { params: { id } });
      const project: typeof view.project = view.project;
      if (!project) throw new Error("Project inputs are unavailable.");
      await call("cancelCreation", { params: { id } });
      setInputs({
        name: project.name,
        mode: project.repo === null ? "local" : project.createRepo ? "new" : "existing",
        url: project.repo?.url ?? null,
        account: project.repo?.account ?? "",
        folder: project.folder,
        baseBranch: project.baseBranch,
        pm: project.pm,
      });
      setRestoring(false);
      void navigate("/projects/new", { replace: true });
    } else {
      await call("cancelCreation", { params: { id } });
    }
    setCreationId(null);
    create.clear();
    retry.clear();
  });

  if (creationId && creation.data?.step === 6 && !creation.data.error && !cancel.busy && !retry.busy) {
    return <Navigate to={`/projects/${creationId}`} replace />;
  }
  if (creationId || create.busy) {
    const busy: boolean = create.busy || retry.busy || cancel.busy;
    return (
      <Page title="New project" width={formWidth}>
        <Panel>
          <h2 className={w.creating}>Creating {creationId ?? inputs.name.trim()}</h2>
          <CreationTasks creation={creationId ? creation.data : undefined} pending={create.busy} />
          <ErrorText error={creation.data?.error ?? creation.error ?? create.error} />
          <ErrorText error={retry.error ?? cancel.error} />
          <p>A repository created on the forge is left there when you cancel.</p>
          <div className={ui.row}>
            <Button disabled={!connected || busy || !creationId || !creation.data} onClick={() => creationId && void cancel.run(creationId)}>Cancel</Button>
            {creation.data?.error && <Button kind="primary" disabled={!connected || busy || !creationId} onClick={() => creationId && void retry.run(creationId)}>Retry</Button>}
            {creation.error && <Button disabled={!connected || busy} onClick={() => void navigate("/projects")}>Back to projects</Button>}
          </div>
        </Panel>
      </Page>
    );
  }

  return (
    <Page title="New project" width={formWidth}>
      <Card padded>
        <form className={w.form} onSubmit={(e) => { e.preventDefault(); if (connected && valid) void create.run(); }}>
          <TextField label="Name" required disabled={!connected} value={inputs.name} placeholder="e.g. Space game" autoFocus
            onValueChange={(name) => update({ name })} />
          <RadioGroup
            label="Repository"
            value={inputs.mode}
            disabled={!connected}
            onValueChange={(mode) => update({ mode: mode as RepoMode, url: null })}
            options={[
              { value: "local", label: "Local only", detail: `${appName} keeps the repository on this computer.` },
              { value: "existing", label: "Existing repository", detail: privateGit ? "Jobs push branches to your Git server." : "Jobs push branches and open pull requests there." },
              { value: "new", label: "New repository", disabled: newRepoUnavailable, detail: `${appName} creates a private repository on GitHub or GitLab.` },
            ]}
          />
          {inputs.mode !== "local" && (
            <div className={w.indent}>
              <Select
                label="Forge account"
                disabled={!connected || available.length === 0}
                value={account?.id ?? null}
                onValueChange={(id) => update({ account: id ?? "", url: null })}
                options={available.map((entry) => ({ value: entry.id, label: `${entry.id} · ${entry.host}` }))}
                placeholder="Select an account"
              />
              <TextField label={inputs.mode === "new" ? "New repository URL" : "Repository URL"} required mono disabled={!connected || !account} value={repoUrl}
                placeholder={account ? `https://${account.host}/owner/name.git` : undefined} onValueChange={(url) => update({ url })} />
              <ErrorText error={accounts.error} />
              {accounts.data && available.length === 0 && <Alert tone="warning">
                {inputs.mode === "new" ? "Add a GitHub or GitLab account in " : "Add a forge account in "}
                {connected ? <Link to="/settings">Settings</Link> : "Settings"}.
              </Alert>}
              {createRepo && <span className={ui.muted}>Repository creation node <code>{createRepo}</code></span>}
            </div>
          )}
          <TextField label="Folder" required mono disabled={!connected} value={folder} description="Your copy of the code. Each job's branch is copied here."
            onValueChange={(value) => update({ folder: value })}
            action={<Button disabled={!connected} onClick={() => void window.pecore.pickFolder().then((picked) => picked && update({ folder: picked }))}>Choose…</Button>} />
          <TextField label="Base branch" required mono disabled={!connected} value={inputs.baseBranch} onValueChange={(baseBranch) => update({ baseBranch })} />
          <ProjectManagerField value={pm} used={usedManagers} disabled={!connected} onChange={(next) => update({ pm: next })} />
          <ErrorText error={projects.error ?? create.error} />
          <div className={w.actions}>
            <Button disabled={!connected} onClick={() => void navigate("/projects")}>Cancel</Button>
            <Button kind="primary" type="submit" disabled={!connected || !valid}>Create project</Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
