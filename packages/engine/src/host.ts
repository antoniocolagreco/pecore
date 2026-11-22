import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MainMessage } from "@pecore/schemas";
import type { EngineMessage } from "@pecore/schemas";
import { handlers } from "./api/handlers";
import { startApi } from "./api/server";
import type { ApiServer } from "./api/server";
import { homePaths, syncAdapters } from "./home/layout";
import { Engine } from "./main";

export type HostPort = {
  postMessage(message: EngineMessage): void;
  on(event: "message", listener: (e: { data: unknown }) => void): void;
};

export type HostEnv = { home: string; resources: string; version: string; devOrigin?: string | undefined; downloads?: string | undefined };

export async function host(port: HostPort, env: HostEnv): Promise<{ engine: Engine; api: ApiServer } | null> {
  const pendingAdmin = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  let engine: Engine | null = null;
  let api: ApiServer | null = null;
  let stopping = false;

  port.on("message", (e) => {
    const parsed = MainMessage.safeParse(e.data);
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.type === "admin.result") {
      const p = pendingAdmin.get(m.id);
      pendingAdmin.delete(m.id);
      if (m.ok) p?.resolve();
      else p?.reject(new Error(m.error ?? "the admin prompt failed"));
    }
    if (m.type === "active?") {
      const jobs = engine ? [...engine.projects.values()].reduce((n, { executor }) => n + executor.jobs().filter((j) => j.state === "running" || j.state === "waiting").length, 0) : 0;
      port.postMessage({ type: "active", jobs });
    }
    if (m.type === "shutdown" && !stopping) {
      stopping = true;
      void (async () => {
        const chats = engine?.stopAgentChats();
        await api?.close().catch((err: unknown) => console.error("api close:", err));
        await chats?.catch((err: unknown) => console.error("agent chats close:", err));
        await engine?.shutdown().catch((err: unknown) => console.error("engine shutdown:", err));
        port.postMessage({ type: "shutdown.done" });
      })();
    }
  });

  const admin = (script: string) =>
    new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      pendingAdmin.set(id, { resolve, reject });
      port.postMessage({ type: "admin", id, script });
    });

  try {
    await mkdir(env.home, { recursive: true, mode: 0o700 });
    const pinned = JSON.parse(await readFile(join(env.resources, "adapters.json"), "utf8")) as { adapters: Record<string, { version: string; entry: string }> };
    await syncAdapters(env.home, { source: join(env.resources, "adapters"), appVersion: env.version, pinned: Object.entries(pinned.adapters).map(([name, a]) => `${name}@${a.version}`) });
    engine = await Engine.start({
      home: env.home,
      library: join(env.resources, "library"),
      agents: { connectorsDir: join(env.resources, "connectors"), adaptersDir: homePaths(env.home).adapters, adapters: pinned.adapters },
      admin,
      ...(env.downloads ? { downloads: env.downloads } : {}),
      notify: (n) => port.postMessage({ type: "notify", title: n.title, body: n.body, kind: n.kind }),
    });
    api = await startApi(engine, { handlers: handlers(env.version), origins: ["app://pecore", ...(env.devOrigin ? [env.devOrigin] : [])] });
    port.postMessage({ type: "ready", port: api.port, token: api.token });
    return { engine, api };
  } catch (e) {
    await engine?.shutdown().catch(() => undefined);
    port.postMessage({ type: "error", message: (e as Error).message });
    return null;
  }
}
