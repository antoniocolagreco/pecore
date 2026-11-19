import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/main";
import { autoConfirm, until } from "../forge-project";
import { shippedLibrary, tempDir } from "../tmp";

const repo = process.env.PECORE_E2E_GITHUB_REPO;
const user = process.env.PECORE_E2E_GITHUB_USER;

const writeFileNode = {
  name: "write-job-file",
  description: "writes a file named after the job and a spec",
  kind: "command",
  command: ["/bin/sh", "-c", 'echo "$PECORE_JOB_ID" > "e2e-$PECORE_JOB_ID.txt" && mkdir -p .pecore && printf \'{"title":"PeCore e2e"}\' > .pecore/spec.json'],
  outputs: ["spec"],
  outcomes: ["done"],
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  outputRules: { spec: { file: ".pecore/spec.json" } },
  timeoutSec: 30,
};

const recipe = {
  name: "github-e2e",
  description: "write, commit, push, pull request",
  start: "write",
  successOutcomes: ["pr:opened"],
  nodes: { write: { use: "write-job-file" }, commit: { use: "git-commit" }, push: { use: "git-push" }, pr: { use: "github-pr" } },
  edges: [
    { from: "write", on: "done", to: "commit" },
    { from: "commit", on: "done", to: "push" },
    { from: "push", on: "pushed", to: "pr" },
  ],
};

const gitWrapper = (realGit: string, flag: string) => `#!/bin/sh
"${realGit}" "$@"
rc=$?
for a; do
  if [ "$a" = push ] && [ -f "${flag}" ]; then exec sleep 100000; fi
done
exit $rc
`;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

function remoteHead(branch: string): string | null {
  const out = execFileSync("git", ["ls-remote", `https://github.com/${repo}.git`, `refs/heads/${branch}`], { encoding: "utf8" }).trim();
  return out === "" ? null : out.split(/\s+/)[0]!;
}

function prs(branch: string): { url: string; baseRefName: string }[] {
  return JSON.parse(execFileSync("gh", ["pr", "list", "--repo", repo!, "--head", branch, "--state", "all", "--json", "url,baseRefName"], { encoding: "utf8" })) as { url: string; baseRefName: string }[];
}

describe.skipIf(!repo || !user)("phase 4 gate: GitHub delivery with the real gh (e2e/forges)", () => {
  it("creates the base branch if missing, opens one PR per job, and delivers once after a kill during push", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const library = join(root, "library");
    const bin = join(root, "bin");
    const flag = join(root, "hang-push");
    await cp(shippedLibrary, library, { recursive: true });
    await writeFile(join(library, "nodes", "write-job-file.json"), JSON.stringify(writeFileNode));
    await writeFile(join(library, "recipes", "github-e2e.json"), JSON.stringify(recipe));
    await mkdir(bin);
    await writeFile(join(bin, "git"), gitWrapper(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), flag));
    await chmod(join(bin, "git"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ id: "github", kind: "forge", forge: "github", host: "github.com", tool: "gh", user, author: { name: "PeCore Test", email: "pecore-test@example.com" } }] }));

    let engine = await Engine.start({ home, library });
    await engine.createProject({ id: "e2e", name: "E2E", repo: { url: `https://github.com/${repo}.git`, account: "github" }, createRepo: "github-create-repo", defaultRecipe: "github-e2e" }, ["github-e2e"]);
    let stopConfirm = autoConfirm(engine, "e2e");
    let p = engine.project("e2e");
    await until(async () => !(await exists(join(p.ctx.dir, "creating.json"))), 180_000);
    expect(remoteHead("main")).not.toBeNull();

    const first = await engine.createJob("e2e", { title: "PeCore e2e: one PR", ticket: { text: "x" } });
    await until(() => ["succeeded", "failed", "not_delivered"].includes(p.executor.job(first).state), 300_000);
    expect(p.executor.job(first)).toMatchObject({ state: "succeeded" });
    expect(prs(`factory/${first}`)).toMatchObject([{ baseRefName: "main" }]);

    await writeFile(flag, "");
    const second = await engine.createJob("e2e", { title: "PeCore e2e: kill during push", ticket: { text: "x" } });
    await until(() => p.ctx.db.events(second).some((e) => e.type === "effect.requested" && e.payload.node === "push"), 300_000);
    await new Promise((r) => setTimeout(r, 5000));
    stopConfirm();
    await engine.shutdown();
    await rm(flag);

    engine = await Engine.start({ home, library });
    p = engine.project("e2e");
    stopConfirm = autoConfirm(engine, "e2e");
    expect(p.executor.job(second)).toMatchObject({ state: "paused", waiting_reason: "quit" });
    await p.executor.play(second);
    await until(() => ["succeeded", "failed", "not_delivered"].includes(p.executor.job(second).state), 300_000);
    expect(p.executor.job(second)).toMatchObject({ state: "succeeded" });
    const commit = p.executor.artifacts(second).find((a) => a.type === "commit")!;
    const sha = (JSON.parse(await readFile(join(p.ctx.dir, commit.path), "utf8")) as { sha: string }).sha;
    expect(remoteHead(`factory/${second}`)).toBe(sha);
    expect(prs(`factory/${second}`)).toHaveLength(1);
    expect(p.ctx.db.events(second).filter((e) => e.type === "effect.requested" && e.payload.node === "push")).toHaveLength(1);
    console.log(`PRs: ${prs(`factory/${first}`)[0]!.url} ${prs(`factory/${second}`)[0]!.url}`);
    stopConfirm();
    await engine.shutdown();
  }, 900_000);
});
