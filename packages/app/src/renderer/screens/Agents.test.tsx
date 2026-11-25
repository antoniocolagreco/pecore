import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AgentCatalogEditor, ProjectManagerSettings } from "./Agents";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined }));

afterEach(cleanup);

it("can create an unconfigured card while the provider controls show Unavailable", async () => {
  api.call.mockReset();
  api.call.mockImplementation(async (route: string) => {
    if (route === "getAgents") return { value: { agents: [] }, sha256: "agents-v1" };
    if (route === "getAccounts") return { value: { accounts: [] } };
    if (route === "getSetup") return { modelAccountWorks: false };
    if (route === "putAgents") return { sha256: "agents-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([
    { path: "/agents/edit", element: <AgentCatalogEditor /> },
    { path: "/agents", element: <span>Agents list</span> },
  ], { initialEntries: ["/agents/edit"] });
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Reviewer");
  const provider = screen.getByRole("combobox", { name: "Provider" });
  expect(provider.textContent).toContain("Unavailable");
  for (const label of ["Provider", "Model", "Effort"]) {
    const field = screen.getByRole("combobox", { name: label });
    expect(field.matches(":disabled") || field.getAttribute("aria-disabled") === "true").toBe(true);
  }
  await user.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putAgents", {
    body: { value: { agents: [expect.objectContaining({ name: "Reviewer", model: null })] }, baseSha256: "agents-v1" },
  }));
});

it("selects a card for the current project's PM and saves its ID", async () => {
  api.call.mockImplementation(async (route: string) => {
    if (route === "getChatAgentSettings") return {
      value: { kind: "pm", id: "pm-demo", name: "Chris", color: "#DC2626", cardId: "agent-default" }, sha256: "pm-v1",
    };
    if (route === "getAgents") return { value: { agents: [
      { id: "assistant", name: "Assistant" }, { id: "agent-default", name: "Default Agent" }, { id: "reviewer", name: "Reviewer" },
    ] } };
    if (route === "getAgentContext") return { content: "", sha256: "context-v1" };
    if (route === "putChatAgentSettings") return { sha256: "pm-v2" };
    throw new Error(`Unexpected route ${route}`);
  });
  const user = userEvent.setup();
  render(<ProjectManagerSettings project="demo" />);
  const select: HTMLElement = await screen.findByRole("combobox", { name: "Agent card" });
  await waitFor(() => expect(select.textContent).toContain("Default Agent"));
  await user.click(select);
  expect(screen.queryByRole("option", { name: "Assistant" })).toBeNull();
  await user.click(await screen.findByRole("option", { name: "Reviewer" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putChatAgentSettings", {
    query: { project: "demo" },
    body: { value: { kind: "pm", id: "pm-demo", name: "Chris", color: "#DC2626", cardId: "reviewer" }, baseSha256: "pm-v1" },
  }));
});
