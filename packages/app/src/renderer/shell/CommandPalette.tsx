import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import type { JobView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, ErrorText, Modal, ui } from "../components/ui";
import { definitionUrl, object, string } from "../screens/NodeEditor";
import { Kbd } from "../ds/feedback";
import { SearchIcon } from "../ds/icons";
import s from "./CommandPalette.module.css";
import layout from "./Layout.module.css";

const screens: { name: string; path: string }[] = [
  { name: "Factory", path: "/" }, { name: "Jobs", path: "/jobs" }, { name: "Notifications", path: "/notifications" },
  { name: "Projects", path: "/projects" }, { name: "New project", path: "/projects/new" }, { name: "Library", path: "/library" },
  { name: "Usage", path: "/usage" }, { name: "Settings", path: "/settings" },
];

const controls = [
  { label: "Pause", route: "pauseJob", states: ["running", "waiting"], effect: "Finishes the running node, then holds." },
  { label: "Play", route: "playJob", states: ["paused"], effect: "Continues from the next node." },
  { label: "Stop", route: "stopJob", states: ["queued", "running", "waiting", "paused"], effect: "Stops the job and kills its running node." },
  { label: "Resume", route: "resumeJob", states: ["failed", "stopped"], effect: "Restarts the failed or stopped node in the same workdir." },
  { label: "Archive", route: "archiveJob", states: ["succeeded", "not_delivered", "stopped", "failed"], effect: "Hides the job from default lists." },
] as const;

type Control = (typeof controls)[number]["route"];

function PaletteContent({ close }: { close(): void }) {
  const navigate = useNavigate();
  const connected: boolean = useConnected();
  const jobs = useData(() => call("listJobs", { query: {} }), [], (message) => message.type === "job.updated");
  const catalog = useData(async () => {
    const projects = await call("listProjects");
    const scopes: string[] = ["library", ...projects.map(({ id }) => "projects/" + id)];
    const definitions = await Promise.allSettled(scopes.flatMap((scope) => (["node", "recipe"] as const).map(async (kind) => {
      const items = await call("listDefinitions", { query: { dir: scope + "/" + kind + "s" } });
      return items.filter((item) => item.path.endsWith(".json")).map((item) => ({
        path: definitionUrl(kind, item.path), name: string(object(item.value).name) || item.path.split("/").at(-1) || "",
        scope, kind,
      }));
    })));
    return { projects, items: definitions.flatMap((result) => result.status === "fulfilled" ? result.value : []), failed: definitions.some((result) => result.status === "rejected") };
  }, [], (message) => message.type === "project.updated" || message.type === "definition.changed");
  const [selected, select] = useState<JobView>();
  const [highlighted, setHighlighted] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const navigateTo = (path: string): void => { close(); void navigate(path); };
  const action = useAction(async (route: Control) => {
    if (!selected) return;
    await call(route, { params: { id: selected.id } });
    navigateTo("/jobs/" + encodeURIComponent(selected.id));
  });
  const job = jobs.data?.find(({ id }) => selected?.id === id);
  const options = [
    ...screens.map((screen) => ({ ...screen, detail: "Screen", job: undefined })),
    ...(catalog.data?.projects ?? []).map((item) => ({ name: item.project?.name ?? item.id, path: "/projects/" + encodeURIComponent(item.id), detail: "Project", job: undefined })),
    ...(jobs.data ?? []).map((item) => ({ name: item.title, path: "/jobs/" + encodeURIComponent(item.id), detail: "Job · " + item.projectId, job: item })),
    ...(catalog.data?.items ?? []).map((item) => ({ ...item, detail: (item.kind === "node" ? "Node" : "Recipe") + " · " + item.scope, job: undefined })),
  ].filter((item) => (item.name + " " + item.detail).toLowerCase().includes(search.trim().toLowerCase()));
  const start: number = Math.min(offset, Math.max(0, Math.ceil(options.length / 120) - 1) * 120);
  const highlightedJob: JobView | undefined = options.slice(start, start + 120).find((item) => item.path === highlighted)?.job;

  return <Command key={selected ? "actions" : "search"} shouldFilter={false} label="Search PeCore" className={s.command}
    onValueChange={selected ? undefined : setHighlighted}
    onKeyDown={(event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && connected && !selected && highlightedJob) {
        event.preventDefault();
        event.stopPropagation();
        select(highlightedJob);
      }
    }}>
    <ErrorText error={action.error ?? jobs.error ?? catalog.error ?? (catalog.data?.failed ? "Some definitions could not be loaded." : null)} />
    {selected ? <>
      <div className={ui.row}><Button disabled={!connected || action.busy} onClick={() => select(undefined)}>Back</Button><strong>{selected.title}</strong></div>
      <Command.List className={s.results} aria-label="Job actions">
        <Command.Item disabled={!connected || action.busy} onSelect={() => navigateTo("/jobs/" + encodeURIComponent(selected.id))}>Open job</Command.Item>
        {controls.map(({ route, label, states, effect }) => <Command.Item key={route} title={effect}
          disabled={!connected || action.busy || !job || job.archived || !states.some((state) => state === job.state)}
          onSelect={() => void action.run(route)}>{label}</Command.Item>)}
      </Command.List>
    </> : <>
      <Command.Input disabled={!connected} value={search} onValueChange={(value) => { setSearch(value); setOffset(0); }} placeholder="Search jobs, projects, definitions and screens" />
      <Command.List className={s.results} aria-label="Search results">
        <Command.Empty>{jobs.loading || catalog.loading ? "Loading…" : "No matches"}</Command.Empty>
        {start > 0 && <Command.Item value="previous" disabled={!connected} onSelect={() => setOffset(start - 120)}>Previous</Command.Item>}
        {options.slice(start, start + 120).map((item) => <Command.Item value={item.path} key={item.path} disabled={!connected} onSelect={() => navigateTo(item.path)}>
          <span>{item.name}</span><small>{item.detail}</small>
        </Command.Item>)}
        {options.length > start + 120 && <Command.Item value="show-more" disabled={!connected} onSelect={() => setOffset(start + 120)}>Show more</Command.Item>}
      </Command.List>
      {highlightedJob && <div><Button disabled={!connected} onClick={() => select(highlightedJob)} aria-keyshortcuts="Control+Enter Meta+Enter">Job actions <kbd>Ctrl/⌘ Enter</kbd></Button></div>}
    </>}
  </Command>;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const connected: boolean = useConnected();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      if (!connected || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.repeat) return;
      event.preventDefault();
      setOpen((previous) => !previous);
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [connected]);
  return <>
    <button type="button" className={layout.search} disabled={!connected} onClick={() => setOpen(true)} aria-keyshortcuts="Control+k Meta+k">
      <SearchIcon size={14} />
      <span className={layout.searchLabel}>Search</span>
      <Kbd>Ctrl K</Kbd>
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="Command palette">
      {open && <PaletteContent close={() => setOpen(false)} />}
    </Modal>
  </>;
}
