import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, IconButton } from "../ds/button";
import { Alert, Count } from "../ds/feedback";
import { BellIcon, BookIcon, FactoryIcon, FolderIcon, GearIcon, ListIcon, PauseIcon, PlayIcon, SidebarIcon } from "../ds/icons";
import { ChatPanel } from "../screens/AssistantChat";
import { CommandPalette } from "./CommandPalette";
import { SetupBanner } from "./SetupBanner";
import { SidebarSlot } from "./sidebar";
import s from "./Layout.module.css";

type Badge = "notifications";

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
      { to: "/", label: "Factory", icon: <FactoryIcon size="md" /> },
      { to: "/projects", label: "Projects", icon: <FolderIcon size="md" /> },
      { to: "/jobs", label: "Jobs", icon: <ListIcon size="md" /> },
      { to: "/notifications", label: "Notifications", icon: <BellIcon size="md" />, badge: "notifications" },
      { to: "/library", label: "Library", icon: <BookIcon size="md" /> },
      { to: "/settings", label: "Settings", icon: <GearIcon size="md" /> },
    ],
  },
];

export function Layout() {
  const connected = useConnected();
  const [menu, setMenu] = useState<boolean>(storedMenu);
  const [chatWidth, setChatWidth] = useState<number>();
  const chatDragOffset = useRef<number>(0);
  const toggleMenu = (): void => {
    setMenu(!menu);
    try {
      localStorage.setItem(menuKey, menu ? "closed" : "open");
    } catch {
      return;
    }
  };
  const status = useData(() => call("getStatus"), [], (m) => m.type === "queue.updated" || m.type === "job.updated" || m.type === "notify");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const pause = useAction(() => (status.data?.globalPause ? call("playAll") : call("pauseAll")).then(status.reload));
  const st = status.data;
  const counts: Record<Badge, { value: number; label: string }> = {
    notifications: { value: st?.notifications ?? 0, label: `${st?.notifications ?? 0} new` },
  };

  return (
    <div className={s.shell} data-menu-collapsed={menu ? undefined : ""} style={chatWidth === undefined ? undefined : { "--chat-width": `${chatWidth}px` } as CSSProperties}>
      <nav className={s.sidebar} aria-label="Main" data-collapsed={menu ? undefined : ""}>
        <div className={s.brand}>
          <IconButton label={menu ? "Hide menu" : "Show menu"} aria-expanded={menu} icon={<SidebarIcon />} onClick={toggleMenu} />
          <span className={s.brandName}>&lt;PE/CORE&gt;</span>
        </div>
        {nav.map((g) => (
          <div key={g.group ?? "main"} className={s.group}>
            {g.group && <div className={s.groupTitle}>{g.group}</div>}
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} draggable={false} aria-label={menu ? undefined : i.label} title={menu ? undefined : i.label}
                className={({ isActive }) => [s.link, isActive ? s.active : ""].join(" ")}>
                {i.icon}
                <span className={s.linkLabel}>{i.label}</span>
                {i.badge && counts[i.badge].value > 0 && <span className={s.badge}><Count value={counts[i.badge].value} label={counts[i.badge].label} /></span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div ref={setSlot} className={s.slot} />
      </nav>
      <div className={s.main}>
        <header className={s.toolbar}>
          <CommandPalette />
          <IconButton
            label={st?.globalPause ? "Play all" : "Pause all"}
            className={st?.globalPause ? s.pausedButton : undefined}
            icon={st?.globalPause ? <PlayIcon /> : <PauseIcon />}
            onClick={() => void pause.run()}
            disabled={!connected || pause.busy}
          />
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
      <div
        className={s.chatResize}
        role="separator"
        aria-label="Resize Assistant panel"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          const handle: HTMLDivElement = event.currentTarget;
          const bounds: DOMRect = handle.getBoundingClientRect();
          chatDragOffset.current = event.clientX - (bounds.left + bounds.width / 2);
          handle.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const handle: HTMLDivElement = event.currentTarget;
          if (!handle.hasPointerCapture(event.pointerId)) return;
          const right: number = handle.parentElement!.getBoundingClientRect().right;
          setChatWidth(right - event.clientX + chatDragOffset.current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const handle: HTMLDivElement = event.currentTarget;
          const bounds: DOMRect = handle.getBoundingClientRect();
          const right: number = handle.parentElement!.getBoundingClientRect().right;
          setChatWidth(right - (bounds.left + bounds.width / 2) + (event.key === "ArrowLeft" ? 20 : -20));
        }}
      />
      <ChatPanel />
    </div>
  );
}
