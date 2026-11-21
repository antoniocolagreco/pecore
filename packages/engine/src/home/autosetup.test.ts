import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
import { fakeHarnesses } from "../../test/fake-harness";
import type { FakeHarness } from "../../test/fake-harness";
import { until } from "../../test/forge-project";
import { shippedLibrary, tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";
import { git } from "./git-commit";

type Notice = { kind: string; title: string; body: string };

const claude: FakeHarness = {
  version: "2.1.400",
  email: "dev@example.test",
  defaultModel: "claude-sonnet-9",
  models: { "claude-sonnet-9": ["low", "medium", "high"], "claude-opus-9": ["default", "low", "medium", "high", "max"], "claude-haiku-9": [] },
};

const codex: FakeHarness = {
  version: "0.170.0",
  email: "dev@example.test",
  variants: true,
  defaultModel: "gpt-9",
  models: { "gpt-9": ["low", "medium", "high"], "gpt-9-pro": ["high", "xhigh"], "gpt-9-mini": ["low", "medium"] },
};

const opencode: FakeHarness = {
  version: "2.4.0",
  email: null,
  defaultModel: "opencode/big-pickle",
  cliModels: ["openrouter/qwen/qwen3-max", "opencode/big-pickle", "openrouter/deepseek/deepseek-v4-flash"],
  models: { "opencode/big-pickle": ["low", "high"], "openrouter/qwen/qwen3-max": ["low", "medium", "high"], "openrouter/deepseek/deepseek-v4-flash": ["minimal", "low"] },
};

const opencodeConfig = `{
  // chosen in opencode
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/big-pickle",
}
`;

const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

beforeEach(() => {
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  process.env.HOME = saved.HOME;
  if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
});

async function setup() {
  const root = await tempDir();
  const home = join(root, "home");
  process.env.HOME = join(root, "user");
  await mkdir(join(process.env.HOME, ".config", "opencode"), { recursive: true });
  await writeFile(join(process.env.HOME, ".config", "opencode", "opencode.jsonc"), opencodeConfig);
  const harnesses = await fakeHarnesses(root);
  const notices: Notice[] = [];
  const start = async () => {
    const engine = await Engine.start({
      home,
      library: shippedLibrary,
      agents: { connectorsDir: harnesses.connectorsDir, adaptersDir: join(root, "adapters"), adapters: {} },
      notify: (n) => notices.push(n),
    });
    const api = await startApi(engine, { handlers: handlers("0.0.0-test"), validateResponses: true });
    const call = apiClient({ port: api.port, token: api.token });
    return { engine, call, close: async () => { await api.close(); await engine.shutdown(); } };
  };
  const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(join(home, file), "utf8"));
  const text = (file: string): Promise<string | null> => readFile(join(home, file), "utf8").catch(() => null);
  const head = async (): Promise<string> => (await git(home, ["log", "-1", "--format=%H %s"])).trim();
  return { home, harnesses, notices, start, json, text, head };
}

describe("auto-setup", () => {
  it("sets up every logged-in harness at start with models and efforts read from the harness", async () => {
    const s = await setup();
    await s.harnesses.set("claude-code", claude);
    await s.harnesses.set("codex", codex);
    await s.harnesses.set("opencode", opencode);
    await mkdir(s.home, { recursive: true });
    await writeFile(join(s.home, "settings.json"), JSON.stringify({ firstRunDone: true }));
    const app = await s.start();

    expect(await s.json("accounts.json")).toEqual({
      accounts: [
        expect.objectContaining({ id: "claude-code", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" }),
        expect.objectContaining({ id: "codex", kind: "model", provider: "openai", connector: "codex", login: "subscription" }),
        expect.objectContaining({ id: "opencode", kind: "model", provider: "opencode", connector: "opencode", login: "subscription" }),
      ],
    });
    const profiles = [
      { id: "claude-code-frontier", account: "claude-code", model: "claude-opus-9", effort: "max" },
      { id: "claude-code-strong", account: "claude-code", model: "claude-sonnet-9", effort: "high" },
      { id: "claude-code-standard", account: "claude-code", model: "claude-sonnet-9", effort: "medium" },
      { id: "claude-code-cheap", account: "claude-code", model: "claude-haiku-9", effort: null },
      { id: "codex-frontier", account: "codex", model: "gpt-9-pro", effort: "xhigh" },
      { id: "codex-strong", account: "codex", model: "gpt-9", effort: "high" },
      { id: "codex-standard", account: "codex", model: "gpt-9", effort: "medium" },
      { id: "codex-cheap", account: "codex", model: "gpt-9-mini", effort: "low" },
      { id: "opencode-frontier", account: "opencode", model: "openrouter/qwen/qwen3-max", effort: "high" },
      { id: "opencode-strong", account: "opencode", model: "opencode/big-pickle", effort: "high" },
      { id: "opencode-standard", account: "opencode", model: "opencode/big-pickle", effort: "low" },
      { id: "opencode-cheap", account: "opencode", model: "openrouter/deepseek/deepseek-v4-flash", effort: "minimal" },
    ];
    expect(await s.json("profiles.json")).toEqual({ profiles });
    expect(await s.json("auto-setup.json")).toEqual({ profiles });
    expect(await s.json("tiers.json")).toEqual({
      tiers: {
        frontier: ["claude-code-frontier", "codex-frontier", "opencode-frontier"],
        strong: ["claude-code-strong", "codex-strong", "opencode-strong"],
        standard: ["claude-code-standard", "codex-standard", "opencode-standard"],
        cheap: ["claude-code-cheap", "codex-cheap", "opencode-cheap"],
      },
    });
    expect(await s.json("settings.json")).toEqual({ assistant: { profile: "claude-code-frontier" } });
    expect(app.engine.global().settings.assistant.profile).toBe("claude-code-frontier");
    expect(app.engine.global().settings.orchestrator.profile).toBeNull();
    expect(app.engine.global().profiles.profiles).toHaveLength(12);
    expect(await s.head()).toMatch(/ auto-setup: Set up Claude Code, Codex, and OpenCode: 12 profiles added$/);
    expect(s.notices).toEqual([{ kind: "auto-setup", title: "<PE/CORE> setup", body: "Set up Claude Code, Codex, and OpenCode: 12 profiles added" }]);
    expect(await app.call("listNotifications")).toContainEqual(expect.objectContaining({ kind: "auto-setup", body: "Set up Claude Code, Codex, and OpenCode: 12 profiles added" }));
    expect(await app.call("getSetup")).toEqual({
      harnesses: [
        { connector: "claude-code", installed: true, version: "2.1.400", loggedIn: true },
        { connector: "codex", installed: true, version: "0.170.0", loggedIn: true },
        { connector: "opencode", installed: true, version: "2.4.0", loggedIn: true },
      ],
      modelAccountWorks: true,
    });
    await app.close();
  });

  it("a second start with the same harnesses changes nothing", async () => {
    const s = await setup();
    await s.harnesses.set("claude-code", claude);
    await s.harnesses.set("codex", codex);
    await s.harnesses.set("opencode", opencode);
    await (await s.start()).close();
    const files = ["accounts.json", "profiles.json", "tiers.json", "settings.json", "auto-setup.json"];
    const before = await Promise.all(files.map(s.text));
    const commit = await s.head();

    await (await s.start()).close();
    expect(await Promise.all(files.map(s.text))).toEqual(before);
    expect(await s.head()).toBe(commit);
    expect(s.notices).toHaveLength(1);
  });

  it("refreshes the profiles it wrote when the harness offer changes; profiles the user changed or removed stay as they are", async () => {
    const s = await setup();
    await s.harnesses.set("claude-code", claude);
    await (await s.start()).close();
    const profiles = (await s.json("profiles.json")) as { profiles: { id: string; model: string; effort: string | null }[] };
    const tiers = (await s.json("tiers.json")) as { tiers: Record<string, string[]> };
    await writeFile(join(s.home, "profiles.json"), JSON.stringify({
      profiles: profiles.profiles
        .filter((p) => p.id !== "claude-code-cheap")
        .map((p) => (p.id === "claude-code-strong" ? { ...p, model: "claude-opus-9", effort: "low" } : p)),
    }));
    await writeFile(join(s.home, "tiers.json"), JSON.stringify({ tiers: { ...tiers.tiers, cheap: [] } }));
    await s.harnesses.set("claude-code", {
      ...claude,
      models: { "claude-opus-10": ["low", "high", "max"], "claude-sonnet-9": ["low", "medium", "high", "xhigh"], "claude-opus-9": ["low", "max"], "claude-haiku-9": [] },
    });

    const app = await s.start();
    expect(await s.json("profiles.json")).toEqual({
      profiles: [
        { id: "claude-code-frontier", account: "claude-code", model: "claude-opus-10", effort: "max" },
        { id: "claude-code-strong", account: "claude-code", model: "claude-opus-9", effort: "low" },
        { id: "claude-code-standard", account: "claude-code", model: "claude-sonnet-9", effort: "medium" },
      ],
    });
    expect(await s.json("auto-setup.json")).toEqual({
      profiles: [
        { id: "claude-code-frontier", account: "claude-code", model: "claude-opus-10", effort: "max" },
        { id: "claude-code-strong", account: "claude-code", model: "claude-sonnet-9", effort: "high" },
        { id: "claude-code-standard", account: "claude-code", model: "claude-sonnet-9", effort: "medium" },
        { id: "claude-code-cheap", account: "claude-code", model: "claude-haiku-9", effort: null },
      ],
    });
    expect(((await s.json("tiers.json")) as { tiers: Record<string, string[]> }).tiers.cheap).toEqual([]);
    expect(await s.head()).toMatch(/ auto-setup: Set up Claude Code: 1 profile updated$/);
    expect(app.engine.global().profiles.profiles.find((p) => p.id === "claude-code-frontier")?.model).toBe("claude-opus-10");
    expect(s.notices.at(-1)?.body).toBe("Set up Claude Code: 1 profile updated");
    await app.close();
  });

  it("writes nothing when no harness is usable, reports why for the banner, and sets up a harness right after logging in from the setup", async () => {
    const s = await setup();
    await s.harnesses.set("claude-code", { ...claude, email: null, loginEmail: "dev@example.test" });
    await s.harnesses.set("codex", { ...codex, version: "0.100.0" });
    await s.harnesses.set("opencode", null);
    const app = await s.start();

    for (const file of ["accounts.json", "profiles.json", "tiers.json", "auto-setup.json"]) expect(await s.text(file)).toBeNull();
    expect(s.notices).toEqual([]);
    expect(await app.call("getSetup")).toEqual({
      harnesses: [
        { connector: "claude-code", installed: true, version: "2.1.400", loggedIn: false },
        { connector: "codex", installed: true, version: "0.100.0", loggedIn: false },
        { connector: "opencode", installed: false, version: null, loggedIn: false },
      ],
      modelAccountWorks: false,
    });
    await expect(app.call("startSetupLogin", { params: { connector: "opencode" } })).rejects.toMatchObject({ status: 404 });

    const messages: LiveMessage[] = [];
    app.engine.on("live", (m: LiveMessage) => messages.push(m));
    const { loginId } = await app.call("startSetupLogin", { params: { connector: "claude-code" } });
    expect(loginId).toMatch(/^claude-code:/);
    await until(() => messages.some((m) => m.type === "login.progress" && m.loginId === loginId && m.done));
    expect(messages).toContainEqual(expect.objectContaining({ type: "login.progress", loginId, url: "https://login.example.test/device" }));
    expect(await s.json("accounts.json")).toEqual({ accounts: [expect.objectContaining({ id: "claude-code", connector: "claude-code" })] });
    expect(((await s.json("profiles.json")) as { profiles: unknown[] }).profiles).toHaveLength(4);
    expect(s.notices).toEqual([{ kind: "auto-setup", title: "<PE/CORE> setup", body: "Set up Claude Code: 4 profiles added" }]);
    expect(await app.call("getSetup")).toEqual({
      harnesses: [
        { connector: "claude-code", installed: true, version: "2.1.400", loggedIn: true },
        { connector: "codex", installed: true, version: "0.100.0", loggedIn: false },
        { connector: "opencode", installed: false, version: null, loggedIn: false },
      ],
      modelAccountWorks: true,
    });
    await app.close();
  });

  it("uses the account and Assistant model the user already has; with no ranked model every tier uses the harness default", async () => {
    const s = await setup();
    await s.harnesses.set("codex", { ...codex, variants: false, models: { "gpt-9": ["low", "medium", "high"], "gpt-9-codex": ["medium"] } });
    await mkdir(s.home, { recursive: true });
    await writeFile(join(s.home, "accounts.json"), JSON.stringify({ accounts: [{ id: "work", kind: "model", provider: "openai", connector: "codex", login: "subscription" }] }));
    await writeFile(join(s.home, "profiles.json"), JSON.stringify({ profiles: [{ id: "mine", account: "work", model: "gpt-9" }] }));
    await writeFile(join(s.home, "settings.json"), JSON.stringify({ assistant: { profile: "mine" } }));
    const app = await s.start();

    expect(await s.json("accounts.json")).toEqual({ accounts: [{ id: "work", kind: "model", provider: "openai", connector: "codex", login: "subscription" }] });
    expect(await s.json("profiles.json")).toEqual({
      profiles: [
        { id: "mine", account: "work", model: "gpt-9" },
        { id: "codex-frontier", account: "work", model: "gpt-9", effort: "high" },
        { id: "codex-strong", account: "work", model: "gpt-9", effort: "high" },
        { id: "codex-standard", account: "work", model: "gpt-9", effort: "medium" },
        { id: "codex-cheap", account: "work", model: "gpt-9", effort: "low" },
      ],
    });
    expect(await s.json("settings.json")).toEqual({ assistant: { profile: "mine" } });
    expect(await s.head()).toMatch(/ auto-setup: Set up Codex: 4 profiles added$/);
    await app.close();
  });

  it("shows OpenCode as logged in when it lists models, since it reports no account, and as unknown when it lists none", async () => {
    const s = await setup();
    await s.harnesses.set("opencode", opencode);
    const first = await s.start();
    await vi.waitFor(async () => expect((await first.call("listLogins")).find((item) => item.connector === "opencode")).toMatchObject({ account: "opencode", state: "logged_in", email: null }), { timeout: 15_000 });
    await first.close();
    const app = await s.start();
    const login = async () => (await app.call("listLogins")).find((item) => item.connector === "opencode");
    await vi.waitFor(async () => expect(await login()).toMatchObject({ state: "logged_in", email: null }), { timeout: 15_000 });
    expect(await app.call("recheckLogin", { params: { id: (await login())!.id } })).toMatchObject({ state: "logged_in", email: null, plan: null });
    expect(await app.call("accountOptions", { params: { id: "opencode" }, query: {} })).toEqual({
      models: ["openrouter/qwen/qwen3-max", "opencode/big-pickle", "openrouter/deepseek/deepseek-v4-flash"],
      efforts: ["low", "high"],
    });
    await s.harnesses.set("opencode", { ...opencode, cliModels: undefined });
    expect(await app.call("recheckLogin", { params: { id: (await login())!.id } })).toMatchObject({ state: "unknown", email: null });
    await app.close();
  });

  it("reads an account's models once and again only when asked to refresh", async () => {
    const s = await setup();
    await s.harnesses.set("opencode", opencode);
    const app = await s.start();
    const first = { models: ["openrouter/qwen/qwen3-max", "opencode/big-pickle", "openrouter/deepseek/deepseek-v4-flash"], efforts: ["low", "high"] };
    expect(await app.call("accountOptions", { params: { id: "opencode" }, query: {} })).toEqual(first);
    await s.harnesses.set("opencode", { ...opencode, cliModels: ["opencode/big-pickle"] });
    expect(await app.call("accountOptions", { params: { id: "opencode" }, query: {} })).toEqual(first);
    const refreshed = { models: ["opencode/big-pickle"], efforts: ["low", "high"] };
    expect(await app.call("refreshAccountOptions", { params: { id: "opencode" } })).toEqual(refreshed);
    expect(await app.call("accountOptions", { params: { id: "opencode" }, query: {} })).toEqual(refreshed);
    await app.close();
  });

  it("offers the efforts of the chosen model, none for a model without efforts, read once until refresh", async () => {
    const s = await setup();
    const models = { "opencode/big-pickle": ["low", "high"], "openrouter/qwen/qwen3-max": ["low", "medium", "high"], "opencode/hy4-flash-free": [] };
    await s.harnesses.set("opencode", { ...opencode, cliModels: Object.keys(models), models });
    const app = await s.start();
    const options = (model: string) => app.call("accountOptions", { params: { id: "opencode" }, query: { model } });
    const listed: string[] = ["opencode/big-pickle", "openrouter/qwen/qwen3-max", "opencode/hy4-flash-free"];
    expect(await options("openrouter/qwen/qwen3-max")).toEqual({ models: listed, efforts: ["low", "medium", "high"] });
    expect(await options("opencode/hy4-flash-free")).toEqual({ models: listed, efforts: [] });
    expect(await options("opencode/big-pickle")).toEqual({ models: listed, efforts: ["low", "high"] });
    await s.harnesses.set("opencode", { ...opencode, cliModels: Object.keys(models), models: { ...models, "openrouter/qwen/qwen3-max": ["high"] } });
    expect(await options("openrouter/qwen/qwen3-max")).toEqual({ models: listed, efforts: ["low", "medium", "high"] });
    await app.call("refreshAccountOptions", { params: { id: "opencode" } });
    expect(await options("openrouter/qwen/qwen3-max")).toEqual({ models: listed, efforts: ["high"] });
    await app.close();
  });

  it("writes nothing when its own record of past writes cannot be read", async () => {
    const s = await setup();
    await s.harnesses.set("claude-code", claude);
    await mkdir(s.home, { recursive: true });
    await writeFile(join(s.home, "auto-setup.json"), "{");
    const app = await s.start();
    expect(await s.text("accounts.json")).toBeNull();
    expect(await s.text("profiles.json")).toBeNull();
    expect(await s.text("auto-setup.json")).toBe("{");
    expect(s.notices).toEqual([]);
    await app.close();
  });
});
