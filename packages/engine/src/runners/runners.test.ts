import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandNode } from "@pecore/schemas";
import { tempDir } from "../../test/tmp";
import { readLog, LogWriter } from "../observability/logs";
import { contentState } from "../workdir/content-state";
import { createLocalRepo } from "../workdir/repo";
import { addWorktree } from "../workdir/worktrees";
import { pickOutcome, runCommandNode } from "./command";
import type { CommandRun } from "./command";
import { placeholderValues, repoOwnerAndName, substituteArgv } from "./placeholders";
import { readProbe } from "./probe";
import { appUser, run, spawnAs } from "./process";

const u = appUser;

const node = (extra: object) =>
  CommandNode.parse({
    name: "check",
    description: "check",
    kind: "command",
    outcomes: ["passed", "failed"],
    failOutcomes: ["failed"],
    changesFiles: false,
    outcomeRules: [
      { exitCode: 0, outcome: "passed" },
      { exitCode: "other", outcome: "failed" },
    ],
    timeoutSec: 30,
    ...extra,
  });

async function setup() {
  const project = await tempDir();
  const base = await createLocalRepo(join(project, "repo.git"), "main");
  const wd = await addWorktree(u, project, "J1", base);
  const nodeDir = join(project, "nodes");
  await mkdir(nodeDir);
  const ctx = (n: CommandNode, extra: Partial<CommandRun> = {}): CommandRun => ({
    node: n,
    nodeDir,
    params: {},
    user: u,
    workdir: wd,
    context: { job: { id: "J1", title: "Fix it", branch: "factory/J1", base, oldBase: base, target: "main", commit: null }, ticketId: null, project: { repoDir: join(project, "repo.git"), repoUrl: null } },
    inputs: [],
    cleanTree: null,
    ...extra,
  });
  return { project, wd, nodeDir, ctx };
}

describe("process", () => {
  it("runs a command in its own process group and reads its output", async () => {
    const p = await spawnAs({ user: u, argv: ["/bin/sh", "-c", "ps -o pgid= -p $$; echo err >&2"], env: { PATH: "/usr/bin:/bin" }, cwd: "/" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    await p.exited;
    expect(Number(out.trim())).toBe(p.pgid);
  });

  it("stops the whole group, children included", async () => {
    const p = await spawnAs({ user: u, argv: ["/bin/sh", "-c", "sleep 30 & sleep 30; wait"], env: { PATH: "/usr/bin:/bin" }, cwd: "/" });
    await new Promise((r) => setTimeout(r, 100));
    await p.stop();
    const left = await run({ user: u, argv: ["/bin/sh", "-c", `ps -o pid= -g ${p.pgid} || true`], env: { PATH: "/usr/bin:/bin" }, cwd: "/" });
    expect(left.stdout.trim()).toBe("");
  });

  it("times out", async () => {
    const r = await run({ user: u, argv: ["sleep", "10"], env: { PATH: "/usr/bin:/bin" }, cwd: "/", timeoutMs: 100 });
    expect(r.timedOut).toBe(true);
  });
});

describe("placeholders", () => {
  it("splits owner and name of GitHub and GitLab URLs", () => {
    expect(repoOwnerAndName("https://github.com/acme/app.git")).toEqual({ owner: "acme", name: "app" });
    expect(repoOwnerAndName("git@gitlab.com:group/sub/app.git")).toEqual({ owner: "group/sub", name: "app" });
  });

  it("substitutes into single arguments and refuses missing values", () => {
    const v = placeholderValues({ job: { id: "J", title: "t; rm -rf /", branch: "b", base: "1", oldBase: "0", target: "main", commit: null }, ticketId: null, workdir: "/w", project: { repoDir: "/r", repoUrl: null }, params: { suite: "unit" }, inputs: {} });
    expect(substituteArgv(["echo", "{job.title}", "--suite={params.suite}"], v)).toEqual(["echo", "t; rm -rf /", "--suite=unit"]);
    expect(() => substituteArgv(["{job.commit}"], v)).toThrow("no value for placeholder {job.commit}");
  });
});

describe("outcome and probe rules", () => {
  it("picks the first matching outcome rule", () => {
    const rules = [
      { stdoutJson: "state", value: "MERGED", outcome: "merged" },
      { exitCode: 0, outcome: "open" },
    ] as const;
    expect(pickOutcome([...rules], { code: 0, stdout: '{"state":"MERGED"}' })).toBe("merged");
    expect(pickOutcome([...rules], { code: 0, stdout: "not json" })).toBe("open");
    expect(pickOutcome([...rules], { code: 1, stdout: "" })).toBe(null);
  });

  it("reads a probe: default rule and JSON rule", () => {
    expect(readProbe({ code: 0, stdout: "url\n", timedOut: false }, undefined)).toBe("done");
    expect(readProbe({ code: 0, stdout: "\n", timedOut: false }, undefined)).toBe("not_done");
    expect(readProbe({ code: 1, stdout: "", timedOut: false }, undefined)).toBe("unknown");
    const rule = { stdoutJson: "state", done: ["merged"], notDone: [] };
    expect(readProbe({ code: 0, stdout: '{"state":"merged"}', timedOut: false }, rule)).toBe("done");
    expect(readProbe({ code: 0, stdout: '{"state":"opened"}', timedOut: false }, rule)).toBe("not_done");
  });
});

describe("command nodes", () => {
  it("runs a command in the workdir and maps the exit code", async () => {
    const { wd, ctx } = await setup();
    await writeFile(join(wd, "ok"), "");
    expect(await runCommandNode(ctx(node({ command: ["test", "-f", "ok"] })))).toMatchObject({ kind: "completed", outcome: "passed" });
    expect(await runCommandNode(ctx(node({ command: ["test", "-f", "nope"] })))).toMatchObject({ kind: "completed", outcome: "failed" });
  });

  it("runs a script with placeholders as environment variables, not in the source", async () => {
    const { nodeDir, ctx } = await setup();
    await writeFile(join(nodeDir, "s.sh"), 'printf "%s" "$PECORE_JOB_TITLE" > title.txt; cat "$PECORE_INPUTS_SPEC_PATH"');
    const spec = join(nodeDir, "spec.json");
    await writeFile(spec, '{"criteria":[]}');
    const r = await runCommandNode(ctx(node({ script: "s.sh", inputs: ["spec"], outputs: ["check-log"], outputRules: { "check-log": { file: "title.txt" } } }), { inputs: [{ type: "spec", path: spec }] }));
    expect(r).toMatchObject({ kind: "completed", outcome: "passed", outputs: [{ type: "check-log", content: "Fix it" }] });
    expect(r.log).toContain('{"criteria":[]}');
  });

  it("reports timeout and a missing command", async () => {
    const { ctx } = await setup();
    expect(await runCommandNode(ctx(node({ command: ["sleep", "5"], timeoutSec: 1 })))).toMatchObject({ kind: "failed", reason: "TIMEOUT" });
    expect(await runCommandNode(ctx(node({ command: ["pecore-no-such-command"] })))).toMatchObject({ kind: "failed", reason: "COMMAND_NOT_FOUND" });
  });

  it("skips the command when the probe says done, waits when it cannot tell", async () => {
    const { project, ctx } = await setup();
    const marker = join(project, "ran");
    const n = (probe: string[]) => node({ command: ["touch", marker], probe, outputs: ["delivery"], outputRules: { delivery: { stdoutLastLine: "url" } } });
    expect(await runCommandNode(ctx(n(["echo", "https://x/pr/1"])))).toMatchObject({ kind: "completed", outcome: "passed", fromProbe: true, outputs: [{ type: "delivery", content: '{"url":"https://x/pr/1"}' }] });
    expect(await runCommandNode(ctx(n(["false"])))).toMatchObject({ kind: "waiting", reason: "network" });
    await expect(readFile(marker)).rejects.toThrow();
    expect(await runCommandNode(ctx(n(["true"])))).toMatchObject({ kind: "completed", fromProbe: false });
    expect(await readFile(marker, "utf8")).toBe("");
  });

  it("runs cleanCheckout nodes in a checkout of the content state, without ignored files", async () => {
    const { wd, ctx } = await setup();
    await writeFile(join(wd, ".gitignore"), "secret\n");
    await writeFile(join(wd, "secret"), "");
    await writeFile(join(wd, "a.txt"), "");
    const tree = await contentState(u, wd);
    const r = await runCommandNode(ctx(node({ command: ["/bin/sh", "-c", "test -f a.txt && test ! -f secret"], cleanCheckout: true }), { cleanTree: tree }));
    expect(r).toMatchObject({ kind: "completed", outcome: "passed" });
  });
});

describe("logs", () => {
  it("writes and reads a zstd JSONL log", async () => {
    const path = join(await tempDir(), "logs", "A1.jsonl.zst");
    const w = await LogWriter.open(path);
    w.write({ dir: "out", msg: { id: 1 }, at: 1 });
    w.write({ dir: "err", line: "boom", at: 2 });
    await w.close();
    expect(await readLog(path)).toEqual([
      { dir: "out", msg: { id: 1 }, at: 1 },
      { dir: "err", line: "boom", at: 2 },
    ]);
  });
});
