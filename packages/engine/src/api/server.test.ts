import { request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError, liveAuthFailed } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { until } from "../../test/forge-project";

function raw(port: number, opts: { method?: string; path: string; headers?: Record<string, string> }): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers ?? {} }, (res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d.toString()));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function live(port: number, first: string | null) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
  const messages: LiveMessage[] = [];
  const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
  const open = new Promise<void>((r) =>
    ws.addEventListener("open", () => {
      if (first !== null) ws.send(first);
      r();
    }),
  );
  ws.addEventListener("message", (e) => messages.push(JSON.parse(String(e.data)) as LiveMessage));
  return { ws, messages, closed, open };
}

describe("local API (phase 5 decisions 2-5)", () => {
  it("writes run/api.json with mode 0600 and removes it on close", async () => {
    const { home, api, close } = await apiProject();
    const file = join(home, "run", "api.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ port: api.port, token: api.token });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await close();
    await expect(stat(file)).rejects.toThrow();
  });

  it("refuses a missing token, a wrong Host and a foreign Origin; answers the renderer's preflight without the token", async () => {
    const { api, close } = await apiProject();
    const auth = { authorization: `Bearer ${api.token}` };
    expect((await raw(api.port, { path: "/status" })).status).toBe(401);
    expect((await raw(api.port, { path: "/status", headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await raw(api.port, { path: "/status", headers: { ...auth, host: `evil.example:${api.port}` } })).status).toBe(403);
    expect((await raw(api.port, { path: "/status", headers: { ...auth, host: `localhost:${api.port}` } })).status).toBe(403);
    expect((await raw(api.port, { path: "/status", headers: { ...auth, origin: "https://evil.example" } })).status).toBe(403);
    expect((await raw(api.port, { path: "/status", headers: { ...auth, origin: "null" } })).status).toBe(403);
    const pre = await raw(api.port, { method: "OPTIONS", path: "/jobs", headers: { origin: "app://pecore", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("app://pecore");
    expect(pre.headers["access-control-allow-headers"]).toContain("authorization");
    const ok = await raw(api.port, { path: "/status", headers: { ...auth, origin: "app://pecore" } });
    expect(ok.status).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBe("app://pecore");
    expect((await raw(api.port, { path: "/status", headers: auth })).status).toBe(200);
    await close();
  });

  it("validates input and maps engine errors to codes", async () => {
    const { call, close } = await apiProject();
    await expect(call("createJob", { body: { project: "demo", title: "", ticket: { text: "x" } } })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    await expect(call("getJob", { params: { id: "nope" } })).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(call("createJob", { body: { project: "other", title: "x", ticket: { text: "x" } } })).rejects.toMatchObject({ status: 404 });
    await expect(call("createJob", { body: { project: "demo", title: "x", recipe: "missing", ticket: { text: "x" } } })).rejects.toBeInstanceOf(ApiError);
    await close();
  });

  it("runs a job through the API: why, queue with hash, live updates, history and log", async () => {
    const { api, call, close } = await apiProject();
    const l = live(api.port, JSON.stringify({ auth: api.token }));
    await l.open;
    const { id } = await call("createJob", { body: { project: "demo", title: "Add hello", ticket: { text: "x" } } });
    await until(async () => (await call("getJob", { params: { id } })).job.state === "waiting");
    const why = await call("whyJob", { params: { id } });
    expect(why.reasons).toMatchObject([{ reason: "human", queueItemId: expect.any(String) }]);
    const [item] = await call("listQueue", { query: { state: "open" } });
    expect(item).toMatchObject({ id: why.reasons[0]!.queueItemId, projectId: "demo", jobId: id, kind: "human-node" });
    await expect(call("answerQueue", { params: { id: item!.id }, body: { choice: "approve", hash: "0".repeat(64) } })).rejects.toMatchObject({ status: 409 });
    await expect(call("answerQueue", { params: { id: item!.id }, body: { choice: "maybe", hash: item!.subjectHash } })).rejects.toMatchObject({ status: 400 });
    await call("answerQueue", { params: { id: item!.id }, body: { choice: "approve", note: "ok", hash: item!.subjectHash } });
    await until(async () => (await call("getJob", { params: { id } })).job.state === "succeeded");
    const detail = await call("getJob", { params: { id } });
    expect(detail.nodeRuns.map((r) => `${r.node}:${r.outcome}`)).toEqual(["write:done", "human:approve", "commit:done"]);
    expect(detail.job).toMatchObject({ recipe: "reviewed", projectId: "demo", archived: false });
    const write = detail.attempts.find((a) => a.nodeRunId === detail.nodeRuns[0]!.id)!;
    const log = await call("getLog", { params: { id: write.id }, query: { view: "events" } });
    expect(log).toMatchObject({ view: "events", events: [{ type: "output", text: expect.stringContaining("wrote hello") }] });
    expect(await call("listJobs", { query: { project: "demo" } })).toMatchObject([{ id, state: "succeeded" }]);
    await until(() => l.messages.some((m) => m.type === "queue.updated" && m.itemId === item!.id));
    expect(l.messages.some((m) => m.type === "job.updated" && m.jobId === id)).toBe(true);
    expect(l.messages.some((m) => m.type === "node_run.updated" && m.jobId === id)).toBe(true);
    l.ws.close();
    await close();
  });

  it("reads an artifact of a job; deletes the project locally, stopping its waiting job", async () => {
    const { engine, call, close } = await apiProject();
    const { id } = await call("createJob", { body: { project: "demo", title: "Add hello", ticket: { text: "x" } } });
    await until(async () => (await call("getJob", { params: { id } })).job.state === "waiting");
    const diff = (await call("getJob", { params: { id } })).artifacts.find((a) => a.type === "diff")!;
    const [, , run, name] = diff.path.split("/");
    const a = await call("getArtifact", { params: { job: id, run: run!, name: name! } });
    expect(a.content).toContain("+hello");
    await expect(call("getArtifact", { params: { job: id, run: run!, name: "../../pecore.db" } })).rejects.toMatchObject({ status: 404 });
    const dir = engine.project("demo").ctx.dir;
    await call("deleteProject", { params: { id: "demo" } });
    await expect(stat(dir)).rejects.toThrow();
    expect(await call("listProjects")).toEqual([]);
    expect(await call("listJobs", { query: {} })).toEqual([]);
    await close();
  });

  it("sends log lines only for subscribed attempts", async () => {
    const { api, engine, close } = await apiProject();
    const l = live(api.port, JSON.stringify({ auth: api.token }));
    await l.open;
    await until(() => engine.listenerCount("live") > 0);
    const event = { type: "text", text: "hi", at: 1 } as const;
    engine.emit("live", { type: "log.line", attemptId: "a1", event });
    l.ws.send(JSON.stringify({ subscribe: "a2" }));
    await new Promise((r) => setTimeout(r, 100));
    engine.emit("live", { type: "log.line", attemptId: "a1", event });
    engine.emit("live", { type: "log.line", attemptId: "a2", event });
    engine.emit("live", { type: "notify", kind: "k", title: "t", body: "b" });
    await until(() => l.messages.some((m) => m.type === "notify"));
    expect(l.messages.filter((m) => m.type === "log.line")).toEqual([{ type: "log.line", attemptId: "a2", event }]);
    l.ws.close();
    await close();
  });

  it("closes /live with 4401 on a wrong token or a first message that is not auth", async () => {
    const { api, engine, close } = await apiProject();
    const wrong = live(api.port, JSON.stringify({ auth: "nope" }));
    expect(await wrong.closed).toBe(liveAuthFailed);
    const sub = live(api.port, JSON.stringify({ subscribe: "a1" }));
    expect(await sub.closed).toBe(liveAuthFailed);
    expect(engine.listenerCount("live")).toBe(0);
    await close();
  });
});
