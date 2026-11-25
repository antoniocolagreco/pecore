import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Accounts, Settings as SettingsSchema } from "@pecore/schemas";
import type { Theme } from "@pecore/schemas";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Settings } from "./Settings";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined, useLive: () => undefined }));

beforeEach(() => {
  api.call.mockReset();
  api.call.mockImplementation(async (route: string, input?: unknown) => {
    if (route === "getSettings") return { value: SettingsSchema.parse({}), sha256: "settings-v1" };
    if (route === "getAccounts") return { value: Accounts.parse({}), sha256: "accounts-v1" };
    if (route === "getStatus") return { homeFindings: [], globalPause: false, notifications: 0, interrupted: 0, version: "test" };
    if (route === "listThemes") return [];
    if (route === "putSettings") return { sha256: "settings-v2" };
    if (route === "putTheme") return input;
    throw new Error(`Unexpected route ${route}`);
  });
});

afterEach(cleanup);

it("loads preferences and saves the updated name with its current revision", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const name: HTMLElement = await screen.findByRole("textbox", { name: "Your name" });
  expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Project Manager" })).toBeNull();
  await user.type(name, "Antonio");

  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putSettings", {
    body: { value: expect.objectContaining({ user: { name: "Antonio" } }), baseSha256: "settings-v1" },
  }), { timeout: 1500 });
});

it("imports theme tokens and rejects invalid colours before writing", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const mounted: ReturnType<typeof render> = render(<MemoryRouter><Settings /></MemoryRouter>);
  await screen.findByRole("button", { name: "Import theme" });
  const input: HTMLInputElement = mounted.container.querySelector<HTMLInputElement>("input[type=file]")!;
  await user.upload(input, new File(['{"name":"Invalid","tokens":{"accent":"url(x)"}}'], "invalid.json", { type: "application/json" }));
  expect(await screen.findByText(/tokens\.accent/)).toBeTruthy();
  expect(api.call.mock.calls.some(([method]) => method === "putTheme")).toBe(false);

  const theme: Theme = { name: "Ocean", tokens: { bg: "#fff", accent: "#003344" } };
  await user.upload(input, new File([JSON.stringify(theme)], "ocean.json", { type: "application/json" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putTheme", { params: { id: "ocean" }, body: theme }));
  expect(screen.queryByText(/tokens\.accent/)).toBeNull();
});
