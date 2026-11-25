import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Engine } from "../src/main";
import { setTestConfiguration } from "./configuration";
import { FakeForge, forgeAccount } from "./fake-forge";
import { createProjectWithRecipes } from "./project";
import { shippedTemplates, tempDir } from "./tmp";

const writeSpec = {
  name: "write-spec",
  description: "writes hello.txt and a spec",
  kind: "command",
  command: ["/bin/sh", "-c", 'echo hello > hello.txt && mkdir -p .pecore && printf \'{"criteria":["Add hello"],"tests":[],"interfaces":[]}\' > .pecore/spec.json'],
  outcomes: ["done"],
  outputs: { done: "spec" },
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  outputRules: { done: { file: ".pecore/spec.json" } },
  timeoutSec: 30,
};

const deliver = {
  name: "deliver",
  description: "write, commit, push, pull request, issue comment",
  start: "write",
  successOutcomes: ["comment:success"],
  nodes: { write: { use: "write-spec" }, commit: { use: "git-commit" }, push: { use: "git-push" }, pr: { use: "github-pr", reads: ["write"] }, comment: { use: "github-issue-comment", reads: ["pr"] } },
  edges: [
    { from: "write", on: "done", to: "commit" },
    { from: "commit", on: "success", to: "push" },
    { from: "push", on: "success", to: "pr" },
    { from: "pr", on: "success", to: "comment" },
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
  const templates = join(root, "templates");
  await cp(shippedTemplates, templates, { recursive: true });
  await writeFile(join(templates, "nodes", "write-spec.json"), JSON.stringify(writeSpec));
  await writeFile(join(templates, "recipes", "deliver.json"), JSON.stringify(deliver));
  await mkdir(home, { recursive: true });
  await setTestConfiguration(home, "accounts", { accounts: [forgeAccount] });
  return { forge, home, templates };
}

export async function forgeProject() {
  const h = await forgeHome();
  await h.forge.createRepo("acme/shop");
  const engine = await Engine.start({ home: h.home, templates: h.templates });
  await createProjectWithRecipes(engine, { id: "shop", name: "Shop", repo: { url: "https://github.com/acme/shop.git", account: forgeAccount.id } }, ["deliver"]);
  return { ...h, engine };
}
