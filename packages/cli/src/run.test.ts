import { mkdir, writeFile } from "node:fs/promises";
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
  it("says <PE/CORE> is not running when there is no api.json, and when its port is closed", async () => {
    const home = join(await tempDir(), "home");
    const c = capture();
    expect(await run(["job", "list"], c.io, { PECORE_HOME: home })).toBe(1);
    expect(c.err).toEqual(["<PE/CORE> is not running: open the app"]);
    const { home: live, close } = await apiProject();
    await close();
    const d = capture();
    expect(await run(["job", "list"], d.io, { PECORE_HOME: live })).toBe(1);
    expect(d.err).toEqual(["<PE/CORE> is not running: open the app"]);
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

  it("exports a project, lists secret findings until accepted, and imports an archive under a new id", async () => {
    const { home, engine, call, close } = await apiProject();
    const env = { PECORE_HOME: home };
    const out = join(await tempDir(), "demo.tar.zst");

    const e = capture();
    expect(await run(["project", "export", "demo", "--out", out], e.io, env)).toBe(0);
    expect(e.out).toEqual([out]);

    const { id } = await call("createJob", { body: { project: "demo", title: "Add hello", ticket: { text: "x" } } });
    await until(async () => (await call("getJob", { params: { id } })).job.state === "waiting");
    const busy = capture();
    expect(await run(["project", "export", "demo", "--out", `${out}.h`, "--history"], busy.io, env)).toBe(1);
    expect(busy.err[0]).toBe("conflict: 1 job is active: stop or archive them first");
    await call("stopJob", { params: { id } });

    const leak = join(engine.projectDir("demo"), "artifacts", id, "leak");
    await mkdir(leak, { recursive: true });
    await writeFile(join(leak, "out.txt"), `ghp_${"x".repeat(36)}\n`);
    const f = capture();
    expect(await run(["project", "export", "demo", "--out", `${out}.h`, "--history"], f.io, env)).toBe(1);
    expect(f.err[0]).toMatch(new RegExp(`^FILE\\s+LINE\\s+RULE\\s+FINGERPRINT\\n${id}/leak/out.txt\\s+1\\s+github-pat\\s+`));
    expect(f.err[0]).not.toContain("x".repeat(36));
    const a = capture();
    expect(await run(["project", "export", "demo", "--out", `${out}.h`, "--history", "--accept-findings"], a.io, env)).toBe(0);
    expect(a.out).toEqual([`${out}.h`]);

    const bad = capture();
    expect(await run(["project", "import", out, "--account", "nope"], bad.io, env)).toBe(2);
    expect(bad.err[0]).toBe("invalid account mapping nope. Use --account <from>=<to> once per source account.");
    const dup = capture();
    expect(await run(["project", "import", out], dup.io, env)).toBe(1);
    expect(dup.err.at(-1)).toBe("conflict: project demo already exists");
    const i = capture();
    expect(await run(["project", "import", out, "--id", "copy"], i.io, env)).toBe(0);
    expect(i.out).toEqual(["copy"]);
    expect(i.err).toEqual([expect.stringContaining("Review every script and prompt")]);
    expect(await call("listQueue", { query: { project: "copy", state: "open" } })).toEqual([]);
    expect((await call("getProject", { params: { id: "copy" } })).project?.id).toBe("copy");
    await close();
  }, 60000);
});
