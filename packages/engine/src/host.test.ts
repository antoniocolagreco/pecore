import { EventEmitter } from "node:events";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiClient } from "@pecore/schemas";
import type { EngineMessage, MainMessage } from "@pecore/schemas";
import { shippedLibrary, tempDir } from "../test/tmp";
import { until } from "../test/forge-project";
import { host } from "./host";

function fakePort() {
  const fromMain = new EventEmitter();
  const sent: EngineMessage[] = [];
  return {
    sent,
    port: { postMessage: (m: EngineMessage) => sent.push(m), on: (_: "message", fn: (e: { data: unknown }) => void) => fromMain.on("message", fn) },
    send: (m: MainMessage) => fromMain.emit("message", { data: m }),
  };
}

async function resources() {
  const dir = await tempDir();
  await cp(shippedLibrary, join(dir, "library"), { recursive: true });
  await mkdir(join(dir, "connectors"));
  await mkdir(join(dir, "adapters"));
  await writeFile(join(dir, "adapters.json"), JSON.stringify({ adapters: {} }));
  return dir;
}

describe("engine host over parentPort", () => {
  it("creates PECORE_HOME with mode 0700, sends ready with the API port and token, answers active?, and shuts down", async () => {
    const { port, sent, send } = fakePort();
    const home = join(await tempDir(), "home");
    const started = await host(port, { home, resources: await resources(), version: "1.2.3" });
    expect(started).not.toBeNull();
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    const ready = sent.find((m) => m.type === "ready");
    expect(ready).toMatchObject({ type: "ready", port: expect.any(Number), token: expect.any(String) });
    const call = apiClient({ port: started!.api.port, token: started!.api.token });
    expect(await call("getStatus")).toMatchObject({ version: "1.2.3" });
    send({ type: "active?" });
    expect(sent.at(-1)).toEqual({ type: "active", jobs: 0 });
    send({ type: "shutdown" });
    await until(() => sent.some((m) => m.type === "shutdown.done"));
    await expect(stat(join(home, "run", "api.json"))).rejects.toThrow();
  });

  it("routes the admin prompt through the main process and reports its failure", async () => {
    const { port, sent, send } = fakePort();
    const started = await host(port, { home: join(await tempDir(), "home"), resources: await resources(), version: "1" });
    const result = started!.engine.setProtectedMode(false, true).catch((e: Error) => e.message);
    const admin = await until(() => sent.find((m): m is Extract<EngineMessage, { type: "admin" }> => m.type === "admin"));
    expect(admin.script).toContain("pecore-agent");
    send({ type: "admin.result", id: admin.id, ok: false, error: "dismissed" });
    expect(await result).toBe("dismissed");
    expect(started!.engine.global().settings.protectedMode).toBe(false);
    send({ type: "shutdown" });
    await until(() => sent.some((m) => m.type === "shutdown.done"));
  });

  it("sends error when the engine cannot start", async () => {
    const { port, sent } = fakePort();
    const home = join(await tempDir(), "home");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "settings.json"), "{ broken");
    expect(await host(port, { home, resources: await resources(), version: "1" })).toBeNull();
    expect(sent).toEqual([{ type: "error", message: expect.any(String) }]);
  });
});
