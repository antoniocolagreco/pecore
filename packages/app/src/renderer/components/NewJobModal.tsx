import { useEffect, useState } from "react";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useProjectFilter } from "../shell/filter";
import { Button, ErrorText, Field, Modal, ui } from "./ui";

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

  return (
    <Modal open={open} onClose={onClose} title="New job">
      <form
        className={ui.stack}
        onSubmit={(e) => {
          e.preventDefault();
          void create.run();
        }}
      >
        <Field label="Title">
          <input required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Project">
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {ready.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project!.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Recipe">
          <select value={recipe} onChange={(e) => setRecipe(e.target.value)}>
            {(recipes.data ?? []).map((r) => {
              const name = r.path.split("/").pop()!.replace(/\.json$/, "");
              return (
                <option key={name} value={name}>
                  {name}
                  {name === current?.defaultRecipe ? " (default)" : ""}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="Ticket text">
          <textarea rows={6} value={ticket} onChange={(e) => setTicket(e.target.value)} />
        </Field>
        <div className={ui.row}>
          <Field label="Ticket reference (optional)">
            <input value={ticketId} onChange={(e) => setTicketId(e.target.value)} placeholder="e.g. 42" />
          </Field>
          <Field label="Base branch">
            <input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
          </Field>
        </div>
        <Field label="Parent job (optional)">
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">None</option>
            {(jobs.data ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText error={create.error} />
        <div className={ui.row} style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" type="submit" disabled={!project || !title || create.busy}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
