import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { projectIdCandidate } from "@pecore/schemas";
import type { CreationView, CreateProjectBody, ForgeAccount, QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem } from "../components/ConfirmItem";
import { reasonLabel } from "../components/states";
import { Button, Empty, ErrorText, Page, Panel, ui } from "../components/ui";
import { RadioGroup } from "../ds/choice";
import { Alert, Card, Spinner } from "../ds/feedback";
import { TextField } from "../ds/field";
import { AlertIcon, CheckIcon } from "../ds/icons";
import { Select } from "../ds/select";
import w from "./NewProjectWizard.module.css";

type RepoMode = "existing" | "new" | "local";
type Inputs = { name: string; mode: RepoMode; url: string; account: string; folder: string | null; baseBranch: string };

const initialInputs: Inputs = { name: "", mode: "local", url: "", account: "", folder: null, baseBranch: "main" };
const defaultFolder = (id: string): string => `~/Projects/${id}`;
const tasks: string[] = [
  "Validate project inputs",
  "Check project user",
  "Create project directory, settings, and database",
  "Set up repository",
  "Configure repo.git, check home permissions, and commit definitions",
  "Grant project access in protected mode",
];

function ConfirmProject({ id }: { id: string }) {
  const navigate = useNavigate();
  const connected: boolean = useConnected();
  const [page, setPage] = useState<number>(0);
  const queue = useData(() => call("listQueue", { query: { state: "open", project: id } }), [id], (m) => m.type === "queue.updated" && m.projectId === id);
  const items: QueueItemView[] = (queue.data ?? []).filter((item) => item.kind === "engine-node" || item.kind === "source-node");
  const start: number = Math.min(page, Math.max(0, Math.ceil(items.length / 10) - 1)) * 10;
  const finish = () => void navigate(`/projects/${id}`);
  return (
    <Page title="New project: confirm its nodes">
      <ErrorText error={queue.error} />
      {queue.loading && !queue.data && <Empty>Loading confirmations…</Empty>}
      {queue.data && items.length === 0 && <Empty>No open node confirmations</Empty>}
      {items.slice(start, start + 10).map(({ id: itemId }) => (
        <Panel key={itemId}><ConfirmItem itemId={itemId} onDone={queue.reload} /></Panel>
      ))}
      {items.length > 10 && (
        <div className={ui.row}>
          <Button disabled={!connected || start === 0} onClick={() => setPage(start / 10 - 1)}>Previous</Button>
          <Button disabled={!connected || start + 10 >= items.length} onClick={() => setPage(start / 10 + 1)}>Show more</Button>
        </div>
      )}
      <div className={ui.row}>
        <Button disabled={!connected} onClick={() => void navigate("/projects")}>Cancel</Button>
        <Button disabled={!connected} onClick={finish}>Skip</Button>
        <Button kind="primary" disabled={!connected || !queue.data || !!queue.error || items.length > 0} onClick={finish}>Finish</Button>
      </div>
      {items.length > 0 && <p className={ui.muted}>Skip leaves open confirmations in Notifications.</p>}
    </Page>
  );
}
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
        return (
          <li key={name} className={w.step} data-state={state}>
            <span className={w.stepIcon}>
              {state === "Done" ? <CheckIcon bold /> : state === "Failed" ? <AlertIcon /> : state === "In progress" ? <Spinner /> : step}
            </span>
            <span className={w.stepBody}>
              <span className={w.stepName}>{name}</span>
              <span className={w.stepState}>{state}</span>
              {setup?.waitingReason && <span className={ui.muted}>{reasonLabel(setup.waitingReason)}</span>}
              {step === 4 && creation?.setupItemId && <Panel><ConfirmItem itemId={creation.setupItemId} /></Panel>}
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
  const creation = useData(
    () => creationId ? call("getCreation", { params: { id: creationId } }) : Promise.resolve(undefined),
    [creationId],
    (m) => !!creationId && (m.type === "project.updated" || m.type === "queue.updated" || m.type === "job.updated") && m.projectId === creationId,
  );
  const forgeAccounts: ForgeAccount[] = (accounts.data?.value.accounts ?? []).filter((account) => account.kind === "forge");
  const available: ForgeAccount[] = forgeAccounts.filter((account) => inputs.mode !== "new" || account.forge === "github" || account.forge === "gitlab");
  const account: ForgeAccount | undefined = available.find((entry) => entry.id === inputs.account);
  const privateGit: boolean = account?.forge === "git";
  const newRepoUnavailable: boolean = privateGit || (forgeAccounts.length > 0 && forgeAccounts.every((entry) => entry.forge === "git"));
  const createRepo: string | null = inputs.mode === "new" && account ? `${account.forge}-create-repo` : null;
  const folder: string = inputs.folder ?? defaultFolder(projectIdCandidate(inputs.name.trim(), 1));
  const valid: boolean = !!inputs.name.trim() && !!inputs.baseBranch.trim() && !!folder.trim() &&
    (inputs.mode === "local" || (!!account && !!inputs.url.trim()));
  const update = (changes: Partial<Inputs>) => setInputs((current) => ({ ...current, ...changes }));
  const create = useAction(async () => {
    if (!valid) return;
    const name: string = inputs.name.trim();
    const taken: Set<string> = new Set((await call("listProjects")).map(({ id }) => id));
    const body: CreateProjectBody = {
      project: {
        id: projectIdCandidate(name, 1),
        name,
        repo: inputs.mode === "local" ? null : { url: inputs.url.trim(), account: inputs.account },
        folder: null,
        baseBranch: inputs.baseBranch.trim(),
        createRepo,
        defaultRecipe: null,
        services: null,
        source: null,
      },
    };
    for (let index: number = 1; ; index++) {
      const candidate: string = projectIdCandidate(name, index);
      if (taken.has(candidate)) continue;
      body.project.id = candidate;
      body.project.folder = inputs.folder?.trim() ?? defaultFolder(candidate);
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
        url: project.repo?.url ?? "",
        account: project.repo?.account ?? "",
        folder: project.folder,
        baseBranch: project.baseBranch,
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
    return <ConfirmProject id={creationId} />;
  }
  if (creationId || create.busy) {
    const busy: boolean = create.busy || retry.busy || cancel.busy;
    return (
      <Page title="New project">
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
    <Page title="New project">
      <Card padded className={w.card}>
        <form className={w.form} onSubmit={(e) => { e.preventDefault(); if (connected && valid) void create.run(); }}>
          <TextField label="Name" required disabled={!connected} value={inputs.name} placeholder="e.g. Space game" autoFocus
            onValueChange={(name) => update({ name })} />
          <RadioGroup
            label="Repository"
            value={inputs.mode}
            disabled={!connected}
            onValueChange={(mode) => update({ mode: mode as RepoMode })}
            options={[
              { value: "local", label: "Local only", detail: "PeCore keeps the repository on this computer." },
              { value: "existing", label: "Existing repository", detail: privateGit ? "Jobs push branches to your Git server." : "Jobs push branches and open pull requests there." },
              { value: "new", label: "New repository", disabled: newRepoUnavailable, detail: newRepoUnavailable ? "Private Git servers require an existing repository." : "PeCore creates it on GitHub or GitLab." },
            ]}
          />
          {inputs.mode !== "local" && (
            <div className={w.indent}>
              <TextField label={inputs.mode === "new" ? "New repository URL" : "Repository URL"} required mono disabled={!connected} value={inputs.url}
                placeholder={privateGit ? `https://${account!.host}/team/app.git` : "https://github.com/owner/name.git"} onValueChange={(url) => update({ url })} />
              <Select
                label="Forge account"
                disabled={!connected || available.length === 0}
                value={account?.id ?? null}
                onValueChange={(id) => update({ account: id ?? "" })}
                options={available.map((entry) => ({ value: entry.id, label: `${entry.id} · ${entry.host}` }))}
                placeholder="Select an account"
              />
              <ErrorText error={accounts.error} />
              {accounts.data && available.length === 0 && <Alert tone="warning">
                {inputs.mode === "new" ? "Add a GitHub or GitLab account in " : "Add a forge account in "}
                {connected ? <Link to="/settings">Settings</Link> : "Settings"}.
              </Alert>}
              {createRepo && <span className={ui.muted}>Repository creation node <code>{createRepo}</code></span>}
            </div>
          )}
          <div className={w.folder}>
            <TextField label="Folder" required mono disabled={!connected} value={folder} description="Your copy of the code. Each job's branch is copied here."
              onValueChange={(value) => update({ folder: value })} />
            <Button disabled={!connected} onClick={() => void window.pecore.pickFolder().then((picked) => picked && update({ folder: picked }))}>Choose…</Button>
          </div>
          <TextField label="Base branch" required mono disabled={!connected} value={inputs.baseBranch} onValueChange={(baseBranch) => update({ baseBranch })} />
          <ErrorText error={create.error} />
          <div className={w.actions}>
            <Button disabled={!connected} onClick={() => void navigate("/projects")}>Cancel</Button>
            <Button kind="primary" type="submit" disabled={!connected || !valid}>Create project</Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
