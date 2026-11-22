import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectWithRecipes } from "../../test/project";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { Engine } from "../main";
import { gitApp } from "../workdir/git-as";
import { branchHead, createLocalRepo } from "../workdir/repo";
import { JobServices } from "./job-services";
import { composeProjectName } from "./runtime";

function ready(): boolean {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    execFileSync("docker", ["image", "inspect", "alpine:latest"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const compose = `services:
  web:
    image: alpine:latest
    command: ["sleep", "300"]
    ports:
      - "127.0.0.1::8080"
    healthcheck:
      test: ["CMD", "true"]
      interval: 1s
`;

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

function composeProjects(jobId: string): string {
  return execFileSync("docker", ["compose", "ls", "--all", "--filter", `name=${composeProjectName(jobId)}`, "--format", "json"], { encoding: "utf8" });
}

describe.skipIf(!ready())("job services (4.9)", () => {
  it("starts Compose directly, passes the ports to nodes, and removes it at the end", async () => {
    const root = await tempDir();
    const marker = join(root, "port");
    const home = join(root, "home");
    const lib = join(root, "templates");
    await cp(shippedTemplates, lib, { recursive: true });
    await writeFile(
      join(lib, "nodes", "read-port.json"),
      JSON.stringify({
        name: "read-port",
        description: "writes the service address",
        kind: "command",
        command: ["/bin/sh", "-c", `printf %s "$PECORE_SERVICE_WEB_8080" > ${marker}`],
        outcomes: ["done"],
        changesFiles: false,
        outcomeRules: [{ exitCode: 0, outcome: "done" }],
        timeoutSec: 30,
      }),
    );
    await writeFile(join(lib, "recipes", "svc.json"), JSON.stringify({ name: "svc", description: "reads a port", start: "read", successOutcomes: ["read:done"], nodes: { read: { use: "read-port" } } }));
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "settings.json"), JSON.stringify({ servicesRuntime: "docker" }));
    const engine = await Engine.start({ home, templates: lib });
    await createProjectWithRecipes(engine, { id: "svc", name: "Svc", repo: null, services: "compose.yaml" }, ["svc"]);
    const p = engine.project("svc");
    const repo = join(p.ctx.dir, "repo.git");
    const blob = (await gitApp(repo, ["hash-object", "-w", "--stdin"], { input: compose })).trim();
    const tree = (await gitApp(repo, ["mktree"], { input: `100644 blob ${blob}\tcompose.yaml\n` })).trim();
    const commit = (await gitApp(repo, ["commit-tree", tree, "-p", (await branchHead(repo, "main"))!, "-m", "compose"])).trim();
    await gitApp(repo, ["update-ref", "refs/heads/main", commit]);

    const id = await engine.createJob("svc", { title: "t", ticket: { text: "x" } });
    await until(() => p.executor.job(id).state === "succeeded");
    expect(await readFile(marker, "utf8")).toMatch(/^127\.0\.0\.1:\d+$/);
    await until(() => composeProjects(id).trim() === "[]");
    await engine.shutdown();
  }, 120_000);

  it("with no compose path, finds docker-compose.yml at the repository root (decision 78)", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const lib = join(root, "templates");
    await cp(shippedTemplates, lib, { recursive: true });
    await writeFile(join(lib, "nodes", "noop.json"), JSON.stringify({
      name: "noop", description: "does nothing", kind: "command", command: ["true"], outcomes: ["done"], changesFiles: false, outcomeRules: [{ exitCode: 0, outcome: "done" }], timeoutSec: 30,
    }));
    await writeFile(join(lib, "recipes", "noop.json"), JSON.stringify({ name: "noop", description: "one node", start: "n", successOutcomes: ["n:done"], nodes: { n: { use: "noop" } } }));
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "settings.json"), JSON.stringify({ servicesRuntime: "docker" }));
    const engine = await Engine.start({ home, templates: lib });
    await createProjectWithRecipes(engine, { id: "auto", name: "Auto", repo: null }, ["noop"]);
    const p = engine.project("auto");
    await commitFile(join(p.ctx.dir, "repo.git"), "docker-compose.yml", compose);
    const id: string = await engine.createJob("auto", { title: "t", ticket: { text: "x" } });
    await until(() => p.executor.job(id).state === "succeeded");
    expect(p.ctx.db.events(id)).toContainEqual(expect.objectContaining({ type: "job.state_changed", payload: { state: "waiting", reason: "services" } }));
    await engine.shutdown();
  }, 120_000);
});

async function commitFile(repo: string, name: string, content: string): Promise<string> {
  const blob = (await gitApp(repo, ["hash-object", "-w", "--stdin"], { input: content })).trim();
  const tree = (await gitApp(repo, ["mktree"], { input: `100644 blob ${blob}\t${name}\n` })).trim();
  const commit = (await gitApp(repo, ["commit-tree", tree, "-p", (await branchHead(repo, "main"))!, "-m", name])).trim();
  await gitApp(repo, ["update-ref", "refs/heads/main", commit]);
  return commit;
}

describe("automatic compose file (decision 78)", () => {
  async function services(runtime: "docker" | null, file: string | null) {
    const dir = await tempDir();
    const repo = join(dir, "repo.git");
    await createLocalRepo(repo, "main");
    const base = file === null ? (await branchHead(repo, "main"))! : await commitFile(repo, file, compose);
    return { base, jobs: new JobServices(dir, () => null, () => runtime) };
  }

  it("starts nothing when no services runtime is set, even with a compose file", async () => {
    const { base, jobs } = await services(null, "compose.yaml");
    expect(await jobs.ensure("j1", base, () => { throw new Error("started"); })).toEqual({});
  });

  it("starts nothing when the repository has no standard compose file", async () => {
    const { base, jobs } = await services("docker", "other.yaml");
    expect(await jobs.ensure("j1", base, () => { throw new Error("started"); })).toEqual({});
  });
});
