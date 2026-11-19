import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ProjectId } from "@pecore/schemas";
import type { CreationView, CreateProjectBody, ForgeAccount, QueueItemView } from "@pecore/schemas";
import { call } from "../api/client";
import { errorText, useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { ConfirmItem } from "../components/ConfirmItem";
import { reasonLabel } from "../components/states";
import { Button, Empty, ErrorText, Field, Page, Panel, ui } from "../components/ui";

type RepoMode = "existing" | "new" | "local";
type Inputs = { id: string; name: string; mode: RepoMode; url: string; account: string; baseBranch: string; recipes: string[] };

const recipes: string[] = ["feature", "bugfix", "local-only"];
const initialInputs: Inputs = { id: "", name: "", mode: "local", url: "", account: "", baseBranch: "main", recipes };
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
    <Page title="New project · Confirm">
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
      {items.length > 0 && <p className={ui.muted}>Skip leaves open confirmations in the Inbox.</p>}
    </Page>
  );
}

function CreationTasks({ creation, pending }: { creation: CreationView | undefined; pending: boolean }) {
  const finished: number = creation?.step ?? 0;
  const report: string | null | undefined = creation?.error;
  const failedStep: number = Number(/^step (\d):/.exec(report ?? "")?.[1]) || finished + 1;
  return (
    <ol className={ui.stack}>
      {tasks.map((name, index) => {
        const step: number = index + 1;
        const state: string = report && step === failedStep ? "Failed" :
          step <= finished ? "Done" : !report && step === finished + 1 && (pending || creation) ? "In progress" : "Pending";
        const setup: CreationView["setupJob"] | undefined = step === 4 ? creation?.setupJob : null;
        return (
          <li key={name}>
            <strong>{name}</strong> · {state}
            {setup?.waitingReason && <div>{reasonLabel(setup.waitingReason)}</div>}
            {step === 4 && creation?.setupItemId && <Panel><ConfirmItem itemId={creation.setupItemId} /></Panel>}
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
  const createRepo: string | null = inputs.mode === "new" && account ? `${account.forge}-create-repo` : null;
  const defaultRecipe: string | undefined = inputs.recipes[0];
  const valid: boolean = ProjectId.safeParse(inputs.id).success && !!inputs.name.trim() && !!inputs.baseBranch.trim() && !!defaultRecipe &&
    (inputs.mode === "local" || (!!account && !!inputs.url.trim()));
  const update = (changes: Partial<Inputs>) => setInputs((current) => ({ ...current, ...changes }));
  const create = useAction(async () => {
    if (!valid || !defaultRecipe) return;
    const body: CreateProjectBody = {
      project: {
        id: inputs.id,
        name: inputs.name.trim(),
        repo: inputs.mode === "local" ? null : { url: inputs.url.trim(), account: inputs.account },
        baseBranch: inputs.baseBranch.trim(),
        createRepo,
        defaultRecipe,
        services: null,
        limits: { jobs: 2, budget: {} },
        source: null,
      },
      recipes: inputs.recipes,
    };
    try {
      const { id } = await call("createProject", { body });
      setCreationId(id);
    } catch (error) {
      if (/^step [456]:/.test(errorText(error))) setCreationId(inputs.id);
      throw error;
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
      const [view, entries] = await Promise.all([
        call("getProject", { params: { id } }),
        call("listDefinitions", { query: { dir: `projects/${id}/recipes` } }),
      ]);
      const project: typeof view.project = view.project;
      if (!project) throw new Error("Project inputs are unavailable.");
      const selected: string[] = recipes.filter((name) => entries.some(({ path }) => path === `projects/${id}/recipes/${name}.json`));
      await call("cancelCreation", { params: { id } });
      setInputs({
        id,
        name: project.name,
        mode: project.repo === null ? "local" : project.createRepo ? "new" : "existing",
        url: project.repo?.url ?? "",
        account: project.repo?.account ?? "",
        baseBranch: project.baseBranch,
        recipes: selected,
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
      <Page title="New project · Create">
        <Panel>
          <h2 className={ui.title}>{creationId ?? inputs.id}</h2>
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
    <Page title="New project · Inputs">
      <Panel>
        <form className={ui.stack} onSubmit={(e) => { e.preventDefault(); if (connected && valid) void create.run(); }}>
          <Field label="Project ID">
            <input required pattern="[a-z][a-z0-9\x2d]{0,23}" maxLength={24} title="Up to 24 lowercase letters, digits, or dashes, starting with a letter"
              disabled={!connected} value={inputs.id} onChange={(e) => update({ id: e.target.value })} />
          </Field>
          <Field label="Name">
            <input required disabled={!connected} value={inputs.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <fieldset disabled={!connected}>
            <legend>Repository</legend>
            <div className={ui.row}>
              <label><input type="radio" name="repo-mode" checked={inputs.mode === "existing"} onChange={() => update({ mode: "existing" })} /> Existing repository</label>
              <label><input type="radio" name="repo-mode" checked={inputs.mode === "new"} onChange={() => update({ mode: "new" })} /> New repository</label>
              <label><input type="radio" name="repo-mode" checked={inputs.mode === "local"} onChange={() => update({ mode: "local" })} /> Local only</label>
            </div>
          </fieldset>
          {inputs.mode !== "local" && (
            <>
              <Field label={inputs.mode === "new" ? "New repository URL" : "Repository URL"}>
                <input required disabled={!connected} value={inputs.url} onChange={(e) => update({ url: e.target.value })} />
              </Field>
              <Field label="Forge account">
                <select required disabled={!connected || available.length === 0} value={account?.id ?? ""} onChange={(e) => update({ account: e.target.value })}>
                  <option value="">Select an account</option>
                  {available.map((entry) => <option key={entry.id} value={entry.id}>{entry.id} · {entry.host}</option>)}
                </select>
              </Field>
              <ErrorText error={accounts.error} />
              {accounts.data && available.length === 0 && <div>
                {inputs.mode === "new" ? "Add a GitHub or GitLab account in " : "Add a forge account in "}
                {connected ? <Link to="/settings">Settings</Link> : "Settings"}.
              </div>}
              {createRepo && <div>Repository creation node <code>{createRepo}</code></div>}
            </>
          )}
          <Field label="Base branch">
            <input required disabled={!connected} value={inputs.baseBranch} onChange={(e) => update({ baseBranch: e.target.value })} />
          </Field>
          <fieldset disabled={!connected}>
            <legend>Starting recipes</legend>
            <div className={ui.row}>
              {recipes.map((name) => (
                <label key={name}>
                  <input type="checkbox" checked={inputs.recipes.includes(name)} onChange={(e) => {
                    const selected: string[] = recipes.filter((recipe) => recipe === name ? e.target.checked : inputs.recipes.includes(recipe));
                    update({ recipes: selected });
                  }} />
                  {name}{defaultRecipe === name ? " (default)" : ""}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorText error={create.error} />
          <div className={ui.row}>
            <Button disabled={!connected} onClick={() => void navigate("/projects")}>Cancel</Button>
            <Button kind="primary" type="submit" disabled={!connected || !valid}>Create project</Button>
          </div>
        </form>
      </Panel>
    </Page>
  );
}
