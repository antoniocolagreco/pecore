import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { NewJobModal } from "../components/NewJobModal";
import { Button, ui } from "../components/ui";
import { CommandPalette } from "./CommandPalette";
import { useProjectFilter } from "./filter";
import { Notifications } from "./Notifications";
import { SetupBanner } from "./SetupBanner";
import s from "./Layout.module.css";

const nav: { group: string; items: { to: string; label: string; badge?: "inbox" | "orchestrator" }[] }[] = [
  {
    group: "Workspace",
    items: [
      { to: "/", label: "Factory" },
      { to: "/jobs", label: "Jobs" },
      { to: "/inbox", label: "Inbox", badge: "inbox" },
      { to: "/orchestrator", label: "Orchestrator", badge: "orchestrator" },
      { to: "/projects", label: "Projects" },
      { to: "/usage", label: "Usage" },
    ],
  },
  { group: "Build", items: [{ to: "/library", label: "Library" }] },
  { group: "System", items: [{ to: "/settings", label: "Settings" }] },
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
  const pause = useAction(() => (status.data?.globalPause ? call("playAll") : call("pauseAll")).then(status.reload));
  const st = status.data;

  return (
    <div className={s.shell}>
      <nav className={s.nav} aria-label="Main">
        <div className={s.brand}>PeCore</div>
        {nav.map((g) => (
          <div key={g.group} className={s.group}>
            <div className={s.groupTitle}>{g.group}</div>
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => [s.link, isActive ? s.active : ""].join(" ")}>
                {i.label}
                {i.badge === "inbox" && st && st.inbox > 0 ? <span className={s.badge}>{st.inbox}</span> : null}
                {i.badge === "orchestrator" && unread > 0 ? <span className={s.badge} aria-label={`${unread} unread`}>{unread}</span> : null}
              </NavLink>
            ))}
          </div>
        ))}
        <div className={s.engine}>
          <span style={{ color: connected ? "var(--status-success)" : "var(--status-failed)" }}>●</span> {connected ? "Engine running" : "Disconnected"}
          {st ? <div className={ui.muted}>v{st.version}</div> : null}
          {st && st.homeFindings.length > 0 ? (
            <div className={s.warning} title={st.homeFindings.map((f) => f.fix.join(" ")).join("\n")}>
              Login files readable by others: {st.homeFindings.map((f) => f.path).join(", ")}
              <pre className={ui.mono}>{st.homeFindings.map((f) => f.fix.join(" ")).join("\n")}</pre>
            </div>
          ) : null}
        </div>
      </nav>
      <div className={s.main}>
        <header className={s.top}>
          <select aria-label="Project filter" value={project ?? ""} onChange={(e) => setProject(e.target.value || null)}>
            <option value="">All projects</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.project?.name ?? p.id}
              </option>
            ))}
          </select>
          <Button onClick={() => void pause.run()} disabled={!connected || pause.busy}>
            {st?.globalPause ? "▶ Play all" : "❚❚ Pause all"}
          </Button>
          <Button kind="primary" onClick={() => setNewJob(true)} disabled={!connected}>
            New job
          </Button>
          <div style={{ flex: 1 }} />
          <Notifications />
          <CommandPalette />
        </header>
        {!connected ? <div className={ui.banner}>Disconnected, reconnecting… Controls are disabled and data may be stale.</div> : null}
        <SetupBanner />
        {st?.globalPause ? (
          <div className={ui.banner}>
            Global pause is on: running jobs hold and queued jobs do not start.{" "}
            <Button onClick={() => void pause.run()} disabled={!connected}>
              Play
            </Button>
          </div>
        ) : null}
        {pause.error ? <div className={ui.banner}>{pause.error}</div> : null}
        <main className={s.content} aria-disabled={!connected}>
          <Outlet />
        </main>
      </div>
      <NewJobModal open={newJob} onClose={() => setNewJob(false)} onCreated={(id) => navigate(`/jobs/${id}`)} />
    </div>
  );
}
