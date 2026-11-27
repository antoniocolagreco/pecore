import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Node } from "@pecore/schemas";
import type { RouteInput } from "@pecore/schemas";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ViewHistoryProvider } from "../components/ViewHistoryProvider";
import { NodeEditor } from "./NodeEditor";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined, useLive: () => undefined }));

afterEach(cleanup);

it("shows where to configure Open PR instead of a disabled editor", async () => {
  const node: Node = Node.parse({
    name: "open-pr", kind: "repository", description: "Uses the configured provider", account: "project.account",
    outcomes: ["success", "failure"], outcomeRules: [{ exitCode: 0, outcome: "success" }, { exitCode: "other", outcome: "failure" }],
  });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getDefinition") return { content: JSON.stringify(node), sha256: "node-v1" };
    if (route === "listDefinitions") return [];
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    throw new Error("Unexpected route " + route);
  });
  const router = createMemoryRouter([
    { path: "/edit/node/*", element: <NodeEditor /> },
    { path: "/projects", element: <h1>Projects</h1> },
  ], { initialEntries: ["/edit/node/templates/nodes/open-pr.json"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  expect(await screen.findByText(/Connect a repository and select a Git hosting account/)).toBeTruthy();
  expect(screen.getByRole<HTMLAnchorElement>("link", { name: "Git hosting settings" }).getAttribute("href")).toBe("/settings?section=accounts");
  expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Repository script" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("link", { name: "Projects" }));
  expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
});

it("offers only the four editable node kinds", async () => {
  api.call.mockImplementation(async (route: string) => {
    if (route === "listDefinitions") return [];
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    throw new Error("Unexpected route " + route);
  });
  const router = createMemoryRouter([{ path: "/new", element: <NodeEditor newTemplate /> }], { initialEntries: ["/new"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: "Kind" }));
  await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Agent", "Command", "Human", "Repository"]));
  await user.click(await screen.findByRole("option", { name: "Command" }));
  await user.click(await screen.findByRole("combobox", { name: "Output of success" }));
  await waitFor(() => expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Nothing", "Spec", "Code review", "Code analysis", "Commit SHA", "Pull request", "Feedback", "Log"]));
});

it("sets Tracker access and account on an Agent", async () => {
  const path: string = "templates/nodes/read-jira-mcp.json";
  const node: Node = Node.parse({
    kind: "agent", name: "read-jira-mcp", description: "Read Jira", prompt: "read-jira-mcp.md",
    changesFiles: false, timeoutSec: 120, outcomes: ["success"], agent: { tier: "standard" },
  });
  api.call.mockImplementation(async (route: string) => {
    if (route === "getDefinition") return { content: JSON.stringify(node), sha256: "node-v1" };
    if (route === "getAccounts") return { value: { accounts: [{ kind: "service", id: "atlassian", tool: "atlassian", service: "Atlassian", user: "Atlassian account" }] } };
    if (route === "getActiveJira") return null;
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "getNodeTemplateUsage" || route === "listDefinitions") return [];
    if (route === "saveDefinition") return { sha256: "node-v2" };
    throw new Error("Unexpected route " + route);
  });
  const router = createMemoryRouter([{ path: "/edit/node/*", element: <NodeEditor /> }], { initialEntries: ["/edit/node/" + path] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const permission: HTMLElement = await screen.findByRole("combobox", { name: "Tracker" });
  expect(permission.textContent).toContain("None");
  expect(screen.queryByRole("combobox", { name: "Tracker account" })).toBeNull();
  await user.click(permission);
  expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["None", "Read", "Read and write"]);
  await user.click(screen.getByRole("option", { name: "Read" }));
  await user.click(screen.getByRole("combobox", { name: "Tracker account" }));
  await user.click(await screen.findByRole("option", { name: "Atlassian · Atlassian account" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const saved: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(Node.parse(JSON.parse(saved.body.content))).toMatchObject({ tracker: { access: "read", account: "atlassian" } });
});

it("shows the saved script before approving it for chat in protected mode", async () => {
  const node: Node = Node.parse({
    kind: "repository", name: "publish", description: "Publish work", account: "project.account",
    script: "git status", outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }],
  });
  const path: string = "templates/nodes/publish.json";
  const hash: string = "a".repeat(64);
  api.call.mockImplementation(async (route: string) => {
    if (route === "getDefinition") return { content: JSON.stringify(node), sha256: "node-v1", chatApproval: { approved: false, hash, checks: {} } };
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "getAccounts") return { value: { accounts: [] } };
    if (route === "getNodeTemplateUsage" || route === "listDefinitions") return [];
    if (route === "approveChatNode") return { ok: true };
    throw new Error("Unexpected route " + route);
  });
  const router = createMemoryRouter([{ path: "/edit/node/*", element: <NodeEditor /> }], { initialEntries: ["/edit/node/" + path] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  expect(await screen.findByText(/To approve/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  const dialog: HTMLElement = await screen.findByRole("dialog", { name: "Approve script for chat?" });
  expect(dialog.querySelector(".cm-content")?.textContent).toBe("git status");
  await user.click(within(dialog).getByRole("button", { name: "Approve script" }));
  await waitFor(() => expect(screen.queryByText(/To approve/)).toBeNull());
  expect(api.call).toHaveBeenCalledWith("approveChatNode", { params: { path }, body: { hash } });
});

it("edits a Command without showing account or check controls", async () => {
  const node: Node = Node.parse({
    name: "publish", description: "Publish a result", kind: "command", command: ["fixture-cli", "publish"],
    changesFiles: true, timeoutSec: 60, outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }],
  });
  const path: string = "templates/nodes/publish.json";
  api.call.mockImplementation(async (route: string, input?: RouteInput<"validateDefinition">) => {
    if (route === "listDefinitions") return [];
    if (route === "getDefinition") return { content: JSON.stringify(node), sha256: "node-v1" };
    if (route === "validateDefinition") {
      const parsed = Node.safeParse(JSON.parse(input?.body.content ?? ""));
      return { errors: parsed.success ? [] : parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })), warnings: [] };
    }
    if (route === "saveDefinition") return { sha256: "node-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/node/*", element: <NodeEditor /> }], { initialEntries: [`/edit/node/${path}`] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const editable: HTMLElement = await screen.findByRole("checkbox", { name: "Can edit files" });
  expect(screen.queryByRole("checkbox", { name: "Use source control credentials" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Account" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Check command" })).toBeNull();
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await user.click(editable);
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const saved: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(Node.parse(JSON.parse(saved.body.content))).toMatchObject({
    kind: "command", changesFiles: false, command: ["fixture-cli", "publish"],
  });
});


it("creates a Repository node with a shell script and requires its account", async () => {
  api.call.mockImplementation(async (route: string, input?: RouteInput<"validateDefinition"> | RouteInput<"saveDefinition">) => {
    if (route === "listDefinitions") return [];
    if (route === "validateDefinition") {
      const parsed = Node.safeParse(JSON.parse(input?.body.content ?? ""));
      return { errors: parsed.success ? [] : parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })), warnings: [] };
    }
    if (route === "getAccounts") return { value: { accounts: [{ id: "gh-alice", kind: "forge", forge: "github", host: "github.com", user: "alice" }] } };
    if (route === "saveDefinition") return { sha256: "tracker-v1" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([
    { path: "/templates/nodes/new", element: <NodeEditor newTemplate /> },
    { path: "/edit/node/*", element: <span>Saved node</span> },
  ], { initialEntries: ["/templates/nodes/new"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "issue-tracker");
  await user.click(screen.getByRole("combobox", { name: "Kind" }));
  expect(screen.queryByRole("option", { name: "Tracker" })).toBeNull();
  await user.click(await screen.findByRole("option", { name: "Repository" }));
  await user.type(screen.getByRole("textbox", { name: "Description" }), "Read test issues");
  const script = screen.getByRole("group", { name: "Repository script" }).querySelector<HTMLElement>(".cm-content")!;
  await user.click(script);
  await user.paste("echo checked");
  expect(await screen.findByText(/Choose (a Git hosting|an) account/)).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
  await user.click(screen.getByRole("combobox", { name: "Account" }));
  await user.click(await screen.findByRole("option", { name: "alice · github.com" }));
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  await screen.findByText("Saved node");
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("saveDefinition", {
    params: { path: "templates/nodes/issue-tracker.json" }, body: { content: expect.any(String), baseSha256: null },
  }));
  const saved: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(Node.parse(JSON.parse(saved.body.content))).toMatchObject({
    kind: "repository", account: "gh-alice", script: "echo checked",
  });
});

it("edits the template's agent session and keeps the changesFiles field", async () => {
  const node: Node = Node.parse({
    name: "builder", description: "Build the change", kind: "agent", prompt: "builder.md", outcomes: ["done"],
    changesFiles: false, timeoutSec: 60, agent: { tier: "standard" },
  });
  api.call.mockImplementation(async (route: string, input?: RouteInput<"getDefinition">) => {
    if (route === "listDefinitions") return [];
    if (route === "getDefinition") return { content: input?.params.path.endsWith(".md") ? "Build the change" : JSON.stringify(node), sha256: "node-v1" };
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "saveDefinition") return { sha256: "node-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/node/*", element: <NodeEditor /> }], { initialEntries: ["/edit/node/templates/nodes/builder.json"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  const user = userEvent.setup();
  const session: HTMLElement = await screen.findByRole("combobox", { name: "Agent session" });
  expect(session.textContent).toContain("Job");
  expect(screen.queryByRole("button", { name: "About Description" })).toBeNull();
  expect(screen.queryByRole("button", { name: "About Icon" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "About Agent session" }));
  const help: HTMLElement = await screen.findByRole("dialog", { name: "Agent session" });
  expect(help.textContent).toContain("Job: the agent, while working on this node, uses a session shared across the whole job, in every node it works on. Different agents never share a session.");
  expect(help.textContent).toContain("Node: the agent uses the same session each time it works on this node. The session is not shared outside it.");
  expect(help.textContent).toContain("New: the agent starts a new session every time it works on this node.");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("checkbox", { name: "Resume session" })).toBeNull();
  await user.click(session);
  expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Job", "Node", "New"]);
  await user.click(await screen.findByRole("option", { name: "Node" }));
  await user.click(screen.getByRole("checkbox", { name: "Can edit files" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const saved: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(saved.body.content)).toMatchObject({ agentSession: "node", changesFiles: true });
});
