import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiClient } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { forgeProject, until } from "../../test/forge-project";
import { handlers } from "./handlers";
import { startApi } from "./server";

describe("system routes", () => {
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

  it("reports usage per day, project and account, and today's use against the budget", async () => {
    const { engine, call, close } = await apiProject();
    const db = engine.project("demo").ctx.db;
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    db.append([
      { jobId: null, type: "attempt.ended", payload: { attemptId: "x", endReason: "completed", model: null, account: "claude-main", tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2 }, cost: 0.5, day } },
      { jobId: null, type: "attempt.ended", payload: { attemptId: "y", endReason: "completed", model: null, account: "claude-main", tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, cost: null, day: "2026-01-01" } },
    ]);
    const u = await call("getUsage", { query: { from: day } });
    expect(u.days).toEqual([{ day, project: "demo", account: "claude-main", tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2 }, cost: 0.5 }]);
    expect(u.budgets).toEqual([{ project: "demo", dayTokens: null, dayUsd: null, usedTokens: 17, usedUsd: 0.5 }]);
    expect((await call("getUsage", { query: {} })).days).toHaveLength(2);
    await close();
  });

  it("checks prerequisites with the setting each one points to; unknown accounts are 404", async () => {
    const { call, close } = await apiProject();
    expect(await call("checkPrerequisites")).toContainEqual(expect.objectContaining({ tool: "git", ok: true, setting: "programPaths" }));
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
