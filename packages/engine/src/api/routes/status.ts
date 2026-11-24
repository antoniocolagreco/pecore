import { NotificationTarget } from "@pecore/schemas";
import type { Engine } from "../../main";
import { NotFoundError } from "../../main";
import { logEvents } from "../../observability/log-events";
import type { LogLine } from "../../observability/logs";
import { checkHome } from "../../osuser/home-check";
import { HttpError } from "../server";
import type { Handlers } from "../server";

export function statusHandlers(engine: Engine, version: string) {
  return {
    getStatus: async () => ({
      version,
      globalPause: engine.globalPause,
      interrupted: engine.interrupted(),
      notifications: engine.notificationCount(),
      homeFindings: (await checkHome().catch(() => [])).map((f) => ({ path: f.path, fix: f.fix })),
    }),
    listNotifications: async () =>
      engine.notifications().map((n) => ({ ...n, target: n.target === null ? null : NotificationTarget.parse(JSON.parse(n.target)) })),
    markNotificationsSeen: async () => {
      engine.markNotificationsSeen();
      return { ok: true as const };
    },
    deleteNotification: async ({ params }) => {
      engine.deleteNotification(params.id);
      return { ok: true as const };
    },
    getLog: async ({ params, query }) => {
      for (const { ctx } of engine.projects.values()) {
        const status: ReturnType<typeof ctx.db.logs.status> = ctx.db.logs.status(params.id);
        if (status === "missing") continue;
        if (status === "unavailable") throw new HttpError("gone", "the attempt log is unavailable");
        const lines: LogLine[] = ctx.db.logs.read(params.id);
        return query.view === "events" ? { view: "events" as const, events: lines.flatMap(logEvents) } : { view: "raw" as const, lines };
      }
      throw new NotFoundError(`attempt ${params.id} not found`);
    },
  } satisfies Partial<Handlers>;
}
