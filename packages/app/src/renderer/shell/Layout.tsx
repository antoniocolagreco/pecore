import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { NewJobModal } from "../components/NewJobModal";
import { Button, IconButton } from "../ds/button";
import { Alert, Count } from "../ds/feedback";
import { BookIcon, ChartIcon, ChatIcon, FactoryIcon, FolderIcon, GearIcon, InboxIcon, ListIcon, PauseIcon, PlayIcon, PlusIcon, SparkIcon } from "../ds/icons";
import { Select } from "../ds/select";
import { CommandPalette } from "./CommandPalette";
import { useProjectFilter } from "./filter";
import { Notifications } from "./Notifications";
import { SetupBanner } from "./SetupBanner";
import { SidebarSlot } from "./sidebar";
import s from "./Layout.module.css";

type Badge = "inbox" | "orchestrator";

const nav: { group: string | null; items: { to: string; label: string; icon: ReactNode; badge?: Badge }[] }[] = [
  {
    group: null,
    items: [
      { to: "/orchestrator", label: "Orchestrator", icon: <ChatIcon />, badge: "orchestrator" },
      { to: "/inbox", label: "Inbox", icon: <InboxIcon />, badge: "inbox" },
      { to: "/", label: "Factory", icon: <FactoryIcon /> },
      { to: "/jobs", label: "Jobs", icon: <ListIcon /> },
      { to: "/projects", label: "Projects", icon: <FolderIcon /> },
      { to: "/library", label: "Library", icon: <BookIcon /> },
      { to: "/usage", label: "Usage", icon: <ChartIcon /> },
      { to: "/settings", label: "Settings", icon: <GearIcon /> },
    ],
  },
];

export function Layout() {
  const connected = useConnected();
  const navigate = useNavigate();
  const { project, setProject } = useProjectFilter();
  const status = useData(() => call("getStatus"), [], (m) => m.type === "queue.updated" || m.type === "job.updated");
  const chats = useData(() => call("listChats"), [], (m) => m.type === "chat.message" || m.type === "chat.updated");
  const unread: number = chats.data?.reduce((total, chat) => total + chat.unread, 0) ?? 0;
  const projects = useData(() => call("listProjects"), [], (m) => m.type === "project.updated");
  const [newJob, setNewJob] = useState(false);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const pause = useAction(() => (status.data?.globalPause ? call("playAll") : call("pauseAll")).then(status.reload));
  const st = status.data;
  const counts: Record<Badge, { value: number; label: string }> = {
    inbox: { value: st?.inbox ?? 0, label: `${st?.inbox ?? 0} waiting` },
    orchestrator: { value: unread, label: `${unread} unread` },
  };

  return (
    <div className={s.shell}>
      <nav className={s.sidebar} aria-label="Main">
        <div className={s.brand}>
          <span className={s.mark}><SparkIcon size={14} /></span>
          PeCore
        </div>
        {nav.map((g) => (
          <div key={g.group ?? "main"} className={s.group}>
            {g.group && <div className={s.groupTitle}>{g.group}</div>}
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => [s.link, isActive ? s.active : ""].join(" ")}>
                {i.icon}
                <span className={s.linkLabel}>{i.label}</span>
                {i.badge && <Count value={counts[i.badge].value} label={counts[i.badge].label} />}
              </NavLink>
            ))}
          </div>
        ))}
        <div ref={setSlot} className={s.slot} />
        <div className={s.footer}>
          <div className={s.engine} role="status">
            <span className={s.engineDot} data-off={connected ? undefined : ""} />
            {connected ? "Engine running" : "Disconnected"}
            {st && <span className={s.version}>v{st.version}</span>}
          </div>
        </div>
      </nav>
      <div className={s.main}>
        <header className={s.toolbar}>
          <Select
            className={s.filter}
            ariaLabel="Project filter"
            value={project ?? "all"}
            onValueChange={(v) => setProject(v === "all" || v === null ? null : v)}
            options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.project?.name ?? p.id }))]}
          />
          <div className={s.spacer} />
          <CommandPalette />
          <IconButton
            label={st?.globalPause ? "Play all" : "Pause all"}
            className={st?.globalPause ? s.pausedButton : undefined}
            icon={st?.globalPause ? <PlayIcon /> : <PauseIcon />}
            onClick={() => void pause.run()}
            disabled={!connected || pause.busy}
          />
          <Notifications />
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setNewJob(true)} disabled={!connected}>
            New job
          </Button>
        </header>
        <div className={s.alerts}>
          {!connected && <Alert tone="danger" title="Disconnected from the engine">Reconnecting… Controls are disabled and data may be stale.</Alert>}
          <SetupBanner />
          {st?.globalPause && (
            <Alert tone="warning" title="Global pause is on" actions={<Button size="sm" onClick={() => void pause.run()} disabled={!connected}>Play</Button>}>
              Running jobs hold and queued jobs do not start.
            </Alert>
          )}
          {pause.error && <Alert tone="danger">{pause.error}</Alert>}
          {st && st.homeFindings.length > 0 && (
            <Alert tone="warning" title="Login files can be read by other users">
              {st.homeFindings.map((f) => f.path).join(", ")}
              <pre className={s.fixes}>{st.homeFindings.map((f) => f.fix.join(" ")).join("\n")}</pre>
            </Alert>
          )}
        </div>
        <main className={s.content} aria-disabled={!connected}>
          <SidebarSlot.Provider value={slot}>
            <Outlet />
          </SidebarSlot.Provider>
        </main>
      </div>
      <NewJobModal open={newJob} onClose={() => setNewJob(false)} onCreated={(id) => navigate(`/jobs/${id}`)} />
    </div>
  );
}
