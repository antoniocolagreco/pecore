import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DefinitionEntry, RecipeInput, RouteInput } from "@pecore/schemas";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import type { Connection } from "@xyflow/react";
import { RecipeEditor } from "./RecipeEditor";
import { recipeEnd, recipeStart } from "./recipeLayout";
import type { RecipeLink } from "./recipeLayout";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined, useLive: () => undefined }));
vi.mock("./RecipeGraph", () => ({
  RecipeGraph: ({ onSelect, onConnect, onReconnect, onDelete }: {
    onSelect(id: string): void;
    onConnect(connection: Connection): void;
    onReconnect(from: string, outcome: string, to: string): void;
    onDelete(links: RecipeLink[]): void;
  }) => <>
    <button type="button" onClick={() => onSelect("review")}>Inspect review</button>
    <button type="button" onClick={() => onConnect({ source: "read", target: recipeEnd, sourceHandle: "right", targetHandle: "left" })}>Connect read to End</button>
    <button type="button" onClick={() => onConnect({ source: "read", target: "review", sourceHandle: "right", targetHandle: null })}>Connect read to review</button>
    <button type="button" onClick={() => onConnect({ source: "review", target: recipeEnd, sourceHandle: "right", targetHandle: null })}>Connect review to End</button>
    <button type="button" onClick={() => onReconnect("read", "failure", "review")}>Reconnect failure to review</button>
    <button type="button" onClick={() => onReconnect("read", "success", recipeEnd)}>Reconnect success to End</button>
    <button type="button" onClick={() => onReconnect("review", "approved", recipeEnd)}>Reconnect approval to End</button>
    <button type="button" onClick={() => onReconnect(recipeStart, "", "review")}>Reconnect Start to review</button>
    <button type="button" onClick={() => onDelete([{ from: "read", on: "failure", to: "review" }])}>Delete failure</button>
  </>,
}));

afterEach(cleanup);

it("adds Start's job request to Reads from without adding it to Requires", async () => {
  const template: DefinitionEntry = {
    path: "templates/nodes/review.json", sha256: "node-v1", errors: [], value: { name: "review", kind: "human", outcomes: ["approved"] },
  };
  const recipe: RecipeInput = {
    name: "request-review", description: "Review the request", start: "review", nodes: { review: { use: "review" } },
    ends: [{ from: "review", on: "approved", result: "succeeded" }],
  };
  api.call.mockClear();
  api.call.mockImplementation(async (route: string, input?: RouteInput<"listDefinitions">) => {
    if (route === "listDefinitions") return input?.query.dir === "templates/nodes" ? [template] : [];
    if (route === "getDefinition") return { content: JSON.stringify(recipe), sha256: "recipe-v1" };
    if (route === "getAgents") return { value: { agents: [] } };
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "saveDefinition") return { sha256: "recipe-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/recipe/*", element: <RecipeEditor /> }], { initialEntries: ["/edit/recipe/templates/recipes/request-review.json"] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Inspect review" }));
  await user.click(screen.getByRole("combobox", { name: "Requires" }));
  expect(screen.queryByRole("option", { name: "Start (job request)" })).toBeNull();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("combobox", { name: "Reads from" }));
  await user.click(await screen.findByRole("option", { name: "Start (job request)" }));
  await user.keyboard("{Escape}");
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const request: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(request.body.content).nodes.review.reads).toEqual(["@start"]);
});

it("shows the validation sentence and lets the user clear the base-change step", async () => {
  const recipe: RecipeInput = {
    name: "route", description: "Change the base branch", start: "spec", onBaseChanged: "rebase",
    nodes: { spec: { use: "spec-writer" }, rebase: { use: "git-rebase" }, pr: { use: "github-pr" } },
  };
  const message: string = "GitHub PR needs the spec from Spec Writer. A base change can restart at Git Rebase before Spec Writer has produced it.";
  api.call.mockClear();
  api.call.mockImplementation(async (route: string, input?: RouteInput<"validateDefinition">) => {
    if (route === "listDefinitions") return [];
    if (route === "getDefinition") return { content: JSON.stringify(recipe), sha256: "v1" };
    if (route === "getAgents") return { value: { agents: [] } };
    if (route === "validateDefinition") return {
      errors: JSON.parse(input!.body.content).onBaseChanged ? [{ file: "route.json", path: "nodes.pr.reads", message }] : [], warnings: [],
    };
    if (route === "saveDefinition") return { sha256: "v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/recipe/*", element: <RecipeEditor /> }], { initialEntries: ["/edit/recipe/templates/recipes/route.json"] });
  render(<RouterProvider router={router} />);
  await screen.findByText(message);
  expect(screen.queryByText(/nodes\.pr\.reads/)).toBeNull();
  const user = userEvent.setup();
  const setting: HTMLElement = screen.getByRole("combobox", { name: "Base-change step" });
  expect(setting.textContent).toContain("Git Rebase");
  await user.click(setting);
  await user.click(await screen.findByRole("option", { name: "Keep the current result" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const request: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(request.body.content)).not.toHaveProperty("onBaseChanged");
});

it("uses one outcome selection per connection and asks for a job result only for a named path to End", async () => {
  const template: DefinitionEntry = {
    path: "templates/nodes/github-ticket-read.json", sha256: "node-v1", errors: [],
    value: { name: "github-ticket-read", kind: "agent", outcomes: ["success", "failure"] },
  };
  const review: DefinitionEntry = {
    path: "templates/nodes/review.json", sha256: "node-v2", errors: [],
    value: { name: "review", kind: "human", outcomes: ["approved", "changes_requested", "rejected"] },
  };
  const recipe: RecipeInput = {
    name: "review", description: "Read and review the ticket", start: "read",
    nodes: { read: { use: "github-ticket-read" }, review: { use: "review" } },
    ends: [{ from: "read", on: "success", result: "succeeded" }],
  };
  api.call.mockClear();
  api.call.mockImplementation(async (route: string, input?: RouteInput<"listDefinitions">) => {
    if (route === "listDefinitions") return input?.query.dir === "templates/nodes" ? [template, review] : [];
    if (route === "getDefinition") return { content: JSON.stringify(recipe), sha256: "recipe-v1" };
    if (route === "getAgents") return { value: { agents: [] } };
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "saveDefinition") return { sha256: "recipe-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/recipe/*", element: <RecipeEditor /> }], { initialEntries: ["/edit/recipe/templates/recipes/review.json"] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Connect read to End" }));
  await user.click(screen.getByRole("combobox", { name: "Outcome" }));
  await user.click(await screen.findByRole("option", { name: "Failure" }));
  expect(screen.queryByRole("combobox", { name: "Job result" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await user.click(screen.getByRole("button", { name: "Connect read to review" }));
  await user.click(screen.getByRole("combobox", { name: "Outcome" }));
  await user.click(await screen.findByRole("option", { name: "Success" }));
  expect(screen.queryByRole("combobox", { name: "Job result" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Connect" }));
  await user.click(screen.getByRole("button", { name: "Connect review to End" }));
  await user.click(screen.getByRole("combobox", { name: "Outcome" }));
  await user.click(await screen.findByRole("option", { name: "Approved" }));
  expect(screen.getByRole("combobox", { name: "Job result" }).textContent).toContain("Success");
  await user.click(screen.getByRole("combobox", { name: "Job result" }));
  await user.click(await screen.findByRole("option", { name: "Not delivered" }));
  await user.click(screen.getByRole("button", { name: "Connect" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const request: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(request.body.content)).toMatchObject({
    edges: [{ from: "read", on: "success", to: "review" }],
    ends: [{ from: "read", on: "failure", result: "failed" }, { from: "review", on: "approved", result: "not_delivered" }],
  });
});

it("inherits, overrides and resets the template's session and saves the assigned agent", async () => {
  const template: DefinitionEntry = {
    path: "templates/nodes/reviewer.json", sha256: "node-v1", errors: [],
    value: { name: "reviewer", kind: "agent", outcomes: ["done"], agentSession: "new" },
  };
  const recipe: RecipeInput = {
    name: "review", description: "Review the change", start: "review", ends: [{ from: "review", on: "done", result: "succeeded" }],
    nodes: { review: { use: "reviewer" } },
  };
  api.call.mockImplementation(async (route: string, input?: RouteInput<"listDefinitions">) => {
    if (route === "listDefinitions") return input?.query.dir === "templates/nodes" ? [template] : [];
    if (route === "getDefinition") return { content: JSON.stringify(recipe), sha256: "recipe-v1" };
    if (route === "getAgents") return { value: { agents: [{ id: "agent-default", name: "Default Agent" }, { id: "peer", name: "Peer" }] } };
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "saveDefinition") return { sha256: "recipe-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/recipe/*", element: <RecipeEditor /> }], { initialEntries: ["/edit/recipe/templates/recipes/review.json"] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Inspect review" }));
  const session: HTMLElement = await screen.findByRole("combobox", { name: "Agent session" });
  expect(session.textContent).toContain("New");
  expect(screen.getByRole("button", { name: "About Agent session" })).toBeTruthy();
  await user.click(session);
  await user.click(await screen.findByRole("option", { name: "Node" }));
  expect(session.textContent).toContain("Node");
  await user.click(screen.getByRole("combobox", { name: "Agent card" }));
  await user.click(await screen.findByRole("option", { name: "Peer" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const override: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(override.body.content).nodes.review).toMatchObject({ agentSession: "node", agentId: "peer" });

  await user.click(screen.getByRole("button", { name: "Use template session" }));
  expect(session.textContent).toContain("New");
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const inherited: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(inherited.body.content).nodes.review).toEqual({ use: "reviewer", agentId: "peer" });
});

it("keeps the outcome when reconnecting Start, steps and End, and saves deletion", async () => {
  const recipe: RecipeInput = {
    name: "review", description: "Read and review", start: "read",
    nodes: { read: { use: "github-ticket-read" }, review: { use: "review" }, retry: { use: "review" } },
    edges: [{ from: "read", on: "failure", to: "retry", maxRounds: 2 },
      { from: "read", on: "success", to: "review" }, { from: "review", on: "approved", to: "retry" }],
  };
  api.call.mockClear();
  api.call.mockImplementation(async (route: string) => {
    if (route === "listDefinitions") return [];
    if (route === "getDefinition") return { content: JSON.stringify(recipe), sha256: "recipe-v1" };
    if (route === "getAgents") return { value: { agents: [] } };
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    if (route === "saveDefinition") return { sha256: "recipe-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([{ path: "/edit/recipe/*", element: <RecipeEditor /> }], { initialEntries: ["/edit/recipe/templates/recipes/review.json"] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await screen.findByText("Base-change step");
  await user.click(screen.getByRole("button", { name: "Reconnect failure to review" }));
  await user.click(screen.getByRole("button", { name: "Reconnect success to End" }));
  await user.click(screen.getByRole("button", { name: "Reconnect Start to review" }));
  expect(screen.queryByRole("combobox", { name: "Outcome" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Reconnect approval to End" }));
  expect(screen.queryByRole("combobox", { name: "Outcome" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Job result" }).textContent).toContain("Success");
  await user.click(screen.getByRole("button", { name: "Reconnect" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const first: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(first.body.content)).toMatchObject({
    start: "review", edges: [{ from: "read", on: "failure", to: "review", maxRounds: 2 }],
    ends: [{ from: "read", on: "success", result: "succeeded" }, { from: "review", on: "approved", result: "succeeded" }],
  });
  await user.click(screen.getByRole("button", { name: "Delete failure" }));
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const second: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(second.body.content).edges).toEqual([]);
});
