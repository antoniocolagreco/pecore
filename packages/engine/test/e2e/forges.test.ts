import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/main";
import { autoConfirm, until } from "../forge-project";
import { shippedLibrary, tempDir } from "../tmp";

type Request = { url: string; target: string };
type ForgeCase = {
  forge: "github" | "gitlab";
  tool: "gh" | "glab";
  host: string;
  createRepo: string;
  repo: string | undefined;
  user: string | undefined;
  requests(repo: string, branch: string): Request[];
};

const cases: ForgeCase[] = [
  {
    forge: "github",
    tool: "gh",
    host: "github.com",
    createRepo: "github-create-repo",
    repo: process.env.PECORE_E2E_GITHUB_REPO,
    user: process.env.PECORE_E2E_GITHUB_USER,
    requests: (repo, branch) =>
      (JSON.parse(execFileSync("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "url,baseRefName"], { encoding: "utf8" })) as { url: string; baseRefName: string }[]).map((r) => ({
        url: r.url,
        target: r.baseRefName,
      })),
  },
  {
    forge: "gitlab",
    tool: "glab",
    host: "gitlab.com",
    createRepo: "gitlab-create-repo",
    repo: process.env.PECORE_E2E_GITLAB_REPO,
    user: process.env.PECORE_E2E_GITLAB_USER,
    requests: (repo, branch) =>
      (JSON.parse(execFileSync("glab", ["mr", "list", "-R", repo, "--source-branch", branch, "--all", "--output", "json"], { encoding: "utf8" })) as { web_url: string; target_branch: string }[]).map((r) => ({
        url: r.web_url,
        target: r.target_branch,
      })),
  },
];

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
  name: "forge-e2e",
  description: "write, commit, push, pull or merge request",
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

const ended = (state: string) => ["succeeded", "failed", "not_delivered"].includes(state);

for (const c of cases) {
  describe.skipIf(!c.repo || !c.user)(`phase 4 gate: ${c.forge} delivery with the real ${c.tool} (e2e/forges)`, () => {
    it("creates the base branch if missing, opens one request per job, and delivers once after a kill during push", async () => {
      const repo = c.repo!;
      const url = `https://${c.host}/${repo}.git`;
      const remoteHead = (branch: string) => {
        const out = execFileSync("git", ["ls-remote", url, `refs/heads/${branch}`], { encoding: "utf8" }).trim();
        return out === "" ? null : out.split(/\s+/)[0]!;
      };
      const root = await tempDir();
      const home = join(root, "home");
      const library = join(root, "library");
      const bin = join(root, "bin");
      const flag = join(root, "hang-push");
      await cp(shippedLibrary, library, { recursive: true });
      await writeFile(join(library, "nodes", "write-job-file.json"), JSON.stringify(writeFileNode));
      await writeFile(join(library, "recipes", "forge-e2e.json"), JSON.stringify(recipe));
      await mkdir(bin);
      await writeFile(join(bin, "git"), gitWrapper(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim(), flag));
      await chmod(join(bin, "git"), 0o755);
      const path = process.env.PATH;
      process.env.PATH = `${bin}:${path}`;
      await mkdir(home, { recursive: true });
      await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [{ id: c.forge, kind: "forge", forge: c.forge, host: c.host, tool: c.tool, user: c.user, author: { name: "PeCore Test", email: "pecore-test@example.com" } }] }));

      let engine = await Engine.start({ home, library });
      await engine.createProject({ id: "e2e", name: "E2E", repo: { url, account: c.forge }, createRepo: c.createRepo, defaultRecipe: "forge-e2e" }, ["forge-e2e"]);
      let stopConfirm = autoConfirm(engine, "e2e");
      let p = engine.project("e2e");
      await until(async () => !(await exists(join(p.ctx.dir, "creating.json"))), 180_000);
      expect(remoteHead("main")).not.toBeNull();

      const first = await engine.createJob("e2e", { title: "PeCore e2e: one request", ticket: { text: "x" } });
      await until(() => ended(p.executor.job(first).state), 300_000);
      expect(p.executor.job(first)).toMatchObject({ state: "succeeded" });
      expect(c.requests(repo, `factory/${first}`)).toMatchObject([{ target: "main" }]);

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
      await until(() => ended(p.executor.job(second).state), 300_000);
      expect(p.executor.job(second)).toMatchObject({ state: "succeeded" });
      const commit = p.executor.artifacts(second).find((a) => a.type === "commit")!;
      const sha = (JSON.parse(await readFile(join(p.ctx.dir, commit.path), "utf8")) as { sha: string }).sha;
      expect(remoteHead(`factory/${second}`)).toBe(sha);
      expect(c.requests(repo, `factory/${second}`)).toHaveLength(1);
      expect(p.ctx.db.events(second).filter((e) => e.type === "effect.requested" && e.payload.node === "push")).toHaveLength(1);
      console.log(`${c.forge}: ${c.requests(repo, `factory/${first}`)[0]!.url} ${c.requests(repo, `factory/${second}`)[0]!.url}`);
      stopConfirm();
      await engine.shutdown();
      process.env.PATH = path;
    }, 900_000);
  });
}
