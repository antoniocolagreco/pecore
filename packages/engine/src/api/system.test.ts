import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiClient } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { forgeProject, until } from "../../test/forge-project";
import { ChatsDb } from "../store/chats-db";
import { handlers } from "./handlers";
import { startApi } from "./server";

describe("system routes", () => {
  it("deletes one notification persistently and refreshes the unread count", async () => {
    const { home, engine, call, close } = await apiProject();
    let retainedId: string;
    try {
      engine.notify({ kind: "test", title: "Remove me", body: "First update" });
      engine.notify({ kind: "test", title: "Keep me", body: "Second update" });
      const notifications = await call("listNotifications");
      const removedId: string = notifications.find(({ title }) => title === "Remove me")!.id;
      retainedId = notifications.find(({ title }) => title === "Keep me")!.id;
      const before: number = (await call("getStatus")).notifications;
      const events: LiveMessage[] = [];
      engine.on("live", (event: LiveMessage) => events.push(event));

      expect(await call("deleteNotification", { params: { id: removedId } })).toEqual({ ok: true });
      expect(await call("deleteNotification", { params: { id: removedId } })).toEqual({ ok: true });
      expect((await call("getStatus")).notifications).toBe(before - 1);
      expect(events.filter((event) => event.type === "notify" && event.kind === "deleted")).toHaveLength(1);
      expect(await call("listNotifications")).toEqual(notifications.filter(({ id }) => id !== removedId));
    } finally {
      await close();
    }
    const db: ChatsDb = new ChatsDb(join(home, "chats.db"));
    try {
      expect(db.notifications().filter(({ kind }) => kind === "test").map(({ id }) => id)).toEqual([retainedId]);
    } finally {
      db.close();
    }
  });

  it("lists theme files with their tokens or their errors", async () => {
    const { home, call, close } = await apiProject();
    await mkdir(join(home, "themes"), { recursive: true });
    await writeFile(join(home, "themes", "night.json"), JSON.stringify({ name: "Night", tokens: { bg: "#000", accent: "rgb(1, 2, 3)" } }));
    await writeFile(join(home, "themes", "bad.json"), JSON.stringify({ name: "Bad", tokens: { bg: "url(x)", nope: "#fff" } }));
    await writeFile(join(home, "themes", "broken.json"), "{");
    const themes = await call("listThemes");
    expect(themes.map((t) => t.file)).toEqual(["bad.json", "broken.json", "night.json"]);
    expect(themes[2]).toMatchObject({ theme: { name: "Night", tokens: { bg: "#000" } }, errors: [] });
    expect(themes[0]!.theme).toBeNull();
    expect(themes[0]!.errors.length).toBeGreaterThan(0);
    expect(themes[1]!.errors.length).toBe(1);
    await close();
  });

  it("checks prerequisites with the setting each one points to; unknown accounts are 404", async () => {
    const { call, close } = await apiProject();
    expect(await call("checkPrerequisites")).toContainEqual(expect.objectContaining({ tool: "git", ok: true, setting: null }));
    await expect(call("recheckAccount", { params: { id: "nope" } })).rejects.toMatchObject({ status: 404 });
    await expect(call("accountOptions", { params: { id: "nope" }, query: {} })).rejects.toMatchObject({ status: 404 });
    expect(await call("listLogins")).toEqual([]);
    await close();
  });

  it("recheck of a forge account releases the job waiting with auth; a tool login streams progress", async () => {
    const { forge, engine, stopConfirm } = await forgeProject();
    const api = await startApi(engine, { handlers: handlers("t"), validateResponses: true });
    const call = apiClient({ port: api.port, token: api.token });
    const p = engine.project("shop");
    const { id } = await call("createJob", { body: { project: "shop", title: "Add hello", ticket: { text: "x", id: "7" } } });
    await until(() => p.executor.job(id).state !== "queued");
    await forge.set({ tokenValid: false });
    await until(() => p.executor.job(id).waiting_reason === "auth");
    expect(await call("recheckAccount", { params: { id: "gh-test" } })).toEqual({ state: "logged_out" });
    expect(p.executor.job(id).waiting_reason).toBe("auth");
    await forge.set({ tokenValid: true });
    expect(await call("recheckAccount", { params: { id: "gh-test" } })).toEqual({ state: "logged_in" });
    await until(() => p.executor.job(id).state === "succeeded");

    const messages: LiveMessage[] = [];
    engine.on("live", (m: LiveMessage) => messages.push(m));
    expect(await call("startAccountLogin", { params: { id: "gh-test" } })).toEqual({ loginId: "tool:gh-test" });
    await until(() => messages.some((m) => m.type === "login.progress" && m.loginId === "tool:gh-test" && m.done));
    expect((await forge.state()).calls).toContain("auth login --hostname github.com --web --git-protocol https");
    stopConfirm();
    await api.close();
    await engine.shutdown();
  });
});
