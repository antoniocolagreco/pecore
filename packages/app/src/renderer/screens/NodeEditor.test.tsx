import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Node } from "@pecore/schemas";
import type { RouteInput } from "@pecore/schemas";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { NodeEditor } from "./NodeEditor";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined, useLive: () => undefined }));

afterEach(cleanup);

it("creates a Source node through the normal template editor", async () => {
  api.call.mockImplementation(async (route: string, input?: RouteInput<"validateDefinition"> | RouteInput<"saveDefinition">) => {
    if (route === "listDefinitions") return [];
    if (route === "validateDefinition") {
      const parsed = Node.safeParse(JSON.parse(input?.body.content ?? ""));
      return { errors: parsed.success ? [] : parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })), warnings: [] };
    }
    if (route === "saveDefinition") return { sha256: "source-v1" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([
    { path: "/templates/nodes/new", element: <NodeEditor newTemplate /> },
    { path: "/edit/node/*", element: <span>Saved Source</span> },
  ], { initialEntries: ["/templates/nodes/new"] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "issue-source");
  await user.click(screen.getByRole("combobox", { name: "Kind" }));
  await user.click(await screen.findByRole("option", { name: "Source" }));
  await user.type(screen.getByRole("textbox", { name: "Description" }), "Read test issues");
  const commands: Record<string, string> = { List: "list", Read: "read", Comment: "comment", Replies: "replies" };
  for (const [label, command] of Object.entries(commands)) {
    await user.type(screen.getByRole("textbox", { name: `${label} command` }), `fixture-cli ${command}`);
  }
  const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  await screen.findByText("Saved Source");
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("saveDefinition", {
    params: { path: "templates/nodes/issue-source.json" }, body: { content: expect.any(String), baseSha256: null },
  }));
  const saved: RouteInput<"saveDefinition"> = api.call.mock.calls.find(([route]) => route === "saveDefinition")?.[1];
  expect(Node.parse(JSON.parse(saved.body.content))).toMatchObject({
    kind: "source", list: { command: ["fixture-cli", "list"] }, read: { command: ["fixture-cli", "read"] },
    comment: { command: ["fixture-cli", "comment"] }, replies: { command: ["fixture-cli", "replies"] },
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
  render(<RouterProvider router={router} />);
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
