import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Accounts, Settings as SettingsSchema } from "@pecore/schemas";
import type { LiveMessage, LoginView, RouteInput, RouteResult } from "@pecore/schemas";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ui } from "../components/ui";
import { ViewHistoryProvider } from "../components/ViewHistoryProvider";
import { Settings } from "./Settings";

const api = vi.hoisted(() => ({ call: vi.fn(), listeners: new Set<(message: LiveMessage) => void>() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", async () => {
  const { useEffect } = await import("react");
  return {
    useConnected: () => true,
    onLive(listener: (message: LiveMessage) => void): () => void {
      api.listeners.add(listener);
      return () => { api.listeners.delete(listener); };
    },
    useLive(listener: (message: LiveMessage) => void): void {
      useEffect(() => {
        api.listeners.add(listener);
        return () => { api.listeners.delete(listener); };
      }, [listener]);
    },
  };
});

it("shows the logged-in Jira account in Trackers and refreshes it with the group Check", async () => {
  const fallback = api.call.getMockImplementation()!;
  let site: string = "first.atlassian.net";
  api.call.mockImplementation(async (route: string) => route === "getActiveJira" ? {
    site, account: { id: "jira-login", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" },
  } : fallback(route));
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers: HTMLElement = (await screen.findByRole("heading", { name: "Trackers" })).closest("header")!;
  await screen.findByText("alice@example.test · first.atlassian.net");
  expect(screen.queryByRole("heading", { name: "Atlassian" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Jira" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Linear" })).toBeNull();
  expect(screen.queryByText(/Atlassian MCP server|Atlassian CLI/)).toBeNull();
  site = "second.atlassian.net";
  await userEvent.setup().click(within(trackers).getByRole("button", { name: "Check" }));
  await screen.findByText("alice@example.test · second.atlassian.net");
});

it("shows one Jira row with its site when the CLI login and the Jira account match", async () => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [{
    id: "atlassian", kind: "service", service: "Atlassian", tool: "atlassian", user: "Atlassian account", site: "first.atlassian.net",
  }] });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getActiveJira") return {
      site: "first.atlassian.net", account: { id: "jira-login", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" },
    };
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "recheckAccount") return { state: "logged_in" };
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await screen.findByText("first.atlassian.net");
  expect(within(trackers).getAllByText("Jira")).toHaveLength(1);
  expect(within(trackers).queryByText("Atlassian account")).toBeNull();
  expect(within(trackers).queryByText("alice@example.test · first.atlassian.net")).toBeNull();
});

it("finds a Jira CLI login with Trackers Check without reopening Settings", async () => {
  const fallback = api.call.getMockImplementation()!;
  let active: RouteResult<"getActiveJira"> = null;
  api.call.mockImplementation(async (route: string) => route === "getActiveJira" ? active : fallback(route));
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("header")!;
  const check: HTMLButtonElement = within(trackers).getByRole("button", { name: "Check" });
  expect(check.disabled).toBe(false);
  active = {
    site: "first.atlassian.net", account: { id: "jira-login", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" },
  };
  await userEvent.setup().click(check);
  await screen.findByText("alice@example.test · first.atlassian.net");
});

it("shows a Trackers check error when no Jira account is listed", async () => {
  const fallback = api.call.getMockImplementation()!;
  api.call.mockImplementation(async (route: string) => {
    if (route === "getActiveJira") throw new Error("Jira check failed.");
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  expect(await screen.findByText("Jira check failed.")).toBeTruthy();
});

beforeEach(() => {
  api.call.mockReset();
  api.call.mockImplementation(async (route: string) => {
    if (route === "getActiveJira") return null;
    if (route === "getSettings") return { value: SettingsSchema.parse({}), sha256: "settings-v1" };
    if (route === "getAccounts") return { value: Accounts.parse({}), sha256: "accounts-v1" };
    if (route === "getAccountDiscovery") return [];
    if (route === "getSetup") return { modelAccountWorks: false, harnesses: [
      { connector: "claude-code", installed: false, version: null, loggedIn: false },
      { connector: "codex", installed: false, version: null, loggedIn: false },
      { connector: "opencode", installed: false, version: null, loggedIn: false },
      { connector: "pi", installed: false, version: null, loggedIn: false },
    ] };
    if (route === "listLogins") return [];
    if (route === "getStatus") return { homeFindings: [], globalPause: false, notifications: 0, interrupted: 0, version: "test" };
    if (route === "putSettings") return { sha256: "settings-v2" };
    if (route === "getForgeAccountDefaults") return { author: { name: "Local Author", email: "local@example.com" }, codeCommit: null };
    throw new Error(`Unexpected route ${route}`);
  });
});

afterEach(cleanup);

it("restores the Settings filter and scroll without jumping to the original section again", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([
    { path: "/settings", element: <Settings /> },
    { path: "/elsewhere", element: <p>Elsewhere</p> },
  ], { initialEntries: ["/settings?section=accounts"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const viewport = () => screen.getByRole("heading", { name: "Settings", level: 1 }).closest<HTMLElement>(`.${ui.page}`)!;
  await screen.findByRole("heading", { name: "Appearance" });
  await user.click(screen.getByRole("button", { name: "Show unavailable" }));
  viewport().scrollTop = 760;
  fireEvent.scroll(viewport());

  await act(() => router.navigate("/elsewhere"));
  await act(() => router.navigate(-1));
  await screen.findByRole("heading", { name: "Appearance" });
  expect(screen.getByRole("button", { name: "Hide unavailable" }).getAttribute("aria-pressed")).toBe("true");
  expect(viewport().scrollTop).toBe(760);
});

it.each([
  { id: "atlassian", name: "Jira", service: "Atlassian" },
  { id: "linear", name: "Linear", service: "Linear" },
])("adds a $name tracker from Add account and starts browser sign-in", async ({ id, name, service }) => {
  const fallback = api.call.getMockImplementation()!;
  let accounts: Accounts = { accounts: [] };
  let sha256: string = "accounts-v1";
  api.call.mockImplementation(async (route: string, input?: RouteInput<"putAccounts">) => {
    if (route === "getAccounts") return { value: accounts, sha256 };
    if (route === "putAccounts" && input) {
      accounts = Accounts.parse(input.body.value);
      sha256 = "accounts-v2";
      return { sha256 };
    }
    if (route === "startAccountLogin") return { loginId: `tool:${id}` };
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const trackers: HTMLElement = (await screen.findByRole("heading", { name: "Trackers" })).closest("header")!;
  const add: HTMLButtonElement = within(trackers).getByRole("button", { name: "Add account" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  const dialog = within(await screen.findByRole("dialog", { name: "Add a tracker account" }));
  if (name !== "Jira") {
    dialog.getByRole("combobox", { name: "Tracker" }).focus();
    await user.keyboard("{ArrowDown}");
    await user.click(await screen.findByRole("option", { name }));
  }
  await user.click(dialog.getByRole("button", { name: "Add account" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startAccountLogin", { params: { id } }));
  expect(accounts.accounts).toEqual([{ id, kind: "service", service, tool: id, user: `${service} account` }]);
  expect(screen.queryByLabelText("Login code")).toBeNull();
});

it("keeps the tracker dialog open when the account cannot be saved", async () => {
  const fallback = api.call.getMockImplementation()!;
  api.call.mockImplementation(async (route: string) => {
    if (route === "putAccounts") throw new Error("The account could not be saved.");
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const trackers: HTMLElement = (await screen.findByRole("heading", { name: "Trackers" })).closest("header")!;
  const add: HTMLButtonElement = within(trackers).getByRole("button", { name: "Add account" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  const dialog = within(await screen.findByRole("dialog", { name: "Add a tracker account" }));
  await user.click(dialog.getByRole("button", { name: "Add account" }));
  await screen.findByText("The account could not be saved.");
  expect(screen.getByRole("dialog", { name: "Add a tracker account" })).toBeTruthy();
});

it("shows every supported AI tool without an account and logs in from its row", async () => {
  const fallback = api.call.getMockImplementation()!;
  let accounts: Accounts = Accounts.parse({ accounts: [] });
  let logins: LoginView[] = [];
  api.call.mockImplementation(async (route: string) => {
    if (route === "getSetup") return { modelAccountWorks: false, harnesses: [
      { connector: "claude-code", installed: false, version: null, loggedIn: false },
      { connector: "codex", installed: true, version: "0.1.0", loggedIn: false },
      { connector: "opencode", installed: true, version: "1.0.0", loggedIn: true },
      { connector: "pi", installed: true, version: "1.5.2", loggedIn: false },
    ] };
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "listLogins") return logins;
    if (route === "startSetupLogin") return { loginId: "pi:local" };
    if (route === "recheckLogin") return logins.find(({ id }) => id === "pi:local")!;
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  await screen.findByRole("heading", { name: "AI tools" });
  expect(screen.queryByText("Pi")).toBeNull();

  await user.click(screen.getByRole("button", { name: "Show unavailable" }));
  const claude: HTMLElement = (await screen.findByText("Claude Code")).closest("li")!;
  expect(within(claude).getByText("Not installed")).toBeTruthy();
  expect(within(claude).queryByRole("button", { name: "Log in" })).toBeNull();
  const codex: HTMLElement = screen.getByText("Codex").closest("li")!;
  expect(within(codex).getByText("Logged out")).toBeTruthy();
  expect(within(codex).getByRole("button", { name: "Log in" })).toBeTruthy();
  const opencode: HTMLElement = screen.getByText("OpenCode").closest("li")!;
  expect(within(opencode).getByText("No models")).toBeTruthy();
  expect(within(opencode).queryByText("Logged in")).toBeNull();
  const pi: HTMLElement = screen.getByText("Pi").closest("li")!;
  expect(within(pi).getByText("No models")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Hide unavailable" }));
  expect(screen.queryByText("Pi")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Show unavailable" }));

  await user.click(within(screen.getByText("Pi").closest("li")!).getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startSetupLogin", { params: { connector: "pi" } }));

  accounts = Accounts.parse({ accounts: [{ id: "pi", kind: "model", provider: "pi", connector: "pi", login: "subscription" }] });
  logins = [{ id: "pi:local", account: "pi", osUser: "local", connector: "pi", defaultDir: true, state: "logged_in", email: null, plan: null, running: false }];
  act(() => {
    for (const listener of [...api.listeners]) {
      listener({ type: "login.progress", loginId: "pi:local", text: "Login ended", url: null, done: true });
      listener({ type: "configuration.changed", kind: "accounts" });
    }
  });
  await screen.findByText("Logged in");
  const header: HTMLElement = screen.getByRole("heading", { name: "AI tools" }).closest("header")!;
  const check: HTMLButtonElement = within(header).getByRole("button", { name: "Check" });
  await waitFor(() => expect(check.disabled).toBe(false));
  api.call.mockClear();
  await user.click(check);
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("recheckLogin", { params: { id: "pi:local" } }));
});

it("keeps AI tool colours fixed and puts the state badge last", async () => {
  const fallback = api.call.getMockImplementation()!;
  api.call.mockImplementation(async (route: string) => {
    if (route === "getSetup") return { modelAccountWorks: false, harnesses: [
      { connector: "claude-code", installed: false, version: null, loggedIn: false },
      { connector: "codex", installed: true, version: "0.1.0", loggedIn: false },
      { connector: "opencode", installed: false, version: null, loggedIn: false },
      { connector: "pi", installed: false, version: null, loggedIn: false },
    ] };
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  await user.click(await screen.findByRole("button", { name: "Show unavailable" }));
  const codex: HTMLElement = (await screen.findByText("Codex")).closest("li")!;
  expect(within(codex).queryByRole("button", { name: "Colour" })).toBeNull();
  expect((codex.querySelector("span[aria-hidden]") as HTMLElement).style.getPropertyValue("--harness")).toBe("#EEF1F2");
  const badge: HTMLElement = within(codex).getByText("Logged out");
  const actions: HTMLElement = within(codex).getByRole("button", { name: "Log in" }).parentElement!;
  expect(actions.contains(badge)).toBe(true);
  expect(actions.lastElementChild).toBe(badge);
  expect(codex.firstElementChild!.lastElementChild).toBe(actions);
  const grok: HTMLElement = (await screen.findByText("Grok")).closest("li")!;
  expect(within(grok).queryByRole("button")).toBeNull();
  const grokBadge: HTMLElement = within(grok).getByText("Coming soon");
  expect(grokBadge.parentElement).toBe(grok.firstElementChild!.lastElementChild);
});

it.each([
  { final: "logged_in", badge: "Logged in" },
  { final: "unknown", badge: "No models" },
])("waits for the model check before showing $badge", async ({ final, badge }) => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [{ id: "pi", kind: "model", provider: "pi", connector: "pi", login: "subscription" }] });
  let checked = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const view = (state: LoginView["state"]): LoginView => ({ id: "pi:local", account: "pi", osUser: "local", connector: "pi", defaultDir: true, state, email: null, plan: null, running: false });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "listLogins") return [view(checked ? final as LoginView["state"] : "unchecked")];
    if (route === "recheckLogin") {
      await gate;
      checked = true;
      return view(final as LoginView["state"]);
    }
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const pi: HTMLElement = (await screen.findByText("Pi")).closest("li")!;
  expect(within(pi).getByText("Checking…")).toBeTruthy();
  expect(within(pi).queryByText("No models")).toBeNull();
  act(() => release());
  await waitFor(() => expect(within(pi).getByText(badge)).toBeTruthy());
});

it("checks only the accounts in the selected panel and keeps Check out of account rows", async () => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [
    { id: "claude", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" },
    { id: "codex", kind: "model", provider: "openai", connector: "codex", login: "subscription" },
    { id: "github", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "ada", author: { name: "", email: "" } },
    { id: "gitlab", kind: "forge", forge: "gitlab", tool: "glab", host: "gitlab.com", user: "lin", author: { name: "", email: "" } },
    { id: "atlassian", kind: "service", service: "Atlassian", tool: "atlassian", user: "Atlassian account" },
  ] });
  const logins: LoginView[] = [
    { id: "claude:local", account: "claude", osUser: "local", connector: "claude-code", defaultDir: true, state: "logged_in", email: null, plan: null, running: false },
    { id: "codex:local", account: "codex", osUser: "local", connector: "codex", defaultDir: true, state: "logged_in", email: null, plan: null, running: false },
    { id: "codex:pecore-agent", account: "codex", osUser: "pecore-agent", connector: "codex", defaultDir: false, state: "logged_in", email: null, plan: null, running: false },
  ];
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "listLogins") return logins;
    if (route === "recheckAccount") return { state: "logged_in" };
    if (route === "recheckLogin") return logins[0];
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const modelHeader: HTMLElement = (await screen.findByRole("heading", { name: "AI tools" })).closest("header")!;
  const forgeHeader: HTMLElement = screen.getByRole("heading", { name: "Git hosting" }).closest("header")!;
  const modelCheck: HTMLButtonElement = within(modelHeader).getByRole("button", { name: "Check" });
  const forgeCheck: HTMLButtonElement = within(forgeHeader).getByRole("button", { name: "Check" });
  await waitFor(() => {
    expect(modelCheck.disabled).toBe(false);
    expect(forgeCheck.disabled).toBe(false);
  });
  expect(screen.getAllByRole("button", { name: "Check" })).toHaveLength(3);

  api.call.mockClear();
  await user.click(modelCheck);
  expect(api.call.mock.calls.filter(([route]) => route.startsWith("recheck"))).toEqual([
    ["recheckLogin", { params: { id: "claude:local" } }],
    ["recheckLogin", { params: { id: "codex:local" } }],
  ]);

  api.call.mockClear();
  await user.click(forgeCheck);
  expect(api.call.mock.calls.filter(([route]) => route.startsWith("recheck"))).toEqual([
    ["recheckAccount", { params: { id: "github" } }],
    ["recheckAccount", { params: { id: "gitlab" } }],
  ]);

  const trackerHeader: HTMLElement = screen.getByRole("heading", { name: "Trackers" }).closest("header")!;
  const trackerCheck: HTMLButtonElement = within(trackerHeader).getByRole("button", { name: "Check" });
  await waitFor(() => expect(trackerCheck.disabled).toBe(false));
  api.call.mockClear();
  await user.click(trackerCheck);
  expect(api.call.mock.calls.filter(([route]) => route.startsWith("recheck"))).toEqual([
    ["recheckAccount", { params: { id: "atlassian" } }],
  ]);
});

it("shows checking only in the pending provider rows and keeps other settings usable", async () => {
  const fallback = api.call.getMockImplementation()!;
  let pending: RouteResult<"getAccountDiscovery"> = ["claude-code", "github", "codecommit"];
  const accounts: Accounts = { accounts: [] };
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccountDiscovery") return pending;
    if (route === "getAccounts") return { value: { accounts: [...accounts.accounts] }, sha256: String(accounts.accounts.length) };
    if (route === "listLogins") return [];
    if (route === "recheckAccount") return { state: "logged_in" };
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  expect(await screen.findByRole("textbox", { name: "Your name" })).toBeTruthy();
  const pendingRows = await screen.findAllByRole("list", { name: "Checking for accounts" });
  expect(within(pendingRows[0]!).getByText("Claude Code")).toBeTruthy();
  expect(within(pendingRows[1]!).getByText("GitHub")).toBeTruthy();
  expect(within(pendingRows[1]!).getByText("AWS CodeCommit")).toBeTruthy();
  const forgeHeader: HTMLElement = screen.getByRole("heading", { name: "Git hosting" }).closest("header")!;
  expect(within(forgeHeader).getByRole<HTMLButtonElement>("button", { name: "Add account" }).disabled).toBe(false);
  expect(screen.queryByText(/No AI tools yet/)).toBeNull();

  pending = ["claude-code", "codecommit"];
  accounts.accounts.push({ id: "gh-ada", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "ada", author: { name: "", email: "" } });
  act(() => {
    for (const listener of api.listeners) {
      listener({ type: "configuration.changed", kind: "accounts" });
      listener({ type: "accounts.discovery_changed" });
    }
  });
  expect(await screen.findByText("GitHub · ada")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("GitHub")).toBeNull());
  expect(within(pendingRows[1]!).getByText("AWS CodeCommit")).toBeTruthy();
});

it("loads preferences and saves the updated name with its current revision", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const name: HTMLElement = await screen.findByRole("textbox", { name: "Your name" });
  expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Project Manager" })).toBeNull();
  await user.type(name, "Antonio");

  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putSettings", {
    body: { value: expect.objectContaining({ user: { name: "Antonio" } }), baseSha256: "settings-v1" },
  }), { timeout: 1500 });
});

it("selects a bundled theme from Appearance", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const theme: HTMLElement = await screen.findByRole("combobox", { name: "Theme" });
  await user.click(theme);
  await user.click(await screen.findByRole("option", { name: "Autumn" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putSettings", {
    body: { value: expect.objectContaining({ ui: { theme: "builtin:autumn" } }), baseSha256: "settings-v1" },
  }), { timeout: 1500 });
});

it.each([
  { service: "GitHub", placeholder: "github.com", server: true, aws: false, required: false },
  { service: "GitLab", placeholder: "gitlab.com", server: true, aws: false, required: false },
  { service: "AWS CodeCommit", placeholder: "", server: false, aws: true, required: false },
  { service: "Private Git server", placeholder: "git.example.com", server: true, aws: false, required: true },
])("only asks for the fields needed by $service", async ({ service, placeholder, server, aws, required }) => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const forgeHeader: HTMLElement = (await screen.findByRole("heading", { name: "Git hosting" })).closest("header")!;
  const add: HTMLButtonElement = within(forgeHeader).getByRole("button", { name: "Add account" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  const dialog = within(await screen.findByRole("dialog", { name: "Add a Git hosting account" }));
  const picker: HTMLElement = dialog.getByRole("combobox", { name: "Service" });
  if (service !== "GitHub") {
    picker.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(await screen.findByRole("option", { name: service }));
  }
  expect(dialog.queryByRole("textbox", { name: "Username" })).toBeNull();
  const host: HTMLInputElement | null = dialog.queryByRole("textbox", { name: "Server" });
  const profile: HTMLInputElement | null = dialog.queryByRole("textbox", { name: "AWS profile" });
  expect(!!host).toBe(server);
  expect(!!profile).toBe(aws);
  if (host) {
    expect(host.placeholder).toBe(placeholder);
    expect(host.required).toBe(required);
  }
  if (profile) expect(profile.value).toBe("default");
  const name: HTMLInputElement = dialog.getByRole("textbox", { name: "Commit author name" });
  const email: HTMLInputElement = dialog.getByRole("textbox", { name: "Commit author email" });
  await waitFor(() => expect(name.value).toBe("Local Author"));
  expect(email.value).toBe("local@example.com");
  await user.clear(name);
  await user.type(name, "Edited");
  expect(name.value).toBe("Edited");
});

it.each([
  { service: "GitHub", id: "gh-github-com", host: "github.com", user: "", login: true },
  { service: "GitLab", id: "glab-gitlab-com", host: "gitlab.com", user: "", login: true },
  { service: "AWS CodeCommit", id: "aws-default", host: "git-codecommit.eu-west-1.amazonaws.com", user: "ada", login: false },
  { service: "Private Git server", id: "git-git-example-com", host: "git.example.com", user: "", login: false },
])("saves a $service account with blank author fields and allows later edits", async ({ service, id, host, user: username, login }) => {
  let accounts: Accounts = { accounts: [] };
  let hash: string = "account-v1";
  api.call.mockImplementation(async (route: string, input?: RouteInput<"putAccounts"> | RouteInput<"getForgeAccountDefaults">) => {
    if (route === "getSettings") return { value: SettingsSchema.parse({}), sha256: "settings-v1" };
    if (route === "getAccounts") return { value: accounts, sha256: hash };
    if (route === "getAccountDiscovery") return [];
    if (route === "getStatus") return { homeFindings: [], globalPause: false, notifications: 0, interrupted: 0, version: "test" };
    if (route === "getForgeAccountDefaults") return {
      author: { name: "", email: "" },
      codeCommit: input?.query?.awsProfile === "default" ? { host, user: username } : null,
    };
    if (route === "listLogins") return [];
    if (route === "recheckAccount") return { state: "logged_out" };
    if (route === "startAccountLogin") return { loginId: `tool:${id}` };
    if (route === "putAccounts" && input?.body) {
      accounts = Accounts.parse(input.body.value);
      hash += "-next";
      return { sha256: hash };
    }
    throw new Error(`Unexpected route ${route}`);
  });
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const forgeHeader: HTMLElement = (await screen.findByRole("heading", { name: "Git hosting" })).closest("header")!;
  const add: HTMLButtonElement = within(forgeHeader).getByRole("button", { name: "Add account" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  const dialog = within(await screen.findByRole("dialog"));
  if (service !== "GitHub") {
    dialog.getByRole("combobox", { name: "Service" }).focus();
    await user.keyboard("{ArrowDown}");
    await user.click(await screen.findByRole("option", { name: service }));
  }
  if (service === "Private Git server") await user.type(dialog.getByRole("textbox", { name: "Server" }), host);
  expect(dialog.getByRole<HTMLInputElement>("textbox", { name: "Commit author email" }).value).toBe("");
  const submit: HTMLButtonElement = dialog.getByRole("button", { name: "Add account" });
  await waitFor(() => expect(submit.disabled).toBe(false));
  await user.click(submit);
  if (login) {
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("startAccountLogin", { params: { id } }));
    act(() => { for (const listener of [...api.listeners]) listener({ type: "login.progress", loginId: `tool:${id}`, text: "Login ended", url: null, done: true }); });
  }
  const editButton: HTMLButtonElement = await screen.findByRole("button", { name: "Edit" });
  if (!login) expect(api.call).not.toHaveBeenCalledWith("startAccountLogin", expect.anything());
  expect(accounts.accounts[0]).toMatchObject({ host, user: username, author: { name: "", email: "" }, ...(service === "AWS CodeCommit" && { awsProfile: "default" }) });
  await user.click(editButton);
  const edit = within(await screen.findByRole("dialog", { name: "Edit Git hosting account" }));
  const usernameField: HTMLElement = edit.getByRole("textbox", { name: "Username" });
  await user.clear(usernameField);
  await user.type(usernameField, "alice");
  await user.click(edit.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(accounts.accounts[0]).toMatchObject({ id, user: "alice" }));
});
