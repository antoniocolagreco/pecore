import { cp, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Engine } from "../../src/main";
import { gitApp } from "../../src/workdir/git-as";
import { createProjectWithRecipes } from "../project";
import { shippedLibrary, tempDir } from "../tmp";

const tsFiles = (body: string) => `set -e
mkdir -p src
printf 'node_modules/\\n' > .gitignore
cat > package.json <<'EOF'
{ "name": "fixture", "private": true, "type": "module", "devDependencies": { "typescript": "6.0.3", "vitest": "5.1.0" } }
EOF
cat > tsconfig.json <<'EOF'
{ "compilerOptions": { "strict": true, "module": "nodenext", "target": "es2022", "noEmit": true, "types": [] }, "include": ["src"] }
EOF
cat > src/add.ts <<'EOF'
${body}
EOF
cat > src/add.test.ts <<'EOF'
import { expect, it } from "vitest";
import { add } from "./add.js";
it("adds", () => { expect(add(2, 3)).toBe(5); });
EOF
npm install --no-audit --no-fund --silent
`;

const rustFiles = (body: string) => `set -e
mkdir -p src
printf 'target/\\n' > .gitignore
cat > Cargo.toml <<'EOF'
[package]
name = "fixture"
version = "0.1.0"
edition = "2021"
EOF
cat > src/lib.rs <<'EOF'
${body}

#[cfg(test)]
mod tests {
    #[test]
    fn adds() {
        assert_eq!(super::add(2, 3), 5);
    }
}
EOF
cargo generate-lockfile --offline
`;

const writer = (name: string, script: string) => ({
  name,
  description: `writes the ${name} fixture`,
  kind: "command",
  command: ["/bin/sh", "-c", script],
  outcomes: ["done"],
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  timeoutSec: 600,
});

const nodes = [
  writer("write-ts", tsFiles("export const add = (a: number, b: number): number => a + b;")),
  writer("write-ts-broken", tsFiles('export const add = (a: number, b: number): number => a + b + "";')),
  writer("write-rust", rustFiles("pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}")),
  writer("write-rust-broken", rustFiles("pub fn add(a: i32, b: i32) -> i32 {\n    a - b\n}")),
];

const shape = (name: string, write: string, check: string, test: string) => ({
  name,
  description: "write, type check, test, commit",
  start: "write",
  successOutcomes: ["commit:done"],
  nodes: { write: { use: write }, check: { use: check }, test: { use: test }, commit: { use: "git-commit", requires: ["check", "test"] } },
  edges: [
    { from: "write", on: "done", to: "check" },
    { from: "check", on: "passed", to: "test" },
    { from: "test", on: "passed", to: "commit" },
  ],
});

const recipes = [
  shape("ts", "write-ts", "typecheck", "vitest"),
  shape("ts-broken", "write-ts-broken", "typecheck", "vitest"),
  shape("rust", "write-rust", "cargo-check", "cargo-test"),
  shape("rust-broken", "write-rust-broken", "cargo-check", "cargo-test"),
];

async function until<T>(fn: () => T | undefined | false, ms: number): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function run(recipe: string) {
  const root = await tempDir();
  const library = join(root, "library");
  await cp(shippedLibrary, library, { recursive: true });
  for (const n of nodes) await writeFile(join(library, "nodes", `${n.name}.json`), JSON.stringify(n));
  for (const r of recipes) await writeFile(join(library, "recipes", `${r.name}.json`), JSON.stringify(r));
  const engine = await Engine.start({ home: join(root, "home"), library });
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null, defaultRecipe: recipe }, [recipe]);
  const project = engine.project("demo");
  const id = await engine.createJob("demo", { title: "Add add", ticket: { text: "add two numbers" } });
  await until(() => ["succeeded", "failed"].includes(project.executor.job(id).state), 600_000);
  const runs = project.ctx.db.db.prepare("SELECT node, outcome FROM node_runs WHERE job_id = ? ORDER BY rowid").all(id);
  return { engine, project, id, runs };
}

describe("G2: the same recipe shape on a TypeScript and a Rust project, with different check nodes", () => {
  for (const [lang, files] of [["ts", ["package-lock.json", "package.json", "src/add.test.ts", "src/add.ts", "tsconfig.json"]], ["rust", ["Cargo.lock", "Cargo.toml", "src/lib.rs"]]] as const) {
    it(`${lang}: write, check and test pass, and the commit holds the sources without build output`, async () => {
      const { engine, project, id, runs } = await run(lang);
      expect(project.executor.job(id).state).toBe("succeeded");
      expect(runs).toEqual([
        { node: "write", outcome: "done" },
        { node: "check", outcome: "passed" },
        { node: "test", outcome: "passed" },
        { node: "commit", outcome: "done" },
      ]);
      const tree = (await gitApp(join(project.ctx.dir, "repo.git"), ["ls-tree", "-r", "--name-only", `factory/${id}`])).trim().split("\n").sort();
      expect(tree).toEqual([".gitignore", ...files]);
      expect(await readdir(join(project.ctx.dir, "work"))).toEqual([]);
      await engine.shutdown();
    }, 900_000);
  }

  it("ts: a type error fails the job at the type check", async () => {
    const { engine, project, id, runs } = await run("ts-broken");
    expect(project.executor.job(id).state).toBe("failed");
    expect(runs).toEqual([
      { node: "write", outcome: "done" },
      { node: "check", outcome: "failed" },
    ]);
    await engine.shutdown();
  }, 900_000);

  it("rust: a wrong result fails the job at the tests, after cargo check passes", async () => {
    const { engine, project, id, runs } = await run("rust-broken");
    expect(project.executor.job(id).state).toBe("failed");
    expect(runs).toEqual([
      { node: "write", outcome: "done" },
      { node: "check", outcome: "passed" },
      { node: "test", outcome: "failed" },
    ]);
    await engine.shutdown();
  }, 900_000);
});
