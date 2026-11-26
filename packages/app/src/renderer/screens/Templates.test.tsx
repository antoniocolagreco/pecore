import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DefinitionEntry } from "@pecore/schemas";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ui } from "../components/ui";
import { ViewHistoryProvider } from "../components/ViewHistoryProvider";
import { NodeEditor } from "./NodeEditor";
import { Templates } from "./Templates";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined, useLive: () => undefined }));

const nodes: DefinitionEntry[] = [
  { path: "templates/nodes/alpha.json", sha256: "alpha", value: { name: "alpha", kind: "agent", tags: ["first"] }, errors: [] },
  { path: "templates/nodes/beta.json", sha256: "beta", value: { name: "beta", kind: "command", tags: ["second"] }, errors: [] },
];

beforeEach(() => {
  api.call.mockImplementation(async (route: string, input?: { query: { dir: string } }) => {
    if (route === "listDefinitions") return input?.query.dir === "templates/nodes" ? nodes : [];
    if (route === "getAgents") return { value: { agents: [] } };
    if (route === "getDefinition") return { content: JSON.stringify(nodes[0]!.value), sha256: "alpha" };
    if (route === "getNodeTemplateUsage") return [];
    if (route === "validateDefinition") return { errors: [], warnings: [] };
    throw new Error(`Unexpected route: ${route}`);
  });
});

afterEach(cleanup);

it("restores the node filter and scroll after opening a node and going back", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([
    { path: "/templates", element: <Templates /> },
    { path: "/edit/node/*", element: <NodeEditor /> },
  ], { initialEntries: ["/templates"] });
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });

  await screen.findByRole("link", { name: /Alpha/ });
  await user.type(screen.getByRole("searchbox", { name: "Search nodes" }), "alpha");
  expect(screen.queryByRole("link", { name: /Beta/ })).toBeNull();
  const viewport = () => screen.getByRole("heading", { name: "Templates", level: 1 }).closest<HTMLElement>(`.${ui.page}`)!;
  viewport().scrollTop = 240;
  fireEvent.scroll(viewport());

  await user.click(screen.getByRole("link", { name: /Alpha/ }));
  await screen.findByRole("heading", { name: "Alpha" });
  await act(() => router.navigate(-1));

  await screen.findByRole("link", { name: /Alpha/ });
  expect(screen.getByRole("searchbox", { name: "Search nodes" })).toHaveProperty("value", "alpha");
  expect(screen.queryByRole("link", { name: /Beta/ })).toBeNull();
  expect(viewport().scrollTop).toBe(240);

  await act(() => router.navigate(1));
  await user.click(await screen.findByRole("link", { name: "Back to templates" }));
  expect(screen.getByRole("searchbox", { name: "Search nodes" })).toHaveProperty("value", "alpha");
  expect(viewport().scrollTop).toBe(240);
});
