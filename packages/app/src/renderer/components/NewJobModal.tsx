import { useEffect, useState } from "react";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { Button } from "../ds/button";
import { TextArea, TextField } from "../ds/field";
import { ChevronDownIcon } from "../ds/icons";
import { Dialog } from "../ds/overlay";
import { Select } from "../ds/select";
import { useProjectFilter } from "../shell/filter";
import { ErrorText } from "./ui";
import s from "./NewJobModal.module.css";

export function NewJobModal({ open, onClose, onCreated, parentJobId }: { open: boolean; onClose(): void; onCreated(id: string): void; parentJobId?: string }) {
  const { project: filter } = useProjectFilter();
  const projects = useData(() => call("listProjects"), [open]);
  const ready = (projects.data ?? []).filter((p) => p.project && !p.creating);
  const [project, setProject] = useState("");
  const [title, setTitle] = useState("");
  const [recipe, setRecipe] = useState("");
  const [ticket, setTicket] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [parent, setParent] = useState(parentJobId ?? "");
  const [more, setMore] = useState(Boolean(parentJobId));
  const current = ready.find((p) => p.id === project)?.project ?? null;
  const recipes = useData(() => (project ? call("listDefinitions", { query: { dir: `projects/${project}/recipes` } }) : Promise.resolve([])), [project]);
  const jobs = useData(() => (project ? call("listJobs", { query: { project, archived: "false" } }) : Promise.resolve([])), [project]);

  useEffect(() => {
    if (!open) return;
    const first = ready.find((p) => p.id === filter) ?? ready[0];
    if (first && !project) setProject(first.id);
  }, [open, projects.data]);
  useEffect(() => {
    if (current) {
      setRecipe(current.defaultRecipe);
      setBaseBranch(current.baseBranch);
    }
  }, [project, current?.defaultRecipe]);

  const create = useAction(async () => {
    const { id } = await call("createJob", {
      body: {
        project,
        title,
        recipe: recipe || undefined,
        baseBranch: baseBranch || undefined,
        parentJobId: parent || null,
        ticket: { text: ticket, ...(ticketId ? { id: ticketId } : {}) },
      },
    });
    setTitle("");
    setTicket("");
    setTicketId("");
    onClose();
    onCreated(id);
  });
  const recipeNames: string[] = (recipes.data ?? []).map((r) => r.path.split("/").pop()!.replace(/\.json$/, ""));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="New job"
      description="Describe the change; PeCore runs the project's recipe on it."
      width={560}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="new-job" disabled={!project || !title} loading={create.busy}>Create</Button>
      </>}
    >
      <form
        id="new-job"
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (project && title) void create.run();
        }}
      >
        <TextField label="Title" value={title} onValueChange={setTitle} placeholder="e.g. Fix the login redirect" autoFocus required />
        <div className={s.row}>
          <Select label="Project" value={project || null} onValueChange={(v) => setProject(v ?? "")} options={ready.map((p) => ({ value: p.id, label: p.project!.name }))} placeholder="Choose a project" />
          <Select
            label="Recipe"
            value={recipe || null}
            onValueChange={(v) => setRecipe(v ?? "")}
            options={recipeNames.map((name) => ({ value: name, label: name, detail: name === current?.defaultRecipe ? "default" : undefined }))}
            placeholder="Choose a recipe"
          />
        </div>
        <TextArea label="Ticket text" value={ticket} onValueChange={setTicket} placeholder="What should change, and how will you know it works?" />
        <button type="button" className={s.more} aria-expanded={more} onClick={() => setMore(!more)}>
          <ChevronDownIcon size={13} className={s.chevron} data-open={more ? "" : undefined} />
          More options
        </button>
        {more && (
          <div className={s.advanced}>
            <div className={s.row}>
              <TextField label="Ticket reference" value={ticketId} onValueChange={setTicketId} placeholder="e.g. 42" />
              <TextField label="Base branch" value={baseBranch} onValueChange={setBaseBranch} mono />
            </div>
            <Select
              label="Parent job"
              value={parent || "none"}
              onValueChange={(v) => setParent(!v || v === "none" ? "" : v)}
              options={[{ value: "none", label: "None" }, ...(jobs.data ?? []).map((j) => ({ value: j.id, label: j.title }))]}
            />
          </div>
        )}
        <ErrorText error={create.error} />
      </form>
    </Dialog>
  );
}
