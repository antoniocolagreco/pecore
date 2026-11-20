import { useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, IconButton } from "../ds/button";
import { Alert, Count } from "../ds/feedback";
import { BookIcon, ChartIcon, FactoryIcon, FolderIcon, GearIcon, InboxIcon, ListIcon, PauseIcon, PlayIcon, SidebarIcon, SparkIcon } from "../ds/icons";
import { ChatPanel } from "../screens/Orchestrator";
import { CommandPalette } from "./CommandPalette";
import { Notifications } from "./Notifications";
import { SetupBanner } from "./SetupBanner";
import { SidebarSlot } from "./sidebar";
import s from "./Layout.module.css";

type Badge = "inbox";

const menuKey = "pecore.menu";

function storedMenu(): boolean {
  try {
    const value: string | null = localStorage.getItem(menuKey);
    return value === null ? window.innerWidth >= 1280 : value === "open";
  } catch {
    return true;
  }
}

const nav: { group: string | null; items: { to: string; label: string; icon: ReactNode; badge?: Badge }[] }[] = [
  {
    group: null,
    items: [
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
  const [menu, setMenu] = useState<boolean>(storedMenu);
  const [peek, setPeek] = useState<boolean>(false);
  const toggleMenu = (): void => {
    setMenu(!menu);
    setPeek(false);
    try {
      localStorage.setItem(menuKey, menu ? "closed" : "open");
    } catch {
      return;
    }
  };
  const status = useData(() => call("getStatus"), [], (m) => m.type === "queue.updated" || m.type === "job.updated");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const pause = useAction(() => (status.data?.globalPause ? call("playAll") : call("pauseAll")).then(status.reload));
  const st = status.data;
  const counts: Record<Badge, { value: number; label: string }> = {
    inbox: { value: st?.inbox ?? 0, label: `${st?.inbox ?? 0} waiting` },
  };

  return (
    <div className={s.shell}>
      <nav className={s.sidebar} aria-label="Main" hidden={!menu && !peek} data-overlay={!menu && peek ? "" : undefined} onMouseLeave={() => setPeek(false)}>
        <div className={s.brand}>
          <IconButton label={menu ? "Hide menu" : "Keep menu open"} icon={<SidebarIcon />} onClick={toggleMenu} />
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
      </nav>
      <div className={s.main}>
        <header className={s.toolbar}>
          {!menu && <IconButton label="Show menu" icon={<SidebarIcon />} onMouseEnter={() => setPeek(true)} onClick={toggleMenu} />}
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
      <ChatPanel />
    </div>
  );
}
