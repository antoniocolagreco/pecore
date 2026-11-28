import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Accounts, Settings as SettingsSchema } from "@pecore/schemas";
import type { LiveMessage, LoginView, RouteInput, RouteResult, Settings as SettingsValue } from "@pecore/schemas";
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

it("lists Git hosting and MCP tracker accounts once, with the MCP badge before the state badge", async () => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [
    { id: "gh-ada", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "ada", author: { name: "", email: "" } },
    { id: "glab-lin", kind: "forge", forge: "gitlab", tool: "glab", host: "gitlab.com", user: "lin", author: { name: "", email: "" } },
    { id: "atlassian", kind: "service", service: "Atlassian", tool: "atlassian", user: "Atlassian account", site: "team.atlassian.net" },
    { id: "linear", kind: "service", service: "Linear", tool: "linear", user: "alice@example.test @ workspace" },
  ] });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "getActiveJira") return null;
    if (route === "recheckAccount") return { state: "logged_in" };
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await within(trackers).findByText("GitHub · ada");
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("discoverAccounts"));
  expect(within(trackers).getByText("GitLab · lin")).toBeTruthy();
  expect(within(trackers).getByText("github.com · From Git hosting")).toBeTruthy();
  expect(within(trackers).getByText("gitlab.com · From Git hosting")).toBeTruthy();
  expect(within(trackers).queryByRole("button", { name: "Add account" })).toBeNull();
  const jira: HTMLElement = within(trackers).getByText("Jira").closest("li")!;
  await waitFor(() => expect(within(jira).getByText("Logged in")).toBeTruthy());
  const mcp: HTMLElement = within(jira).getByText("MCP");
  const state: HTMLElement = within(jira).getByText("Logged in");
  expect(mcp.nextElementSibling).toBe(state);
  expect(state.parentElement!.lastElementChild).toBe(state);
  expect(within(within(trackers).getByText("Linear").closest("li")!).getByText("MCP")).toBeTruthy();
  expect(within(jira).getByText("team.atlassian.net")).toBeTruthy();
});

it("persists Show unavailable in Trackers across visits", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([
    { path: "/settings", element: <Settings /> },
    { path: "/elsewhere", element: <p>Elsewhere</p> },
  ], { initialEntries: ["/settings?section=accounts"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await user.click(within(trackers).getByRole("button", { name: "Show unavailable" }));
  expect(await within(trackers).findByText("Log in with Jira or connect Atlassian MCP.")).toBeTruthy();
  expect(within(trackers).getByText("Log in with Linear to search and read issues.")).toBeTruthy();
  expect(within(trackers).getByText("Add or log in to GitHub in Git hosting.")).toBeTruthy();
  expect(within(trackers).getByText("Add or log in to GitLab in Git hosting.")).toBeTruthy();

  await act(() => router.navigate("/elsewhere"));
  await act(() => router.navigate(-1));
  const restored = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  expect(within(restored).getByRole("button", { name: "Hide unavailable" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(restored).getByText("Log in with Jira or connect Atlassian MCP.")).toBeTruthy();
});

it("replaces a pending provider row with the verified MCP account", async () => {
  const fallback = api.call.getMockImplementation()!;
  let accounts: Accounts = Accounts.parse({ accounts: [] });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: String(accounts.accounts.length + 1) };
    if (route === "getActiveJira") return null;
    if (route === "startTrackerLogin") return { loginId: "tool:atlassian" };
    if (route === "recheckAccount") return { state: "logged_in" };
    if (route === "discoverAccounts") return { ok: true };
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await user.click(within(trackers).getByRole("button", { name: "Show unavailable" }));
  const row: HTMLElement = (await within(trackers).findByText("Jira")).closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Log in" }));
  await screen.findByText("Signing in…");

  accounts = Accounts.parse({ accounts: [{
    id: "atlassian", kind: "service", service: "Atlassian", tool: "atlassian", user: "alice", site: "team.atlassian.net",
  }] });
  act(() => {
    for (const listener of [...api.listeners]) {
      listener({ type: "login.progress", loginId: "tool:atlassian", text: "Connected to Atlassian.", url: null, done: true });
      listener({ type: "configuration.changed", kind: "accounts" });
    }
  });
  await waitFor(() => expect(screen.queryByText("Signing in…")).toBeNull());
  await waitFor(() => expect(within(trackers).getByText("team.atlassian.net")).toBeTruthy());
  await waitFor(() => expect(within(trackers).getByText("MCP")).toBeTruthy());
});

it("offers Connect MCP on the CLI Jira row and shows no MCP badge until MCP is active", async () => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [{
    id: "atlassian", kind: "service", service: "Atlassian", tool: "atlassian", user: "Atlassian account", site: "first.atlassian.net",
  }] });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "getActiveJira") return {
      site: "first.atlassian.net", account: { id: "jira-login", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" },
    };
    if (route === "recheckAccount") return { state: "logged_out" };
    if (route === "startTrackerLogin") return { loginId: "tool:atlassian" };
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await within(trackers).findByText("alice@example.test · first.atlassian.net");
  expect(within(trackers).queryByText("MCP")).toBeNull();
  api.call.mockClear();
  await user.click(within(trackers).getByRole("button", { name: "Check" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("recheckAccount", { params: { id: "atlassian" } }));
  const checkedRow: HTMLElement = within(trackers).getByText("alice@example.test · first.atlassian.net").closest("li")!;
  await user.click(within(checkedRow).getByRole("button", { name: "Connect MCP" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startTrackerLogin", { params: { server: "atlassian" } }));
  expect(await screen.findByText("Signing in…")).toBeTruthy();
  expect(within(trackers).queryByText("MCP")).toBeNull();
});

it("refreshes Trackers when a Git hosting login completes", async () => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [
    { id: "gh-ada", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "ada", author: { name: "", email: "" } },
  ] });
  let loggedIn: boolean = false;
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "getActiveJira") return null;
    if (route === "recheckAccount") return { state: loggedIn ? "logged_in" : "logged_out" };
    if (route === "startAccountLogin") return { loginId: "tool:gh-ada" };
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  const forge = (await screen.findByRole("heading", { name: "Git hosting" })).closest("section")!;
  await waitFor(() => expect(within(trackers).getByText("Logged out")).toBeTruthy());
  await user.click(await within(forge).findByRole("button", { name: "Log in" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startAccountLogin", { params: { id: "gh-ada" } }));
  loggedIn = true;
  act(() => {
    for (const listener of [...api.listeners]) {
      listener({ type: "login.progress", loginId: "tool:gh-ada", text: "Login ended", url: null, done: true });
    }
  });
  await waitFor(() => expect(within(trackers).getByText("Logged in")).toBeTruthy());
});

it("refreshes Git hosting when a Trackers login completes", async () => {
  const fallback = api.call.getMockImplementation()!;
  const accounts: Accounts = Accounts.parse({ accounts: [
    { id: "gh-ada", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "ada", author: { name: "", email: "" } },
  ] });
  let loggedIn: boolean = false;
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "getActiveJira") return null;
    if (route === "recheckAccount") return { state: loggedIn ? "logged_in" : "logged_out" };
    if (route === "startAccountLogin") return { loginId: "tool:gh-ada" };
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const trackers = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  const forge = (await screen.findByRole("heading", { name: "Git hosting" })).closest("section")!;
  await waitFor(() => expect(within(trackers).getByText("Logged out")).toBeTruthy());
  await user.click(within(trackers).getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startAccountLogin", { params: { id: "gh-ada" } }));
  loggedIn = true;
  act(() => {
    for (const listener of [...api.listeners]) {
      listener({ type: "login.progress", loginId: "tool:gh-ada", text: "Login ended", url: null, done: true });
    }
  });
  await waitFor(() => expect(within(forge).getByText("Logged in")).toBeTruthy());
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
    if (route === "discoverAccounts") return { ok: true };
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
  const aiTools: HTMLElement = screen.getByRole("heading", { name: "AI tools" }).closest("header")!;
  await user.click(within(aiTools).getByRole("button", { name: "Show unavailable" }));
  viewport().scrollTop = 760;
  fireEvent.scroll(viewport());

  await act(() => router.navigate("/elsewhere"));
  await act(() => router.navigate(-1));
  await screen.findByRole("heading", { name: "Appearance" });
  expect(within(screen.getByRole("heading", { name: "AI tools" }).closest("header")!).getByRole("button", { name: "Hide unavailable" }).getAttribute("aria-pressed")).toBe("true");
  expect(viewport().scrollTop).toBe(760);
});

it.each([
  { id: "atlassian", name: "Jira" },
  { id: "linear", name: "Linear" },
])("starts a $name tracker sign-in from Show unavailable without saving an account first", async ({ id, name }) => {
  const fallback = api.call.getMockImplementation()!;
  api.call.mockImplementation(async (route: string) => {
    if (route === "startTrackerLogin") return { loginId: `tool:${id}` };
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const trackers: HTMLElement = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await user.click(within(trackers).getByRole("button", { name: "Show unavailable" }));
  const row: HTMLElement = (await within(trackers).findByText(name)).closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startTrackerLogin", { params: { server: id } }));
  expect(api.call).not.toHaveBeenCalledWith("putAccounts", expect.anything());
  expect(await screen.findByText("Signing in…")).toBeTruthy();
  expect(screen.queryByLabelText("Login code")).toBeNull();
});

it("shows a tracker sign-in error on the unavailable row", async () => {
  const fallback = api.call.getMockImplementation()!;
  api.call.mockImplementation(async (route: string) => {
    if (route === "startTrackerLogin") throw new Error("The tracker sign-in could not start.");
    return fallback(route);
  });
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const trackers: HTMLElement = (await screen.findByRole("heading", { name: "Trackers" })).closest("section")!;
  await user.click(within(trackers).getByRole("button", { name: "Show unavailable" }));
  const row: HTMLElement = (await within(trackers).findByText("Jira")).closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Log in" }));
  await screen.findByText("The tracker sign-in could not start.");
  expect(screen.queryByRole("dialog", { name: "Add a tracker account" })).toBeNull();
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
  const aiTools: HTMLElement = (await screen.findByRole("heading", { name: "AI tools" })).closest("header")!;
  expect(screen.queryByText("Pi")).toBeNull();

  await user.click(within(aiTools).getByRole("button", { name: "Show unavailable" }));
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
  await user.click(within(aiTools).getByRole("button", { name: "Hide unavailable" }));
  expect(screen.queryByText("Pi")).toBeNull();
  await user.click(within(aiTools).getByRole("button", { name: "Show unavailable" }));

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

it("lists the AI tools in Accounts in protected mode and keeps them out of Protected mode", async () => {
  const fallback = api.call.getMockImplementation()!;
  const settings: SettingsValue = SettingsSchema.parse({ protectedMode: true });
  const accounts: Accounts = Accounts.parse({ accounts: [
    { id: "claude", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" },
    { id: "codex", kind: "model", provider: "openai", connector: "codex", login: "subscription" },
  ] });
  const logins: LoginView[] = [
    { id: "claude:pecore-agent", account: "claude", osUser: "pecore-agent", connector: "claude-code", defaultDir: false, state: "logged_in", email: "ada@example.test", plan: "Pro", running: false },
    { id: "codex:pecore-agent", account: "codex", osUser: "pecore-agent", connector: "codex", defaultDir: false, state: "logged_out", email: null, plan: null, running: false },
  ];
  api.call.mockImplementation(async (route: string) => {
    if (route === "getSettings") return { value: settings, sha256: "settings-v1" };
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "listLogins") return logins;
    if (route === "startLogin") return { loginId: "codex:pecore-agent" };
    if (route === "recheckLogin") return logins.find(({ id }) => id === "codex:pecore-agent")!;
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  const aiTools: HTMLElement = (await screen.findByRole("heading", { name: "AI tools" })).closest("section")!;
  await within(aiTools).findByText("ada@example.test · Pro · Runs as pecore-agent");
  const codex: HTMLElement = within(aiTools).getByText("Codex").closest("li")!;
  expect(within(codex).getByText("Runs as pecore-agent")).toBeTruthy();
  expect(within(codex).getByText("Logged out")).toBeTruthy();
  const protectedSection: HTMLElement = (await screen.findByRole("heading", { name: "Protected mode" })).closest("section")!;
  expect(within(protectedSection).queryByText("Claude Code")).toBeNull();
  expect(within(protectedSection).queryByText("Codex")).toBeNull();
  expect(within(protectedSection).queryByRole("list")).toBeNull();
  expect(within(protectedSection).queryByRole("button", { name: "Log in" })).toBeNull();

  const header: HTMLElement = screen.getByRole("heading", { name: "AI tools" }).closest("header")!;
  const check: HTMLButtonElement = within(header).getByRole("button", { name: "Check" });
  await waitFor(() => expect(check.disabled).toBe(false));
  api.call.mockClear();
  await user.click(check);
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("recheckLogin", { params: { id: "claude:pecore-agent" } }));
  expect(api.call).toHaveBeenCalledWith("recheckLogin", { params: { id: "codex:pecore-agent" } });

  api.call.mockClear();
  await user.click(within(codex).getByRole("button", { name: "Log in" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startLogin", { body: { account: "codex", osUser: "pecore-agent" } }));
});

it("keeps the AI tools in Accounts when protected mode changes", async () => {
  const fallback = api.call.getMockImplementation()!;
  let protectedMode: boolean = false;
  const accounts: Accounts = Accounts.parse({ accounts: [
    { id: "claude", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" },
  ] });
  const logins = (): LoginView[] => [protectedMode
    ? { id: "claude:pecore-agent", account: "claude", osUser: "pecore-agent", connector: "claude-code", defaultDir: false, state: "logged_in", email: "ada@example.test", plan: "Pro", running: false }
    : { id: "claude:local", account: "claude", osUser: "local", connector: "claude-code", defaultDir: true, state: "logged_in", email: "ada@example.test", plan: "Pro", running: false }];
  api.call.mockImplementation(async (route: string, input?: RouteInput<"setProtectedMode">) => {
    if (route === "getSettings") return { value: SettingsSchema.parse({ protectedMode }), sha256: `settings-${protectedMode}` };
    if (route === "getAccounts") return { value: accounts, sha256: "accounts-v1" };
    if (route === "listLogins") return logins();
    if (route === "setProtectedMode" && input?.body) {
      protectedMode = input.body.on;
      return { ok: true };
    }
    return fallback(route);
  });
  const user = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>, { wrapper: ViewHistoryProvider });
  await screen.findByText("ada@example.test · Pro");
  const aiTools = (): HTMLElement => screen.getByRole("heading", { name: "AI tools" }).closest("section")!;
  const protectedSection = (): HTMLElement => screen.getByRole("heading", { name: "Protected mode" }).closest("section")!;
  expect(within(aiTools()).getByText("Claude Code")).toBeTruthy();
  expect(within(protectedSection()).queryByText("Claude Code")).toBeNull();

  const toggle: HTMLButtonElement = screen.getByRole("switch", { name: /Protected mode/ });
  await user.click(toggle);
  await waitFor(() => expect(within(aiTools()).getByText(/Runs as pecore-agent/)).toBeTruthy());
  expect(within(protectedSection()).queryByText("Claude Code")).toBeNull();

  await user.click(toggle);
  await user.click(await screen.findByRole("button", { name: "Keep user" }));
  await waitFor(() => expect(within(aiTools()).queryByText(/Runs as pecore-agent/)).toBeNull());
  expect(within(aiTools()).getByText("Claude Code")).toBeTruthy();
  expect(within(protectedSection()).queryByText("Claude Code")).toBeNull();
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
  const aiTools: HTMLElement = (await screen.findByRole("heading", { name: "AI tools" })).closest("header")!;
  await user.click(within(aiTools).getByRole("button", { name: "Show unavailable" }));
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
    ["recheckAccount", { params: { id: "github" } }],
    ["recheckAccount", { params: { id: "gitlab" } }],
    ["recheckAccount", { params: { id: "atlassian" } }],
  ]);
  expect(api.call.mock.calls.some(([route]) => route === "discoverAccounts")).toBe(true);
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
  const aiSection: HTMLElement = (await screen.findByRole("heading", { name: "AI tools" })).closest("section")!;
  expect(within(aiSection).getByText("Claude Code")).toBeTruthy();
  const forgeSection: HTMLElement = (await screen.findByRole("heading", { name: "Git hosting" })).closest("section")!;
  const pendingForge = within(forgeSection).getByRole("list", { name: "Checking for accounts" });
  expect(within(pendingForge).getByText("GitHub")).toBeTruthy();
  expect(within(pendingForge).getByText("AWS CodeCommit")).toBeTruthy();
  expect(within(forgeSection).getByRole<HTMLButtonElement>("button", { name: "Add account" }).disabled).toBe(false);
  expect(screen.queryByText(/No AI tools yet/)).toBeNull();

  pending = ["claude-code", "codecommit"];
  accounts.accounts.push({ id: "gh-ada", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "ada", author: { name: "", email: "" } });
  act(() => {
    for (const listener of api.listeners) {
      listener({ type: "configuration.changed", kind: "accounts" });
      listener({ type: "accounts.discovery_changed" });
    }
  });
  expect(await within(forgeSection).findByText("GitHub · ada")).toBeTruthy();
  await waitFor(() => expect(within(forgeSection).queryByText("GitHub")).toBeNull());
  expect(within(pendingForge).getByText("AWS CodeCommit")).toBeTruthy();
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
    if (route === "discoverAccounts") return { ok: true };
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
