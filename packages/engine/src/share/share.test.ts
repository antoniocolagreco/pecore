import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { list } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient } from "@pecore/schemas";
import { apiProject } from "../../test/api-project";
import { fakeGitleaks } from "../../test/fake-gitleaks";
import { forgeAccount } from "../../test/fake-forge";
import { forgeProject, until } from "../../test/forge-project";
import { tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";
import type { OrderSink } from "../sources/poll";
import { beginImport } from "./import";

const secret = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
let savedPath: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  savedPath = process.env.PATH;
  savedHome = process.env.HOME;
});

afterEach(() => {
  process.env.PATH = savedPath;
  process.env.HOME = savedHome;
});

function entries(archive: string): string[] {
  const tarFile = `${archive}.tar`;
  writeFileSync(tarFile, zstdDecompressSync(readFileSync(archive)));
  const names: string[] = [];
  list({ file: tarFile, sync: true, onReadEntry: (e) => names.push(e.path) });
  return names.sort();
}

function header(name: string, type: string, size: number, link = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100);
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write(link, 157, 100);
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

type RawEntry = { name: string; type?: string; body?: Buffer | string; link?: string };

function rawArchive(file: string, list: RawEntry[]): string {
  const parts: Buffer[] = [];
  for (const e of list) {
    const body = Buffer.from(e.body ?? "");
    parts.push(header(e.name, e.type ?? "0", e.type && e.type !== "0" ? 0 : body.length, e.link));
    if (!e.type || e.type === "0") parts.push(body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  writeFileSync(file, zstdCompressSync(Buffer.concat(parts)));
  return file;
}

function files(dir: string, roots: string[]): RawEntry[] {
  const out: RawEntry[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ name: relative(dir, p), body: readFileSync(p) });
    }
  };
  for (const r of roots) {
    const p = join(dir, r);
    if (lstatSync(p).isDirectory()) walk(p);
    else out.push({ name: r, body: readFileSync(p) });
  }
  return out;
}

const manifest = (history: boolean) => ({ name: "manifest.json", body: JSON.stringify({ format: 1, projectId: "demo", exportedAt: "2026-11-19T10:00:00.000Z", history, logs: false }) });

async function secondHome(library: string, orders?: OrderSink) {
  const home = join(await tempDir(), "home");
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ ...forgeAccount, id: "gh-mine" }] }));
  const engine = await Engine.start({ home, library, ...(orders ? { orders } : {}) });
  const api = await startApi(engine, { handlers: handlers("0.0.0-test"), validateResponses: true });
  const call = apiClient({ port: api.port, token: api.token });
  const close = async () => {
    await api.close();
    await engine.shutdown();
  };
  return { home, engine, call, close };
}

type Item = { id: string; kind: string; subject: string; subject_hash: string; state: string; choice: string | null };

function items(engine: Engine, id: string, kind = "import"): Item[] {
  return engine.project(id).ctx.db.db.prepare("SELECT id, kind, subject, subject_hash, state, choice FROM human_queue WHERE kind = ? ORDER BY id").all(kind) as Item[];
}

async function finishedJob(p: Awaited<ReturnType<typeof apiProject>>): Promise<string> {
  const { id } = await p.call("createJob", { body: { project: "demo", title: "Add hello", ticket: { text: "x" } } });
  await until(async () => (await p.call("getJob", { params: { id } })).job.state === "waiting");
  const human = items(p.engine, "demo", "human-node").find((i) => i.state === "open")!;
  await p.engine.project("demo").executor.answer(human.id, "approve", null, human.subject_hash);
  await until(async () => (await p.call("getJob", { params: { id } })).job.state === "succeeded");
  return id;
}

describe("project export (share/, section 8)", () => {
  it("without history: only the manifest and the definitions, even with an active job; refuses an existing file and logs without history", async () => {
    const p = await apiProject();
    const dir = p.engine.projectDir("demo");
    await writeFile(join(dir, "knowledge", "notes.md"), "# Notes\n");
    const { id } = await p.call("createJob", { body: { project: "demo", title: "Add hello", ticket: { text: "x" } } });
    await until(async () => (await p.call("getJob", { params: { id } })).job.state === "waiting");
    const out = join(await tempDir(), "demo.tar.zst");

    expect(await p.call("exportProject", { params: { id: "demo" }, body: { path: out } })).toEqual({ state: "written", path: out });
    const names = entries(out);
    expect(names).toContain("manifest.json");
    expect(names).toContain("project.json");
    expect(names).toContain("knowledge/notes.md");
    expect(names).toContain("nodes/write-hello.json");
    expect(names).toContain("recipes/reviewed.json");
    expect(names.filter((n) => !/^(manifest\.json|project\.json|(nodes|recipes|knowledge)(\/|$))/.test(n))).toEqual([]);
    expect(statSync(out).mode & 0o777).toBe(0o600);

    await expect(p.call("exportProject", { params: { id: "demo" }, body: { path: out } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already exists") });
    await expect(p.call("exportProject", { params: { id: "demo" }, body: { path: join(dirname(out), "b.tar.zst"), logs: true } })).rejects.toMatchObject({ status: 400 });
    await expect(p.call("exportProject", { params: { id: "nope" }, body: { path: join(dirname(out), "c.tar.zst") } })).rejects.toMatchObject({ status: 404 });
    await p.close();
  }, 60000);

  it("with history: refused while a job is active, needs gitleaks, lists findings without the secret, and writes after they are accepted", async () => {
    const p = await apiProject();
    const dir = p.engine.projectDir("demo");
    const { id: active } = await p.call("createJob", { body: { project: "demo", title: "Active", ticket: { text: "x" } } });
    await until(async () => (await p.call("getJob", { params: { id: active } })).job.state === "waiting");
    const out = join(await tempDir(), "demo.tar.zst");
    await expect(p.call("exportProject", { params: { id: "demo" }, body: { path: out, history: true } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("1 job is active: stop or archive them first") });
    await p.call("stopJob", { params: { id: active } });

    process.env.PATH = "/usr/bin:/bin";
    await expect(p.engine.exportProject("demo", { path: out, history: true, logs: false, acceptFindings: [] })).rejects.toThrow("gitleaks is not installed");
    process.env.PATH = savedPath;

    const gl = await fakeGitleaks();
    process.env.PATH = `${gl.bin}:${savedPath}`;
    const done = await finishedJob(p);
    const leakDir = join(dir, "artifacts", done, "leak");
    await mkdir(leakDir, { recursive: true });
    await writeFile(join(leakDir, "out.txt"), `first line\ntoken ${secret}\n`);

    const r = await p.call("exportProject", { params: { id: "demo" }, body: { path: out, history: true } });
    expect(r).toEqual({ state: "findings", findings: [{ fingerprint: expect.any(String), file: `${done}/leak/out.txt`, line: 2, rule: "github-pat" }] });
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(lstatSync(out, { throwIfNoEntry: false })).toBeUndefined();
    expect((await gl.calls())[0]).toEqual(["dir", "artifacts", "--no-banner", "--report-format", "json", "--report-path", expect.any(String), "--exit-code", "0"]);

    const fingerprint = r.state === "findings" ? r.findings[0]!.fingerprint : "";
    expect(await p.call("exportProject", { params: { id: "demo" }, body: { path: out, history: true, acceptFindings: [fingerprint] } })).toEqual({ state: "written", path: out });
    const names = entries(out);
    expect(names).toContain("pecore.db");
    expect(names).toContain(`artifacts/${done}/leak/out.txt`);
    expect(names.filter((n) => n.startsWith("logs"))).toEqual([]);
    expect(names.filter((n) => /^(repo\.git|work|creating\.json)/.test(n))).toEqual([]);

    const withLogs = join(dirname(out), "logs.tar.zst");
    expect(await p.call("exportProject", { params: { id: "demo" }, body: { path: withLogs, history: true, logs: true, acceptFindings: [fingerprint] } })).toEqual({ state: "written", path: withLogs });
    expect(entries(withLogs).filter((n) => /^logs\/.+/.test(n)).length).toBeGreaterThan(0);
    await p.close();
  }, 90000);
});

describe("project import (share/, CUJ 7)", () => {
  it("imports history and runs new jobs with the recipe's human review only", async () => {
    const gl = await fakeGitleaks();
    process.env.PATH = `${gl.bin}:${savedPath}`;
    const p = await apiProject();
    const done = await finishedJob(p);
    const src = p.engine.project("demo").ctx.db;
    src.append([{ jobId: null, type: "confirmation.recorded", payload: { path: "nodes/git-commit.json", sha256: "a".repeat(64) } }]);
    const out = join(await tempDir(), "demo.tar.zst");
    await p.call("exportProject", { params: { id: "demo" }, body: { path: out, history: true, logs: true } });
    const library = join(dirname(p.home), "library");
    await p.close();

    const b = await secondHome(library);
    const result = await b.call("importProject", { body: { path: out } });
    expect(result).toEqual({ state: "imported", id: "demo" });
    const dir = b.engine.projectDir("demo");
    expect(lstatSync(join(dir, "repo.git")).isDirectory()).toBe(true);
    expect(lstatSync(join(dir, "creating.json"), { throwIfNoEntry: false })).toBeUndefined();
    expect(readdirSync(b.home).filter((n) => n.startsWith(".pecore-import-"))).toEqual([]);
    const { ctx, executor } = b.engine.project("demo");
    const copied = ctx.db.db.prepare("SELECT id, state FROM jobs").all() as { id: string; state: string }[];
    expect(copied).toEqual([{ id: expect.any(String), state: "succeeded" }]);
    const old = copied[0]!.id;
    expect(old).not.toBe(done);
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM events WHERE type = 'confirmation.recorded'").get()).toEqual({ n: 0 });
    expect(readdirSync(join(dir, "artifacts"))).toEqual([old]);
    const logs = ctx.db.db.prepare("SELECT id, log_path FROM attempts").all() as { id: string; log_path: string }[];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(lstatSync(join(dir, l.log_path)).isFile()).toBe(true);
      expect((await b.call("getLog", { params: { id: l.id }, query: { view: "raw" } })).view).toBe("raw");
    }
    const detail = await b.call("getJob", { params: { id: old } });
    expect(detail.artifacts.length).toBeGreaterThan(0);
    for (const a of detail.artifacts) {
      const [, job, run, name] = a.path.split("/");
      expect(job).toBe(old);
      expect((await b.call("getArtifact", { params: { job: job!, run: run!, name: name! } })).artifact.path).toBe(a.path);
    }

    expect(items(b.engine, "demo", "import")).toEqual([]);
    const { id } = await b.call("createJob", { body: { project: "demo", title: "After import", ticket: { text: "x" } } });
    await until(async () => (await b.call("getJob", { params: { id } })).job.state === "waiting");
    const human = items(b.engine, "demo", "human-node").find((i) => i.state === "open")!;
    await executor.answer(human.id, "approve", null, human.subject_hash);
    await until(async () => (await b.call("getJob", { params: { id } })).job.state === "succeeded");
    expect(items(b.engine, "demo", "engine-node")).toEqual([]);

    await expect(b.call("importProject", { body: { path: out } })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("project demo already exists") });
    await b.close();
  }, 120000);

  it("the same archive with history imported ten times gives ten independent copies, each with its own job ids, artifacts and logs", async () => {
    const gl = await fakeGitleaks();
    process.env.PATH = `${gl.bin}:${savedPath}`;
    const p = await apiProject();
    const done = await finishedJob(p);
    const out = join(await tempDir(), "pippo.tar.zst");
    await p.call("exportProject", { params: { id: "demo" }, body: { path: out, history: true, logs: true } });
    const seen = new Set([done]);
    for (let n = 2; n <= 11; n++) {
      const id = `pippo${n}`;
      expect(await p.call("importProject", { body: { path: out, id } })).toMatchObject({ state: "imported", id });
      const copy = p.engine.project(id);
      expect(copy.ctx.dir).toBe(join(p.home, "projects", id));
      const [job] = copy.executor.jobs();
      expect(seen.has(job!.id)).toBe(false);
      seen.add(job!.id);
      const detail = await p.call("getJob", { params: { id: job!.id } });
      expect(detail.job.projectId).toBe(id);
      const [, j, run, name] = detail.artifacts[0]!.path.split("/");
      expect((await p.call("getArtifact", { params: { job: j!, run: run!, name: name! } })).artifact.path).toBe(detail.artifacts[0]!.path);
      const attempt = copy.ctx.db.db.prepare("SELECT id FROM attempts").get() as { id: string };
      expect((await p.call("getLog", { params: { id: attempt.id }, query: { view: "raw" } })).view).toBe("raw");
    }
    expect((await p.call("getJob", { params: { id: done } })).job.projectId).toBe("demo");
    await p.close();
  }, 120000);

  it("the project can be deleted and the archive imported again", async () => {
    const p = await apiProject();
    const out = join(await tempDir(), "demo.tar.zst");
    await p.call("exportProject", { params: { id: "demo" }, body: { path: out } });
    await p.call("importProject", { body: { path: out, id: "copy" } });
    const dir = p.engine.projectDir("copy");
    await p.call("deleteProject", { params: { id: "copy" } });
    await expect(p.call("getProject", { params: { id: "copy" } })).rejects.toMatchObject({ status: 404 });
    expect(lstatSync(dir, { throwIfNoEntry: false })).toBeUndefined();
    expect(execFileSync("git", ["-C", p.home, "log", "-1", "--format=%s"], { encoding: "utf8" })).toContain("copy");
    expect(await p.call("importProject", { body: { path: out, id: "copy" } })).toMatchObject({ state: "imported", id: "copy" });
    await p.close();
  }, 60000);

  it("a child job in an imported project still waits for its parent", async () => {
    const p = await apiProject();
    const out = join(await tempDir(), "demo.tar.zst");
    await p.call("exportProject", { params: { id: "demo" }, body: { path: out } });
    const library = join(dirname(p.home), "library");
    await p.close();
    const b = await secondHome(library);
    await b.call("importProject", { body: { path: out } });
    const parent = await b.engine.createJob("demo", { title: "Parent", ticket: { text: "x" } });
    const child = await b.engine.createJob("demo", { title: "Child", ticket: { text: "x" }, parentJobId: parent });
    const { executor } = b.engine.project("demo");
    await until(() => executor.job(parent).state === "waiting");
    await until(() => executor.job(child).waiting_reason === "parent_job");
    expect(executor.job(child).state).toBe("queued");
    const human = items(b.engine, "demo", "human-node").find((i) => i.state === "open")!;
    await executor.answer(human.id, "approve", null, human.subject_hash);
    await until(() => executor.job(parent).state === "succeeded");
    await until(() => executor.job(child).state === "waiting");
    await b.close();
  }, 90000);

  it("a forge project asks for its accounts, checks the target, rewrites the ids and clones with the mapped account", async () => {
    const f = await forgeProject();
    const dir = f.engine.projectDir("shop");
    const pr = JSON.parse(await readFile(join(dir, "nodes", "github-pr.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(dir, "nodes", "pr-explicit.json"), JSON.stringify({ ...pr, name: "pr-explicit", credentials: [forgeAccount.id] }));
    const projectFile = join(dir, "project.json");
    await writeFile(projectFile, JSON.stringify({ ...JSON.parse(await readFile(projectFile, "utf8")), folder: "/home/someone/shop" }, null, 2) + "\n");
    const out = join(await tempDir(), "shop.tar.zst");
    expect(await f.engine.exportProject("shop", { path: out, history: false, logs: false, acceptFindings: [] })).toEqual({ state: "written", path: out });
    await f.engine.shutdown();

    const b = await secondHome(f.library);
    expect(await b.call("importProject", { body: { path: out } })).toEqual({ state: "needs-accounts", accounts: [{ id: forgeAccount.id, kind: "forge" }] });
    await expect(b.call("importProject", { body: { path: out, accounts: { [forgeAccount.id]: "nope" } } })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("forge account nope not found") });
    expect(readdirSync(join(b.home, "projects"), { withFileTypes: true }).map((e) => e.name)).toEqual([]);

    expect(await b.call("importProject", { body: { path: out, accounts: { [forgeAccount.id]: "gh-mine" } } })).toMatchObject({ state: "imported", id: "shop" });
    const nd = b.engine.projectDir("shop");
    const project = JSON.parse(await readFile(join(nd, "project.json"), "utf8")) as { repo: { url: string; account: string }; createRepo: string | null; folder: string | null };
    expect(project.repo).toMatchObject({ url: "https://github.com/acme/shop.git", account: "gh-mine" });
    expect(project.createRepo).toBeNull();
    expect(project.folder).toBeNull();
    expect((JSON.parse(await readFile(join(nd, "nodes", "pr-explicit.json"), "utf8")) as { credentials: string[] }).credentials).toEqual(["gh-mine"]);
    expect((JSON.parse(await readFile(join(nd, "nodes", "github-pr.json"), "utf8")) as { credentials: string[] }).credentials).toEqual(["project.account"]);
    expect(items(b.engine, "shop", "import")).toEqual([]);
    expect(execFileSync("git", ["--git-dir", join(nd, "repo.git"), "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim()).toBe("https://github.com/acme/shop.git");
    expect(execFileSync("git", ["--git-dir", join(nd, "repo.git"), "rev-parse", "--verify", "main"], { encoding: "utf8" }).trim()).toMatch(/^[a-f\d]{40}$/);
    await b.close();
  }, 90000);

  it("untrusted archives are refused before anything is written", async () => {
    const p = await apiProject();
    const dir = p.engine.projectDir("demo");
    const base = files(dir, ["project.json", "nodes", "recipes"]);
    const t = await tempDir();
    const library = join(dirname(p.home), "library");
    await p.close();
    const b = await secondHome(library);

    expect(await b.call("importProject", { body: { path: rawArchive(join(t, "ok.tar.zst"), [manifest(false), ...base]), id: "control" } })).toMatchObject({ state: "imported", id: "control" });

    const bad: [string, RawEntry[], string][] = [
      ["symlink", [manifest(false), ...base, { name: "knowledge/passwd.md", type: "2", link: "/etc/passwd" }], "invalid archive entry"],
      ["hardlink", [manifest(false), ...base, { name: "knowledge/h.md", type: "1", link: "project.json" }], "invalid archive entry"],
      ["parent", [manifest(false), ...base, { name: "knowledge/../../escape.md", body: "x" }], "invalid archive entry"],
      ["absolute", [manifest(false), ...base, { name: "/tmp/escape.md", body: "x" }], "invalid archive entry"],
      ["unknown root", [manifest(false), ...base, { name: "run.sh", body: "x" }], "invalid archive entry"],
      ["repo", [manifest(false), ...base, { name: "repo.git/config", body: "x" }], "invalid archive entry"],
      ["duplicate", [manifest(false), ...base, base[0]!], "invalid archive entry"],
      ["no db with history", [manifest(true), ...base], "history and logs flags"],
      ["artifacts without history", [manifest(false), ...base, { name: "artifacts/j/r/out.txt", body: "x" }], "history and logs flags"],
      ["invalid node", [manifest(false), ...base, { name: "nodes/broken.json", body: JSON.stringify({ name: "broken", kind: "command" }) }], "broken"],
    ];
    for (const [name, list, message] of bad) {
      await expect(b.call("importProject", { body: { path: rawArchive(join(t, `${name}.tar.zst`), list), id: "evil" } }), name).rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) });
    }
    expect(readdirSync(join(b.home, "projects")).sort()).toEqual(["control"]);
    expect(readdirSync(b.home).filter((n) => n.startsWith(".pecore-import-"))).toEqual([]);
    expect(lstatSync("/tmp/escape.md", { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(join(dirname(b.home), "escape.md"), { throwIfNoEntry: false })).toBeUndefined();
    await b.close();
  }, 90000);

  it("an archive whose history has an active job is refused", async () => {
    const p = await apiProject();
    const { id } = await p.call("createJob", { body: { project: "demo", title: "Active", ticket: { text: "x" } } });
    await until(async () => (await p.call("getJob", { params: { id } })).job.state === "waiting");
    const dir = p.engine.projectDir("demo");
    const t = await tempDir();
    p.engine.project("demo").ctx.db.db.prepare("VACUUM INTO ?").run(join(t, "pecore.db"));
    const list = [manifest(true), ...files(dir, ["project.json", "nodes", "recipes"]), { name: "pecore.db", body: readFileSync(join(t, "pecore.db")) }];
    const library = join(dirname(p.home), "library");
    await p.close();
    const b = await secondHome(library);
    await expect(b.call("importProject", { body: { path: rawArchive(join(t, "active.tar.zst"), list) } })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("pecore.db contains 1 active job") });
    expect(readdirSync(join(b.home, "projects"))).toEqual([]);
    await b.close();
  }, 60000);

  it("an import stopped after its files were written finishes like a project creation at the next start", async () => {
    const p = await apiProject();
    const out = join(await tempDir(), "demo.tar.zst");
    await p.call("exportProject", { params: { id: "demo" }, body: { path: out } });
    const library = join(dirname(p.home), "library");
    await p.close();
    const home = join(await tempDir(), "home");
    await (await Engine.start({ home, library })).shutdown();
    expect(await beginImport(home, { path: out }, { accounts: { accounts: [] }, knownProject: () => false })).toMatchObject({ state: "imported", id: "demo" });
    const dir = join(home, "projects", "demo");
    expect(JSON.parse(await readFile(join(dir, "creating.json"), "utf8"))).toEqual({ step: 3 });

    const engine = await Engine.start({ home, library });
    expect(engine.creating.has("demo")).toBe(true);
    await engine.continueCreation("demo");
    expect(engine.creating.has("demo")).toBe(false);
    expect(lstatSync(join(dir, "repo.git")).isDirectory()).toBe(true);
    expect(items(engine, "demo", "import")).toEqual([]);
    await engine.shutdown();
  }, 60000);

  it("starts the configured source on import without creating an approval item", async () => {
    const p = await apiProject();
    const dir = p.engine.projectDir("demo");
    const fakeSource = {
      name: "fake-source",
      description: "one ticket",
      kind: "source",
      params: { type: "object", properties: { trusted: { type: "array", items: { type: "string" }, default: [] }, pollSec: { type: "integer", default: 300 } } },
      list: { command: ["/bin/sh", "-c", `printf '[{"id":"1","title":"One"}]'`] },
      read: { command: ["/bin/sh", "-c", `printf '{"title":"One","body":"b","author":"alice"}'`] },
      comment: { command: ["/bin/true"] },
      replies: { command: ["/bin/sh", "-c", "printf '[]'"] },
      timeoutSec: 10,
    };
    await writeFile(join(dir, "nodes", "fake-source.json"), JSON.stringify(fakeSource));
    const project = JSON.parse(await readFile(join(dir, "project.json"), "utf8")) as Record<string, unknown>;
    await writeFile(join(dir, "project.json"), JSON.stringify({ ...project, source: { node: "fake-source", params: { trusted: ["alice"], pollSec: 1 } } }));
    const out = join(await tempDir(), "demo.tar.zst");
    await p.call("exportProject", { params: { id: "demo" }, body: { path: out } });
    const library = join(dirname(p.home), "library");
    await p.close();

    const hands: string[] = [];
    const b = await secondHome(library, { hand: async (_p, order) => void hands.push(order.ticket.id) });
    await b.call("importProject", { body: { path: out } });
    expect(items(b.engine, "demo", "import")).toEqual([]);
    expect(items(b.engine, "demo", "source-node")).toEqual([]);
    await until(() => hands.length === 1, 10000);
    expect(hands).toEqual(["1"]);
    await b.close();
  }, 60000);
});
