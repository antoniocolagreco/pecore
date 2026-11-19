import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useNavigate } from "react-router";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { Button, dateTime, ui } from "../components/ui";

export function Notifications() {
  const navigate = useNavigate();
  const [seen, setSeen] = useState<string | null>(null);
  const list = useData(() => call("listNotifications"), [], (m) => m.type === "notify" || m.type === "job.updated");
  const items = list.data ?? [];
  const unread = seen === null ? 0 : items.filter((n) => n.id > seen).length;
  return (
    <Popover.Root onOpenChange={(open) => open && setSeen(items[0]?.id ?? "")}>
      <Popover.Trigger render={<Button aria-label="Notifications">🔔{unread > 0 ? ` ${unread}` : ""}</Button>} />
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup className={ui.panel} style={{ width: 380, maxHeight: 460, overflow: "auto" }}>
            {items.length === 0 ? <div className={ui.empty}>No notifications</div> : null}
            {items.map((n) => (
              <div
                key={n.id}
                style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", cursor: n.target?.job ? "pointer" : "default" }}
                onClick={() => n.target?.job && navigate(`/jobs/${n.target.job}`)}
              >
                <div className={ui.row} style={{ justifyContent: "space-between" }}>
                  <strong>{n.title}</strong>
                  <span className={ui.muted}>{dateTime(n.createdAt)}</span>
                </div>
                <div className={ui.muted}>{n.body}</div>
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
