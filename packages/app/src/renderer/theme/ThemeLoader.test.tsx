import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Settings } from "@pecore/schemas";
import type { LiveMessage, Theme } from "@pecore/schemas";
import { ThemeLoader } from "./ThemeLoader";

const api = vi.hoisted(() => ({
  call: vi.fn(),
  listeners: new Set<(message: LiveMessage) => void>(),
}));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({
  useConnected: () => true,
  onLive: (listener: (message: LiveMessage) => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));

const media: EventTarget = new EventTarget();

beforeEach(() => {
  api.call.mockReset();
  vi.stubGlobal("matchMedia", () => Object.assign(media, { matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("loads a custom theme by record ID and refreshes it after a catalog update", async () => {
  let theme: Theme = { name: "Clear Blue", tokens: { bg: "#fff", accent: "#004488" } };
  api.call.mockImplementation(async (route: string) => route === "getSettings"
    ? { value: Settings.parse({ ui: { mode: "light", theme: "blue" } }), sha256: "settings" }
    : [{ id: "blue", theme }]);
  const mounted: ReturnType<typeof render> = render(<ThemeLoader />);
  const root: HTMLElement = document.documentElement;
  await waitFor(() => expect(root.style.getPropertyValue("--accent")).toBe("#004488"));
  expect(root.dataset.theme).toBe("light");

  theme = { name: "Clear Blue", tokens: { bg: "#fff", accent: "#005599" } };
  act(() => {
    for (const listener of api.listeners) listener({ type: "definition.changed", path: "themes/blue", sha256: "theme" });
  });
  await waitFor(() => expect(root.style.getPropertyValue("--accent")).toBe("#005599"), { timeout: 1500 });
  mounted.unmount();
  expect(root.style.getPropertyValue("--accent")).toBe("");
});

it("follows system mode and applies a custom theme only when its background matches", async () => {
  api.call.mockImplementation(async (route: string) => route === "getSettings"
    ? { value: Settings.parse({ ui: { mode: "system", theme: "night" } }), sha256: "settings" }
    : [{ id: "night", theme: { name: "Night", tokens: { bg: "#111", accent: "#caf" } } }]);
  render(<ThemeLoader />);
  const root: HTMLElement = document.documentElement;
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("listThemes"));
  expect(root.dataset.theme).toBe("light");
  expect(root.style.getPropertyValue("--accent")).toBe("");
  act(() => {
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event("change"));
  });
  await waitFor(() => expect(root.style.getPropertyValue("--accent")).toBe("#caf"));
  expect(root.dataset.theme).toBe("dark");
});
