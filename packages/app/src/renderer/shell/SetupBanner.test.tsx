import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LiveMessage } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { SetupBanner } from "./SetupBanner";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const emit = (message: LiveMessage): void => act(() => {
  for (const listener of [...api.listeners]) listener(message);
});

it("opens the login page once and never a URL that is not https", async () => {
  api.call.mockImplementation(async (route: string) => {
    if (route === "getSetup") return { modelAccountWorks: false, harnesses: [{ connector: "claude-code", installed: true, version: "2.0.0", loggedIn: false }] };
    if (route === "startSetupLogin") return { loginId: "claude-code:local" };
    throw new Error(`Unexpected route ${route}`);
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(<SetupBanner />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Log in to Claude Code" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("startSetupLogin", { params: { connector: "claude-code" } }));

  emit({ type: "login.progress", loginId: "claude-code:local", text: "Open the page", url: "http://claude.example.test/login", done: false });
  expect(open).not.toHaveBeenCalled();

  emit({ type: "login.progress", loginId: "claude-code:local", text: "Open the page", url: "https://claude.example.test/login?state=two", done: false });
  await waitFor(() => expect(open).toHaveBeenCalledWith("https://claude.example.test/login?state=two", "_blank", "noreferrer"));
  emit({ type: "login.progress", loginId: "claude-code:local", text: "Waiting for the code", url: "https://claude.example.test/login?state=two", done: false });
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Open login URL" })).toBeTruthy();
});
