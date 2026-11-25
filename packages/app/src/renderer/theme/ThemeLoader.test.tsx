import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Settings } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
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

it("applies a bundled palette and reloads it when the settings change", async () => {
  let theme: string = "builtin:autumn";
  api.call.mockImplementation(async () => ({
    value: Settings.parse({ ui: { mode: "light", theme } }), sha256: "settings",
  }));
  render(<ThemeLoader />);
  const root: HTMLElement = document.documentElement;
  await waitFor(() => expect(root.dataset.palette).toBe("autumn-light"));
  expect(root.dataset.theme).toBe("light");

  theme = "builtin:woodlands";
  act(() => {
    for (const listener of api.listeners) listener({ type: "configuration.changed", kind: "settings" });
  });
  await waitFor(() => expect(root.dataset.palette).toBe("woodlands-light"));
});

it("uses Default for a saved imported theme and still follows system mode", async () => {
  api.call.mockResolvedValue({ value: Settings.parse({ ui: { mode: "system", theme: "night" } }), sha256: "settings" });
  const root: HTMLElement = document.documentElement;
  root.dataset.palette = "autumn-dark";
  render(<ThemeLoader />);
  await waitFor(() => expect(root.dataset.palette).toBeUndefined());
  expect(root.dataset.theme).toBe("light");
  act(() => {
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event("change"));
  });
  await waitFor(() => expect(root.dataset.theme).toBe("dark"));
  expect(root.dataset.palette).toBeUndefined();
});
