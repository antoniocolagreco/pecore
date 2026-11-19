import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  async function newJob(title: string): Promise<void> {
    await page.getByRole("banner").getByRole("button", { name: "New job" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Recipe").selectOption("reviewed");
    await dialog.getByLabel("Ticket text").fill("x");
    await dialog.getByRole("button", { name: "Create" }).click();
    await dialog.waitFor({ state: "hidden" });
  }

  it("opens the job view: graph with node states and the log one click away", async () => {
    await go("#/jobs");
    await page.getByRole("row", { name: /Add hello/ }).getByText("Add hello").click();
    await visible(page.getByRole("tab", { name: "Graph" }).or(page.getByRole("button", { name: "Graph" })).first());
    await page.waitForTimeout(1000);
    await shot("jobview");
    await page.locator(".react-flow__node", { hasText: "write" }).first().click();
    await visible(page.getByText("wrote hello").first(), 15_000);
    await shot("jobview-log");
  }, 60_000);

  it("stops, resumes, stops, archives and deletes a job from its controls", async () => {
    await newJob("Controlled");
    await go("#/jobs");
    await page.getByRole("row", { name: /Controlled/ }).getByText("Controlled").click();
    await visible(page.getByText("Needs you").first(), 30_000);
    const control = (name: string) => page.getByRole("main").getByRole("button", { name, exact: true }).first();
    await control("Stop").click();
    await visible(page.getByText("Stopped").first(), 15_000);
    await control("Resume").click();
    await visible(page.getByText("Needs you").first(), 30_000);
    await control("Stop").click();
    await visible(page.getByText("Stopped").first(), 15_000);
    await control("Archive").click();
    await page.waitForTimeout(500);
    await control("Delete").click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await go("#/jobs");
    await page.getByRole("row", { name: /Add hello/ }).waitFor();
    await page.getByRole("row", { name: /Controlled/ }).waitFor({ state: "detached", timeout: 10_000 });
    await shot("after-delete");
  }, 90_000);

  it("turns the global pause on and off", async () => {
    await go("#/");
    await page.getByRole("button", { name: /Pause all/ }).click();
    await visible(page.getByText(/Global pause is on/));
    await page.getByRole("button", { name: /Play all/ }).click();
    await page.getByText(/Global pause is on/).waitFor({ state: "detached", timeout: 10_000 });
  }, 30_000);

  it("saves a setting", async () => {
    await go("#/settings");
    const section = page.locator("#mergeCheckSec");
    await section.getByLabel("Seconds").fill("120");
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.waitForTimeout(1000);
    await shot("settings");
    const settings = JSON.parse(await readFile(join(root, "home", "settings.json"), "utf8")) as { mergeCheckSec: number };
    if (settings.mergeCheckSec !== 120) throw new Error(`mergeCheckSec is ${settings.mergeCheckSec}`);
  }, 30_000);

  it("edits a node instance and opens the recipe editor", async () => {
    await go("#/edit/node/projects/demo/nodes/write-hello.json");
    const description = page.getByLabel("Description");
    await description.fill("writes hello.txt, edited");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(1000);
    await shot("node-editor");
    const node = JSON.parse(await readFile(join(root, "home", "projects", "demo", "nodes", "write-hello.json"), "utf8")) as { description: string };
    if (node.description !== "writes hello.txt, edited") throw new Error(`description is ${node.description}`);
    await go("#/edit/recipe/projects/demo/recipes/reviewed.json");
    await visible(page.locator(".react-flow__node", { hasText: "human" }).first(), 15_000);
    await shot("recipe-editor");
  }, 60_000);

  it("shows usage and the factory", async () => {
    await go("#/usage");
    await page.waitForTimeout(800);
    await shot("usage");
    await go("#/");
    await page.waitForTimeout(800);
    await shot("factory");
  }, 30_000);

  it("deletes the project from its page", async () => {
    await go("#/projects/demo");
    await page.getByRole("button", { name: /Delete project/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Delete/ }).last().click();
    await page.waitForTimeout(1500);
    await shot("project-deleted");
    const gone = await stat(join(root, "home", "projects", "demo")).then(
      () => false,
      () => true,
    );
    if (!gone) throw new Error("the project directory still exists");
  }, 30_000);
});
