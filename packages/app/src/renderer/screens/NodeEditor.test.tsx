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
