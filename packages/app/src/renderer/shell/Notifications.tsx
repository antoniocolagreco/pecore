import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { useNavigate } from "react-router";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { dateTime } from "../components/ui";
import { Button } from "../ds/button";
import { EmptyState } from "../ds/feedback";
import { BellIcon } from "../ds/icons";
import s from "./Layout.module.css";

export function Notifications() {
  const navigate = useNavigate();
  const [seen, setSeen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const list = useData(() => call("listNotifications"), [], (m) => m.type === "notify" || m.type === "job.updated");
  const items = list.data ?? [];
  const unread = seen === null ? 0 : items.filter((n) => n.id > seen).length;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSeen(items[0]?.id ?? "");
      }}
    >
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            icon={<>{<BellIcon />}{unread > 0 && <span className={s.unread} />}</>}
            aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
          />
        }
      />
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" style={{ zIndex: 50 }}>
          <Popover.Popup className={s.notifications}>
            <div className={s.notificationsTitle}>Notifications</div>
            {items.length === 0 && <EmptyState icon={<BellIcon size={18} />} title="No notifications">Finished jobs, setup changes and problems show up here.</EmptyState>}
            {items.map((n) => {
              const job = n.target?.job;
              const body = (
                <>
                  <span className={s.notificationHead}>
                    <strong>{n.title}</strong>
                    <span className={s.notificationTime}>{dateTime(n.createdAt)}</span>
                  </span>
                  <span className={s.notificationBody}>{n.body}</span>
                </>
              );
              return job ? (
                <button
                  key={n.id}
                  type="button"
                  className={s.notification}
                  onClick={() => {
                    setOpen(false);
                    void navigate(`/jobs/${job}`);
                  }}
                >
                  {body}
                </button>
              ) : (
                <div key={n.id} className={s.notification}>{body}</div>
              );
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
