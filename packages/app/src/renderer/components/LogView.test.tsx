import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@pecore/schemas";
import type { LiveMessage, LogEvent } from "@pecore/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogView } from "./LogView";

const api = vi.hoisted(() => ({
  call: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  connected: true,
  listeners: new Set<(message: LiveMessage) => void>(),
}));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({
  useConnected: () => api.connected,
  subscribeLog: (id: string) => {
    api.subscribe(id);
    return () => api.unsubscribe(id);
  },
  onLive: (listener: (message: LiveMessage) => void) => {
    api.listeners.add(listener);
    return () => api.listeners.delete(listener);
  },
}));

function deliver(message: LiveMessage): void {
  for (const listener of api.listeners) listener(message);
}

beforeEach(() => {
  api.call.mockReset();
  api.subscribe.mockClear();
  api.unsubscribe.mockClear();
  api.connected = true;
});

afterEach(cleanup);

describe("attempt log", () => {
  it("renders stored ACP events and displays the same attempt as raw JSON on request", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const events: LogEvent[] = [
      { type: "text", text: "Writing the spec", at: 1 },
      { type: "tool_call", toolCallId: "call", title: "Read the ticket", kind: "read", status: "completed", at: 2 },
      { type: "permission", toolCallId: "", optionId: null, at: 3 },
      { type: "stderr", text: "Harness diagnostic", at: 4 },
      { type: "output", text: "Done", at: 5 },
    ];
    const line: { dir: string; line: string; at: number } = { dir: "err", line: "Harness diagnostic", at: 4 };
    api.call.mockResolvedValueOnce({ view: "events", events }).mockResolvedValue({ view: "raw", lines: [line] });
    render(<LogView attemptId="attempt-a" running={false} />);

    expect(screen.getByText("Loading log…")).toBeTruthy();
    expect(await screen.findByText("Writing the spec")).toBeTruthy();
    expect(screen.getByText("Read the ticket · read · completed")).toBeTruthy();
    expect(screen.getByText("Permission · Tool call")).toBeTruthy();
    expect(screen.getByText("stderr · Harness diagnostic")).toBeTruthy();
    expect(screen.getByText("Output · Done")).toBeTruthy();
    expect(api.subscribe).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Raw" }));
    expect(await screen.findByText(JSON.stringify(line))).toBeTruthy();
    expect(api.call).toHaveBeenCalledWith("getLog", { params: { id: "attempt-a" }, query: { view: "raw" } });
  });

  it("subscribes to the open attempt, merges live events, and ignores other attempts", async () => {
    const saved: LogEvent = { type: "text", text: "Saved", at: 5 };
    api.call.mockResolvedValue({ view: "events", events: [{ type: "text", text: "Earlier", at: 4 }, saved] });
    const mounted: ReturnType<typeof render> = render(<LogView attemptId="attempt-a" running />);
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(api.subscribe).toHaveBeenCalledWith("attempt-a");

    act(() => {
      deliver({ type: "log.line", attemptId: "attempt-b", event: { type: "text", text: "Other attempt", at: 6 } });
      deliver({ type: "log.line", attemptId: "attempt-a", event: saved });
      deliver({ type: "log.line", attemptId: "attempt-a", event: { type: "text", text: "Live", at: 7 } });
    });
    expect(await screen.findByText("Live")).toBeTruthy();
    expect(screen.getAllByText("Saved")).toHaveLength(1);
    expect(screen.queryByText("Other attempt")).toBeNull();
    mounted.unmount();
    expect(api.unsubscribe).toHaveBeenCalledWith("attempt-a");
    expect(api.listeners.size).toBe(0);
  });

  it("opens older events and returns to the latest page", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const events: LogEvent[] = Array.from({ length: 151 }, (_, i) => ({ type: "text", text: `Event ${i}`, at: i }));
    api.call.mockResolvedValue({ view: "events", events });
    render(<LogView attemptId="attempt-a" running={false} />);
    expect(await screen.findByText("Event 150")).toBeTruthy();
    expect(screen.queryByText("Event 0")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show more (older)" }));
    expect(screen.getByText("Event 0")).toBeTruthy();
    expect(screen.queryByText("Event 150")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Newer" }));
    expect(screen.getByText("Event 150")).toBeTruthy();
  });

  it("shows that an omitted log is unavailable in both views", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    api.call.mockRejectedValue(new ApiError(410, "gone", "the attempt log is unavailable"));
    render(<LogView attemptId="imported" running={false} />);
    expect(await screen.findByText("Log unavailable")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Raw" }));
    expect(await screen.findByText("Log unavailable")).toBeTruthy();
  });

  it("distinguishes an empty log from a failed request and disables controls offline", async () => {
    api.connected = false;
    api.call.mockResolvedValueOnce({ view: "events", events: [] }).mockRejectedValue(new Error("Engine disconnected"));
    const mounted: ReturnType<typeof render> = render(<LogView attemptId="empty" running={false} />);
    expect(await screen.findByText("No log events.")).toBeTruthy();
    const raw: HTMLElement = screen.getByRole("button", { name: "Raw" });
    expect(raw.hasAttribute("disabled")).toBe(true);
    mounted.rerender(<LogView attemptId="missing" running={false} />);
    await waitFor(() => expect(screen.getByText("Engine disconnected")).toBeTruthy());
  });
});
