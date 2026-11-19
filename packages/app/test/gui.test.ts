import { cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import type { ElectronApplication, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { initHome } from "../../engine/src/home/layout";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const built = await stat(join(appDir, "out/main/index.js")).then(
  () => true,
  () => false,
);
const shippedLibrary = join(appDir, "resources/library");

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

const visible = (l: Locator, timeout = 10_000) => l.waitFor({ state: "visible", timeout });

describe.skipIf(!built || process.env.PECORE_GUI !== "1")("phase 5 gate: G16 actions from the GUI (built app, headless)", () => {
  let root: string;
  let app: ElectronApplication;
  let page: Page;
  const go = (hash: string) => page.evaluate((h) => ((globalThis as unknown as { location: { hash: string } }).location.hash = h), hash);
  const shot = async (name: string) => {
    if (process.env.PECORE_GUI_SHOTS) await page.screenshot({ path: join(process.env.PECORE_GUI_SHOTS, `${name}.png`) });
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pecore-gui-"));
    const home = join(root, "home");
    const library = join(root, "library");
    await cp(shippedLibrary, library, { recursive: true });
    await writeFile(join(library, "nodes", "write-hello.json"), JSON.stringify(writeHello));
    await writeFile(join(library, "recipes", "reviewed.json"), JSON.stringify(reviewed));
    await initHome(home, { library });
    await writeFile(join(home, "settings.json"), JSON.stringify({ firstRunDone: true }));
    await mkdir(join(root, "ud"), { recursive: true });
    await writeFile(join(root, "ud", "home.json"), JSON.stringify({ home }));
    const executable = (await import("electron")).default as unknown as string;
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[0] !== "ELECTRON_RUN_AS_NODE" && e[1] !== undefined));
    app = await electron.launch({ executablePath: executable, args: [appDir, `--user-data-dir=${join(root, "ud")}`, "--ozone-platform=headless"], env });
    page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
  }, 60_000);

  afterAll(async () => {
    await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it("creates a local project with the wizard", async () => {
    await go("#/projects/new");
    await page.getByLabel("Project ID").fill("demo");
    await page.getByLabel("Name").fill("Demo");
    await page.getByLabel("Local only").check();
    for (const r of ["feature", "bugfix"]) await page.getByRole("checkbox", { name: new RegExp(`^${r}`) }).uncheck();
    await page.getByRole("button", { name: "Create project" }).click();
    await visible(page.getByRole("button", { name: /Finish|Skip/ }).first(), 30_000);
    await go("#/projects");
    await visible(page.getByText("Demo").first());
  }, 60_000);

  it("instantiates a recipe template from the Library into the project", async () => {
    await go("#/library");
    await page.waitForTimeout(1500);
    await shot("library");
    const row = page.getByRole("row", { name: /^reviewed / });
    await row.getByRole("button", { name: "Instantiate into project" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Project").selectOption("demo");
    await shot("instantiate-dialog");
    await dialog.getByRole("button", { name: "Instantiate", exact: true }).click({ timeout: 10_000 });
    await visible(page.getByText("projects/demo/recipes/reviewed.json"), 15_000);
  }, 30_000);

  it("creates a job, approves its review in the Inbox and sees it succeed", async () => {
    await go("#/jobs");
    await page.getByRole("banner").getByRole("button", { name: "New job" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Add hello");
    await dialog.getByLabel("Recipe").selectOption("reviewed");
    await dialog.getByLabel("Ticket text").fill("Please add hello.txt");
    await dialog.getByRole("button", { name: "Create" }).click();
    await go("#/jobs");
    await visible(page.getByText("Needs you").first(), 30_000);
    await go("#/inbox");
    await page.getByText(/Human review/).first().click();
    await shot("inbox");
    await page.getByRole("button", { name: "approve" }).click();
    await page.waitForTimeout(1000);
    await shot("inbox-after");
    await go("#/jobs");
    await visible(page.getByRole("row", { name: /Add hello/ }).getByText("Success"), 30_000);
    await shot("jobs");
  }, 90_000);
});
