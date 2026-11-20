import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import type { ElectronApplication, Locator, Page } from "playwright-core";
import { afterAll, beforeAll, describe, it } from "vitest";
import { initHome } from "../../engine/src/home/layout";
import { FakeForge, forgeAccount } from "../../engine/test/fake-forge";

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
  command: ["/bin/sh", "-c", "if [ -f config.txt ]; then sed -i 's/\"version\": 1/\"version\": 2/' config.txt; fi; echo hello > hello.txt && echo wrote hello"],
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

const deliverPr = {
  name: "deliver-pr",
  description: "write, commit, push, pull request",
  start: "write",
  successOutcomes: ["pr:opened"],
  nodes: { write: { use: "write-spec" }, commit: { use: "git-commit" }, push: { use: "git-push" }, pr: { use: "github-pr" } },
  edges: [
    { from: "write", on: "done", to: "commit" },
    { from: "commit", on: "done", to: "push" },
    { from: "push", on: "pushed", to: "pr" },
  ],
};

const visible = (l: Locator, timeout = 10_000) => l.waitFor({ state: "visible", timeout });
const choose = async (field: Locator, option: string) => {
  await field.click();
  await field.page().getByRole("option", { name: option, exact: true }).click();
};
const gui = !built || process.env.PECORE_GUI !== "1";

async function launch(root: string, nodes: Record<string, unknown>, recipes: Record<string, unknown>, accounts: unknown[] = [], prepare?: (home: string) => Promise<void>): Promise<{ app: ElectronApplication; page: Page }> {
  const home = join(root, "home");
  const library = join(root, "library");
  await cp(shippedLibrary, library, { recursive: true });
  for (const [name, node] of Object.entries(nodes)) await writeFile(join(library, "nodes", `${name}.json`), JSON.stringify(node));
  for (const [name, recipe] of Object.entries(recipes)) await writeFile(join(library, "recipes", `${name}.json`), JSON.stringify(recipe));
  await initHome(home, { library });
  await writeFile(join(home, "settings.json"), JSON.stringify({ firstRunDone: true }));
  if (accounts.length) await writeFile(join(home, "accounts.json"), JSON.stringify({ accounts }));
  await prepare?.(home);
  await mkdir(join(root, "ud"), { recursive: true });
  await writeFile(join(root, "ud", "home.json"), JSON.stringify({ home }));
  return open(root);
}

async function open(root: string): Promise<{ app: ElectronApplication; page: Page }> {
  const executable = (await import("electron")).default as unknown as string;
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[0] !== "ELECTRON_RUN_AS_NODE" && e[1] !== undefined));
  const app = await electron.launch({ executablePath: executable, args: [appDir, `--user-data-dir=${join(root, "ud")}`, "--ozone-platform=headless"], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  return { app, page };
}

describe.skipIf(gui)("phase 5 gate: G16 actions from the GUI (built app, headless)", () => {
  let root: string;
  let app: ElectronApplication;
  let page: Page;
  const go = (hash: string) => page.evaluate((h) => ((globalThis as unknown as { location: { hash: string } }).location.hash = h), hash);
  const shot = async (name: string) => {
    if (process.env.PECORE_GUI_SHOTS) await page.screenshot({ path: join(process.env.PECORE_GUI_SHOTS, `${name}.png`) });
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pecore-gui-"));
    ({ app, page } = await launch(root, { "write-hello": writeHello }, { reviewed }));
  }, 60_000);

  afterAll(async () => {
    await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it("creates a local project with the wizard", async () => {
    await go("#/projects/new");
    await page.getByLabel("Project ID").fill("demo");
    await page.getByLabel("Name").fill("Demo");
    await page.getByRole("radio", { name: /^Local only/ }).check();
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
    const seed = join(root, "seed");
    const repo = join(root, "home", "projects", "demo", "repo.git");
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: seed });
    execFileSync("git", ["clone", "-q", repo, seed]);
    await writeFile(join(seed, "config.txt"), ['{', '  "name": "demo",', '  "version": 1,', '  "debug": false', '}', ''].join("\n"));
    git("add", "config.txt");
    git("commit", "-q", "-m", "config");
    git("push", "-q", "origin", "HEAD:main");
    await go("#/jobs");
    await page.getByRole("banner").getByRole("button", { name: "New job" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Add hello");
    await choose(dialog.getByLabel("Recipe"), "reviewed");
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
    await choose(dialog.getByLabel("Recipe"), "reviewed");
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
    await control("More actions").click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.waitForTimeout(500);
    await control("More actions").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
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

  it("realigns a queued job onto another branch", async () => {
    execFileSync("git", ["push", "-q", "origin", "HEAD:release"], { cwd: join(root, "seed") });
    await go("#/");
    await page.getByRole("button", { name: /Pause all/ }).click();
    await visible(page.getByText(/Global pause is on/));
    await newJob("Queued");
    await go("#/jobs");
    await page.getByRole("row", { name: /Queued/ }).getByText("Queued").first().click();
    const control = (name: string) => page.getByRole("main").getByRole("button", { name, exact: true }).first();
    await control("More actions").click();
    await page.getByRole("menuitem", { name: "Realign" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Target branch/).fill("release");
    await dialog.getByRole("button", { name: "Realign" }).click();
    await dialog.waitFor({ state: "hidden" });
    await visible(page.getByText(/Base changed to/));
    await visible(page.getByRole("main").locator("code", { hasText: /^release$/ }).first());
    await shot("realigned");
    await control("Stop").click();
    await visible(page.getByText("Stopped").first(), 15_000);
    await go("#/");
    await page.getByRole("button", { name: /Play all/ }).click();
    await page.getByText(/Global pause is on/).waitFor({ state: "detached", timeout: 10_000 });
  }, 60_000);

  it("saves a setting", async () => {
    await go("#/settings");
    const section = page.locator("#mergeCheckSec");
    await section.getByLabel("Seconds").fill("120");
    await page.waitForTimeout(1500);
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

  it("confirms an engine node inline after instantiating it and after editing it", async () => {
    await go("#/library");
    await page.getByRole("row", { name: /^git-push / }).getByRole("button", { name: "Instantiate into project" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Project").selectOption("demo");
    await dialog.getByRole("button", { name: "Instantiate", exact: true }).click();
    await visible(page.getByText("Engine node").first(), 15_000);
    await shot("library-confirm");
    await page.getByRole("button", { name: "confirm", exact: true }).click();
    await page.getByText("Engine node").first().waitFor({ state: "detached", timeout: 10_000 });
    if (await dialog.count()) await page.keyboard.press("Escape");
    await go("#/edit/node/projects/demo/nodes/git-push.json");
    await page.getByLabel("Description").fill("pushes the job branch, edited");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await visible(page.getByText("Engine node").first(), 15_000);
    await shot("node-editor-confirm");
    await page.getByRole("button", { name: "confirm", exact: true }).click();
    await page.getByText("Engine node").first().waitFor({ state: "detached", timeout: 10_000 });
    const open = await page.evaluate(() => (globalThis as unknown as { pecore: { api(): Promise<{ port: number; token: string }> } }).pecore.api());
    const queue = (await (await fetch(`http://127.0.0.1:${open.port}/queue?state=open`, { headers: { authorization: `Bearer ${open.token}` } })).json()) as { kind: string }[];
    if (queue.some((item) => item.kind === "engine-node")) throw new Error("an engine-node confirmation is still open");
  }, 60_000);

  it("adds, moves and connects a node in the recipe editor", async () => {
    const file = join(root, "home", "projects", "demo", "recipes", "reviewed.json");
    await go("#/edit/recipe/projects/demo/recipes/reviewed.json");
    await visible(page.locator('.react-flow__node[data-id="human"]'), 15_000);
    await page.getByLabel("Node definition").selectOption("write-hello");
    await page.getByRole("button", { name: "Add node" }).click();
    const added = page.locator('.react-flow__node[data-id="write-hello"]');
    await visible(added);
    await page.getByRole("button", { name: "Recipe settings" }).click();
    let box = (await added.boundingBox())!;
    for (let still = 0; still < 3; ) {
      await page.waitForTimeout(150);
      const next = (await added.boundingBox())!;
      still = next.x === box.x && next.y === box.y ? still + 1 : 0;
      box = next;
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 140, { steps: 12 });
    await page.mouse.up();
    const from = (await page.locator('.react-flow__node[data-id="human"] .react-flow__handle.source').boundingBox())!;
    const to = (await added.locator(".react-flow__handle.target").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.mouse.up();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Outcome").fill("changes");
    await dialog.getByRole("button", { name: "Connect" }).click();
    await dialog.waitFor({ state: "hidden" });
    await shot("recipe-editor-dnd");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).and(page.locator(":disabled")).waitFor({ timeout: 10_000 });
    const recipe = JSON.parse(await readFile(file, "utf8")) as { nodes: Record<string, { use: string }>; edges: { from: string; on: string; to: string }[]; layout: Record<string, { x: number; y: number }> };
    if (recipe.nodes["write-hello"]?.use !== "write-hello") throw new Error(`nodes: ${JSON.stringify(recipe.nodes)}`);
    if (!recipe.edges.some((e) => e.from === "human" && e.on === "changes" && e.to === "write-hello")) throw new Error(`edges: ${JSON.stringify(recipe.edges)}`);
    const moved = recipe.layout["write-hello"];
    if (!moved || (moved.x === 600 && moved.y === 0)) throw new Error(`layout: ${JSON.stringify(recipe.layout)}`);
  }, 60_000);

  it("shows usage and the factory", async () => {
    await go("#/usage");
    await page.waitForTimeout(800);
    await shot("usage");
    await go("#/");
    await page.waitForTimeout(800);
    await shot("factory");
  }, 30_000);

  it("opens a screen and a job from the command palette", async () => {
    const input = page.getByPlaceholder("Search jobs, projects, definitions and screens");
    const pick = async (search: string, option: RegExp) => {
      await page.keyboard.press("Control+k");
      await visible(input);
      await input.fill(search, { timeout: 10_000 });
      await visible(page.getByRole("option", { name: option }).and(page.locator('[data-selected="true"]')));
      await page.keyboard.press("Enter");
    };
    await go("#/");
    await visible(page.getByRole("heading", { name: "Factory" }));
    await pick("Usage", /^Usage/);
    await page.waitForFunction(() => (globalThis as unknown as { location: { hash: string } }).location.hash === "#/usage", undefined, { timeout: 10_000 });
    await pick("Add hello", /^Add hello/);
    await shot("palette");
    await page.waitForFunction(() => (globalThis as unknown as { location: { hash: string } }).location.hash.startsWith("#/jobs/"), undefined, { timeout: 10_000 });
  }, 30_000);

  it("deletes the project from its page", async () => {
    await go("#/projects");
    await shot("projects");
    await go("#/projects/demo");
    await visible(page.getByLabel("Parallel jobs"));
    await shot("project-page");
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

describe.skipIf(gui)("phase 5 gate: forge actions from the GUI (fake gh)", () => {
  let root: string;
  let forge: FakeForge;
  let app: ElectronApplication;
  let page: Page;
  const go = (hash: string) => page.evaluate((h) => ((globalThis as unknown as { location: { hash: string } }).location.hash = h), hash);
  const shot = async (name: string) => {
    if (process.env.PECORE_GUI_SHOTS) await page.screenshot({ path: join(process.env.PECORE_GUI_SHOTS, `forge-${name}.png`) });
  };
  const confirmAll = async () => {
    const item = page.getByText("Engine node").first();
    await visible(item, 15_000);
    while (await item.count()) {
      await page.getByRole("button", { name: "confirm", exact: true }).first().click();
      await page.waitForTimeout(500);
    }
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pecore-gui-forge-"));
    forge = await FakeForge.start();
    await forge.set({ tokenValid: false });
    ({ app, page } = await launch(root, { "write-spec": writeSpec }, { "deliver-pr": deliverPr }, [forgeAccount]));
  }, 60_000);

  afterAll(async () => {
    await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  it("logs in the forge account, creates a project on a new GitHub repository, confirms nodes inline, delivers a PR and detects its merge", async () => {
    await go("#/settings");
    const accounts = page.locator("#accounts");
    await visible(accounts.getByText(/^(Logged out|Error)$/), 15_000);
    await accounts.getByRole("button", { name: "Check", exact: true }).click();
    await visible(accounts.getByText(/^(Logged out|Error)$/), 15_000);
    await accounts.getByRole("button", { name: "Log in", exact: true }).click();
    await visible(accounts.getByRole("link", { name: "Open login URL" }), 15_000);
    await visible(accounts.getByLabel("Login progress").getByText(/ABCD-1234/));
    await visible(accounts.getByLabel("Login progress").getByText(/state: logged_in/), 15_000);
    await visible(accounts.getByText(/^Logged in$/));
    await shot("forge-login");
    if (!(await forge.state()).tokenValid) throw new Error("gh auth login did not run");

    await go("#/projects/new");
    await page.getByLabel("Project ID").fill("shop");
    await page.getByLabel("Name").fill("Shop");
    await page.getByRole("radio", { name: /^New repository/ }).check();
    await page.getByLabel("New repository URL").fill("https://github.com/acme/shop.git");
    await choose(page.getByLabel("Forge account"), "gh-test · github.com");
    for (const r of ["feature", "bugfix"]) await page.getByRole("checkbox", { name: new RegExp(`^${r}`) }).uncheck();
    await shot("wizard");
    await page.getByRole("button", { name: "Create project" }).click();
    await visible(page.getByText("Engine node").first(), 30_000);
    await shot("wizard-confirm");
    await page.getByRole("button", { name: "confirm", exact: true }).click();
    await page.getByRole("button", { name: "Finish" }).click({ timeout: 30_000 });
    await page.waitForFunction(() => (globalThis as unknown as { location: { hash: string } }).location.hash === "#/projects/shop");
    if (!(await forge.state()).repos.includes("acme/shop")) throw new Error("the repository was not created");

    await go("#/library");
    await page.getByRole("row", { name: /^deliver-pr / }).getByRole("button", { name: "Instantiate into project" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Project").selectOption("shop");
    await dialog.getByRole("button", { name: "Instantiate", exact: true }).click();
    await confirmAll();
    if (await dialog.count()) await page.keyboard.press("Escape");

    await go("#/jobs");
    await page.getByRole("banner").getByRole("button", { name: "New job" }).click();
    const create = page.getByRole("dialog");
    await choose(create.getByLabel("Project"), "Shop");
    await create.getByLabel("Title").fill("Deliver hello");
    await choose(create.getByLabel("Recipe"), "deliver-pr");
    await create.getByLabel("Ticket text").fill("Please add hello.txt");
    await create.getByRole("button", { name: "Create" }).click();
    await create.waitFor({ state: "hidden" });
    await go("#/jobs");
    await visible(page.getByRole("row", { name: /Deliver hello/ }).getByText("Success"), 60_000);
    await page.getByRole("row", { name: /Deliver hello/ }).getByText("Deliver hello").click();

    const check = page.getByRole("button", { name: "Check merge" });
    await check.click();
    await visible(page.getByRole("status").filter({ hasText: "Merge not detected." }));
    const state = await forge.state();
    await forge.set({ prs: state.prs.map((pr) => ({ ...pr, state: "MERGED" as const })) });
    await check.click();
    await visible(page.getByText("Merged", { exact: true }), 15_000);
    await shot("merged");
  }, 180_000);
});

const fakeAgent = fileURLToPath(new URL("../../agents/test/fake-agent/agent.mjs", import.meta.url));
const shim = fileURLToPath(new URL("../../agents/scripts/orchestrator-mcp.mjs", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const init = (image: boolean) => [
  { expect: "initialize" },
  { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} }, promptCapabilities: { image } } } } },
];
const reply = (text: string) => [
  { send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } } },
  { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn" } } },
];
const resume = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];

function mcp(tokenFile: string) {
  const child = spawn(process.execPath, [shim, tokenFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
  let next = 1;
  const rpc = async (method: string, params: unknown) => {
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: next++, method, params }) + "\n");
    return JSON.parse((await lines.next()).value as string) as { result?: unknown; error?: unknown };
  };
  return { rpc, close: () => child.stdin!.end() };
}

describe.skipIf(gui)("phase 6: orchestrator chat from the GUI (fake agent)", () => {
  let root: string;
  let app: ElectronApplication;
  let page: Page;
  const realHome = process.env.HOME;
  const go = (hash: string) => page.evaluate((h) => ((globalThis as unknown as { location: { hash: string } }).location.hash = h), hash);
  const shot = async (name: string) => {
    if (process.env.PECORE_GUI_SHOTS) await page.screenshot({ path: join(process.env.PECORE_GUI_SHOTS, `chat-${name}.png`) });
  };
  const until = async (fn: () => Promise<boolean>, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!(await fn())) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const exists = (path: string) => stat(path).then(() => true, () => false);
  const spawns = async () => Number(await readFile(join(root, "script-0.jsonl.count"), "utf8").catch(() => "0"));

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "pecore-gui-chat-"));
    process.env.HOME = join(root, "user");
    await mkdir(process.env.HOME);
    const scripts = [
      init(true),
      init(true),
      [...init(true), { expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } },
        { expect: "session/prompt" }, { dump: join(root, "turn1.json") },
        { waitFile: join(root, "stream1") }, reply("Two jobs")[0]!,
        { waitFile: join(root, "done1") }, ...reply(" created.")],
      [...init(true), ...resume, { expect: "session/prompt" }, { dump: join(root, "turn2.json") }, { sleep: 600_000 }],
      init(false),
      init(false),
      [...init(false), ...resume, { expect: "session/prompt" }, ...reply("Retried.")],
    ];
    const files: string[] = [];
    for (const [i, s] of scripts.entries()) {
      files.push(join(root, `script-${i}.jsonl`));
      await writeFile(files[i]!, s.map((x) => JSON.stringify(x)).join("\n") + "\n");
    }
    ({ app, page } = await launch(root, { "write-hello": writeHello }, { reviewed }, [{ id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" }], async (home) => {
      await mkdir(join(home, "connectors"), { recursive: true });
      await writeFile(join(home, "connectors", "fake.json"), JSON.stringify({ name: "fake", title: "Fake", kind: "native", harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" }, command: ["{harnessPath}", fakeAgent], env: { FAKE_AGENT_SCRIPT: files.join(",") }, reader: "claude-code" }));
      await writeFile(join(home, "profiles.json"), JSON.stringify({ profiles: [{ id: "p1", account: "fake", model: "m1" }] }));
      await writeFile(join(home, "settings.json"), JSON.stringify({ firstRunDone: true, orchestrator: { profile: "p1" } }));
    }));
  }, 60_000);

  afterAll(async () => {
    await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
    process.env.HOME = realHome;
    await rm(root, { recursive: true, force: true });
  });

  it("creates a conversation, sends a message with an image, shows the actions and the reply, and counts it unread while away", async () => {
    await go("#/projects/new");
    await page.getByLabel("Project ID").fill("demo");
    await page.getByLabel("Name").fill("Demo");
    await page.getByRole("radio", { name: /^Local only/ }).check();
    for (const r of ["feature", "bugfix"]) await page.getByRole("checkbox", { name: new RegExp(`^${r}`) }).uncheck();
    await page.getByRole("button", { name: "Create project" }).click();
    await visible(page.getByRole("button", { name: /Finish|Skip/ }).first(), 30_000);

    await page.getByRole("link", { name: "Orchestrator" }).click();
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByLabel("Title").fill("Orders");
    await page.getByRole("button", { name: "Create conversation" }).click();
    await visible(page.getByRole("heading", { name: "Orders" }));
    const chatId = decodeURIComponent((await page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)).split("/").at(-1)!);
    const attach = page.getByLabel("Attach images");
    await until(() => attach.isEnabled());
    await attach.setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: png });
    await visible(page.getByLabel("Selected images").getByText(/shot\.png/));
    await page.getByRole("textbox", { name: "Message" }).fill("Add an API and a UI job to demo");
    await until(async () => (await spawns()) === 2);
    await page.getByRole("button", { name: "Send" }).click();
    await until(() => exists(join(root, "turn1.json")));
    const prompt = JSON.parse(await readFile(join(root, "turn1.json"), "utf8")) as { params: { prompt: { type: string; mimeType?: string }[] } };
    if (!prompt.params.prompt.some((b) => b.type === "image" && b.mimeType === "image/png")) throw new Error("no image block in the prompt");
    const log = page.getByRole("log", { name: "Conversation messages" });
    await visible(log.getByText("Running"));
    await visible(log.getByLabel("Message attachments").getByText(/image\/png/));
    await shot("running");

    const m = mcp(join(process.env.HOME!, ".pecore-chats", chatId, "mcp-token"));
    await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const created = await m.rpc("tools/call", { name: "create_jobs", arguments: { project: "demo", plan: [{ key: "api", title: "API", ticketText: "add the endpoint", dependsOn: [] }, { key: "ui", title: "UI", ticketText: "add the screen", dependsOn: ["api"] }] } });
    m.close();
    if (created.error) throw new Error(JSON.stringify(created.error));

    await writeFile(join(root, "stream1"), "");
    await visible(log.getByText("Two jobs", { exact: true }));
    await go("#/jobs");
    await writeFile(join(root, "done1"), "");
    await visible(page.getByRole("link", { name: /Orchestrator/ }).getByLabel("1 unread"), 15_000);
    await page.getByRole("link", { name: /Orchestrator/ }).click();
    await page.getByText("Orders").first().click();
    await visible(log.getByText("Two jobs created."));
    await until(async () => (await page.getByRole("link", { name: /Orchestrator/ }).getByLabel(/unread/).count()) === 0);
    const jobLinks = log.getByRole("link", { name: /^Job / });
    await shot("replied");
    await until(async () => (await jobLinks.count()) === 2);
    await jobLinks.first().click();
    await until(async () => (await page.evaluate(() => (globalThis as unknown as { location: { hash: string } }).location.hash)).startsWith("#/jobs/"));
  }, 120_000);

  it("shows a turn cut by an app restart as interrupted, reruns it with Retry, and disables images the orchestrator cannot read", async () => {
    await page.getByRole("link", { name: /Orchestrator/ }).click();
    await page.getByText("Orders").first().click();
    await visible(page.getByRole("heading", { name: "Orders" }));
    await page.getByRole("textbox", { name: "Message" }).fill("One more job");
    await page.getByRole("button", { name: "Send" }).click();
    await until(() => exists(join(root, "turn2.json")));
    const closed = new Promise<void>((r) => app.once("close", () => r()));
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
    await closed;

    ({ app, page } = await open(root));
    await page.getByRole("link", { name: /Orchestrator/ }).click();
    await page.getByText("Orders").first().click();
    const log = page.getByRole("log", { name: "Conversation messages" });
    await visible(log.getByText("Interrupted"), 15_000);
    await until(() => page.getByLabel("Attach images").isDisabled());
    await until(async () => (await spawns()) === 6);
    await shot("interrupted");
    await log.getByRole("button", { name: "Retry" }).click();
    await visible(log.getByText("Retried."), 15_000);
    await shot("retried");
  }, 120_000);
});
