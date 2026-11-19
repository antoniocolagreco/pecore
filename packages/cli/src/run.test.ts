import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiProject } from "../../engine/test/api-project";
import { until } from "../../engine/test/forge-project";
import { tempDir } from "../../engine/test/tmp";
import { run } from "./run";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (t: string) => out.push(t), error: (t: string) => err.push(t) } };
}

describe("pecore CLI over the local API", () => {
  it("says PeCore is not running when there is no api.json, and when its port is closed", async () => {
    const home = join(await tempDir(), "home");
    const c = capture();
    expect(await run(["job", "list"], c.io, { PECORE_HOME: home })).toBe(1);
    expect(c.err).toEqual(["PeCore is not running: open the app"]);
    const { home: live, close } = await apiProject();
    await close();
    const d = capture();
    expect(await run(["job", "list"], d.io, { PECORE_HOME: live })).toBe(1);
    expect(d.err).toEqual(["PeCore is not running: open the app"]);
  });

  it("lists projects and jobs, explains why a job waits, stops it, and validates files", async () => {
    const { home, call, close } = await apiProject();
    const env = { PECORE_HOME: home };
    const { id } = await call("createJob", { body: { project: "demo", title: "Add hello", ticket: { text: "x" } } });
    await until(async () => (await call("getJob", { params: { id } })).job.state === "waiting");

    const p = capture();
    expect(await run(["project", "list"], p.io, env)).toBe(0);
    expect(p.out[0]).toMatch(/demo\s+Demo\s+local only\s+main/);

    const j = capture();
    expect(await run(["job", "list"], j.io, env)).toBe(0);
    expect(j.out[0]).toContain(`${id}  waiting (human)`);

    const w = capture();
    expect(await run(["job", "why", id], w.io, env)).toBe(0);
    expect(w.out[0]).toBe(`${id}: waiting\n  Node human waits for your review in the Inbox`);

    const s = capture();
    expect(await run(["job", "stop", id], s.io, env)).toBe(0);
    expect((await call("getJob", { params: { id } })).job.state).toBe("stopped");

    const v = capture();
    expect(await run(["validate", join(home, "projects", "demo", "project.json")], v.io, env)).toBe(0);
    expect(v.out[0]).toContain("project.json: ok");
    const g = capture();
    expect(await run(["validate", join(home, ".gitignore")], g.io, env)).toBe(1);
    expect(g.err[0]).toMatch(/invalid definition path .gitignore/);

    const bad = capture();
    expect(await run(["job", "why", "nope"], bad.io, env)).toBe(1);
    expect(bad.err[0]).toMatch(/^not_found: /);

    const u = capture();
    expect(await run(["job"], u.io, env)).toBe(2);
    expect(u.err[0]).toContain("Usage:");
    await close();
  });
});
