import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTestConfiguration } from "./configuration";
import { apiClient } from "@pecore/schemas";
import { handlers } from "../src/api/handlers";
import { startApi } from "../src/api/server";
import { Engine } from "../src/main";
import { createProjectWithRecipes } from "./project";
import { shippedTemplates, tempDir } from "./tmp";

const writeHello = {
  name: "write-hello",
  description: "writes hello.txt",
  kind: "command",
  command: ["/bin/sh", "-c", "echo hello > hello.txt && echo wrote hello"],
  outcomes: ["done"],
  changesFiles: true,
  outcomeRules: [{ exitCode: 0, outcome: "done" }],
  timeoutSec: 30,
};

const reviewed = {
  name: "reviewed",
  description: "write, human review, commit",
  start: "write",
  successOutcomes: ["commit:done"],
  nodes: { write: { use: "write-hello" }, human: { use: "human-review" }, commit: { use: "git-commit" } },
  edges: [
    { from: "write", on: "done", to: "human" },
    { from: "human", on: "approve", to: "commit" },
  ],
};

export async function apiProject(minFreeDiskGb?: number) {
  const root = await tempDir();
  const home = join(root, "home");
  const templates = join(root, "templates");
  await cp(shippedTemplates, templates, { recursive: true });
  await writeFile(join(templates, "nodes", "write-hello.json"), JSON.stringify(writeHello));
  await writeFile(join(templates, "recipes", "reviewed.json"), JSON.stringify(reviewed));
  if (minFreeDiskGb !== undefined) {
    await mkdir(home);
    await setTestConfiguration(home, "settings", { minFreeDiskGb });
  }
  const engine = await Engine.start({ home, templates });
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["reviewed"]);
  const api = await startApi(engine, { handlers: handlers("0.0.0-test"), validateResponses: true });
  const call = apiClient({ port: api.port, token: api.token });
  const close = async () => {
    await api.close();
    await engine.shutdown();
  };
  return { home, engine, api, call, close };
}
