import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DefinitionEntry, RecipeInput, RouteInput } from "@pecore/schemas";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { RecipeEditor } from "./RecipeEditor";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined, useLive: () => undefined }));
vi.mock("./RecipeGraph", () => ({
  RecipeGraph: ({ onSelect }: { onSelect(id: string): void }) => <button type="button" onClick={() => onSelect("review")}>Inspect review</button>,
}));

afterEach(cleanup);

it("inherits, overrides and resets the template's context and saves the assigned agent", async () => {
  const template: DefinitionEntry = {
    path: "templates/nodes/reviewer.json", sha256: "node-v1", errors: [],
    value: { name: "reviewer", kind: "agent", outcomes: ["done"], agentContext: "isolated" },
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
  const context: HTMLElement = await screen.findByRole("combobox", { name: "Agent context" });
  expect(context.textContent).toContain("Isolated");
  await user.click(context);
  await user.click(await screen.findByRole("option", { name: "Shared" }));
  expect(context.textContent).toContain("Shared");
  await user.click(screen.getByRole("combobox", { name: "Agent card" }));
  await user.click(await screen.findByRole("option", { name: "Peer" }));
  const save: HTMLButtonElement = screen.getByRole("button", { name: "Save" });
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const override: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(override.body.content).nodes.review).toMatchObject({ agentContext: "shared", agentId: "peer" });

  await user.click(screen.getByRole("button", { name: "Use template context" }));
  expect(context.textContent).toContain("Isolated");
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.click(save);
  const inherited: RouteInput<"saveDefinition"> = api.call.mock.calls.findLast(([route]) => route === "saveDefinition")?.[1];
  expect(JSON.parse(inherited.body.content).nodes.review).toEqual({ use: "reviewer", agentId: "peer" });
});
