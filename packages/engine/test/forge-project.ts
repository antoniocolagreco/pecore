import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Engine } from "../src/main";
import { FakeForge, forgeAccount } from "./fake-forge";
import { createProjectWithRecipes } from "./project";
import { shippedLibrary, tempDir } from "./tmp";

const writeSpec = {
  name: "write-spec",
  description: "writes hello.txt and a spec",
  kind: "command",
  command: ["/bin/sh", "-c", 'echo hello > hello.txt && mkdir -p .pecore && printf \'{"title":"Add hello"}\' > .pecore/spec.json'],
  outputs: ["spec"],
  outcomes: ["done"],
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  outputRules: { spec: { file: ".pecore/spec.json" } },
  timeoutSec: 30,
};

const deliver = {
  name: "deliver",
  description: "write, commit, push, pull request, issue comment",
  start: "write",
  successOutcomes: ["comment:done"],
  nodes: { write: { use: "write-spec" }, commit: { use: "git-commit" }, push: { use: "git-push" }, pr: { use: "github-pr" }, comment: { use: "github-issue-comment" } },
  edges: [
    { from: "write", on: "done", to: "commit" },
    { from: "commit", on: "done", to: "push" },
    { from: "push", on: "pushed", to: "pr" },
    { from: "pr", on: "opened", to: "comment" },
  ],
};

export async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 30000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function forgeHome() {
  const forge = await FakeForge.start();
  const root = await tempDir();
  const home = join(root, "home");
  const library = join(root, "library");
  await cp(shippedLibrary, library, { recursive: true });
  await writeFile(join(library, "nodes", "write-spec.json"), JSON.stringify(writeSpec));
  await writeFile(join(library, "recipes", "deliver.json"), JSON.stringify(deliver));
  await mkdir(home, { recursive: true });
  await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts: [forgeAccount] }));
  return { forge, home, library };
}

export async function forgeProject() {
  const h = await forgeHome();
  await h.forge.createRepo("acme/shop");
  const engine = await Engine.start({ home: h.home, library: h.library });
  await createProjectWithRecipes(engine, { id: "shop", name: "Shop", repo: { url: "https://github.com/acme/shop.git", account: forgeAccount.id } }, ["deliver"]);
  return { ...h, engine };
}
