import { join } from "node:path";
import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { EngineMessage } from "@pecore/schemas";
import type { MainMessage } from "@pecore/schemas";
import { runAdmin } from "./admin";

export type EngineHandle = {
  port: number;
  token: string;
  active(): Promise<number>;
  shutdown(timeoutMs: number): Promise<void>;
};

export type EngineCallbacks = { notify(n: { title: string; body: string; kind: string }): void; exited(code: number): void };

export function startEngine(opts: { home: string; resources: string; version: string; devOrigin: string | null; downloads: string }, cb: EngineCallbacks): Promise<EngineHandle> {
  const child: UtilityProcess = utilityProcess.fork(join(import.meta.dirname, "engine.js"), [], {
    serviceName: "<PE/CORE> engine",
    stdio: "inherit",
    env: {
      ...process.env,
      PECORE_HOME: opts.home,
      PECORE_RESOURCES: opts.resources,
      PECORE_APP_VERSION: opts.version,
      PECORE_DOWNLOADS: opts.downloads,
      ...(opts.devOrigin ? { PECORE_DEV_ORIGIN: opts.devOrigin } : {}),
    },
  });
  const send = (m: MainMessage) => child.postMessage(m);
  const waiters: ((m: EngineMessage) => boolean)[] = [];
  let ready = false;

  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`the engine exited with code ${code} before it was ready`));
      cb.exited(code);
    });
    child.on("message", (data: unknown) => {
      const parsed = EngineMessage.safeParse(data);
      if (!parsed.success) return;
      const m = parsed.data;
      for (const [i, w] of waiters.entries()) if (w(m)) waiters.splice(i, 1);
      if (m.type === "notify") cb.notify(m);
      if (m.type === "admin")
        void runAdmin(m.script).then(
          () => send({ type: "admin.result", id: m.id, ok: true, error: null }),
          (e: unknown) => send({ type: "admin.result", id: m.id, ok: false, error: (e as Error).message }),
        );
      if (m.type === "error") reject(new Error(m.message));
      if (m.type === "ready") {
        ready = true;
        resolve({
          port: m.port,
          token: m.token,
          active: () =>
            new Promise((r) => {
              waiters.push((x) => (x.type === "active" ? (r(x.jobs), true) : false));
              send({ type: "active?" });
            }),
          shutdown: (timeoutMs) =>
            new Promise((r) => {
              const timer = setTimeout(() => {
                child.kill();
                r();
              }, timeoutMs);
              waiters.push((x) => (x.type === "shutdown.done" ? (clearTimeout(timer), r(), true) : false));
              send({ type: "shutdown" });
            }),
        });
      }
    });
  });
}
