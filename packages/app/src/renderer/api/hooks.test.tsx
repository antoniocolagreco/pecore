import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { ApiError } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { useAction, useAutoSave, useData } from "./hooks";
import type { Data } from "./hooks";

const live = vi.hoisted(() => ({
  connected: false,
  listeners: new Set<(message: LiveMessage) => void>(),
}));

vi.mock("./live", () => ({
  useConnected: () => live.connected,
  onLive: (listener: (message: LiveMessage) => void) => {
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  live.connected = false;
});

it("keeps the current value when refresh fails, and coalesces matching live refreshes", async () => {
  const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("old").mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce("new");
  const hook = renderHook(() => useData(load, [], ({ type }) => type === "project.updated"));
  await waitFor(() => expect(hook.result.current.data).toBe("old"));
  act(hook.result.current.reload);
  await waitFor(() => expect(hook.result.current.error?.message).toBe("Offline"));
  expect(hook.result.current.data).toBe("old");
  act(() => {
    for (const listener of live.listeners) {
      listener({ type: "definition.changed", path: "settings.json", sha256: "rev" });
      listener({ type: "project.updated", projectId: "demo" });
      listener({ type: "project.updated", projectId: "demo" });
    }
  });
  await waitFor(() => expect(hook.result.current.data).toBe("new"));
  expect(load).toHaveBeenCalledTimes(3);
  expect(hook.result.current.error).toBeNull();
  hook.unmount();
  expect(live.listeners.size).toBe(0);
});

it("saves the last valid edit and uses the new revision for the next write", async () => {
  vi.useFakeTimers();
  const remote: Data<{ value: string; sha256: string }> = {
    data: { value: "old", sha256: "v1" }, loading: false, error: null, reload: vi.fn(),
  };
  const put = vi.fn<(body: { value: string; baseSha256: string }) => Promise<{ sha256: string }>>()
    .mockResolvedValueOnce({ sha256: "v2" }).mockResolvedValueOnce({ sha256: "v3" });
  const hook = renderHook(() => useAutoSave(remote, put, (value) => value.trim() !== ""));
  act(() => {
    hook.result.current.update("");
    hook.result.current.update("final");
  });
  expect(hook.result.current.value).toBe("final");
  expect(put).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(put).toHaveBeenCalledExactlyOnceWith({ value: "final", baseSha256: "v1" });
  await act(async () => { await hook.result.current.commit("second"); });
  expect(put).toHaveBeenLastCalledWith({ value: "second", baseSha256: "v2" });
  act(() => hook.result.current.update(" "));
  await act(() => vi.advanceTimersByTimeAsync(600));
  expect(put).toHaveBeenCalledTimes(2);
  expect(hook.result.current.saving).toBe(false);
});

it("reloads the record after a stale edit and shows other write errors directly", async () => {
  const reload = vi.fn();
  const remote: Data<{ value: string; sha256: string }> = {
    data: { value: "current", sha256: "v1" }, loading: false, error: null, reload,
  };
  const put = vi.fn<() => Promise<{ sha256: string }>>()
    .mockRejectedValueOnce(new ApiError(409, "conflict", "Changed outside this window"))
    .mockRejectedValueOnce(new Error("Database closed"));
  const hook = renderHook(() => useAutoSave(remote, put));
  await act(async () => expect(await hook.result.current.commit("new")).toBe(false));
  expect(reload).toHaveBeenCalledOnce();
  expect(hook.result.current.error).toContain("Changed elsewhere");
  expect(hook.result.current.value).toBe("current");
  await act(async () => expect(await hook.result.current.commit("again")).toBe(false));
  expect(hook.result.current.error).toBe("Database closed");
});

it("clears a failed action and allows a retry", async () => {
  const save = vi.fn<(value: string) => Promise<void>>().mockRejectedValueOnce("Network offline").mockResolvedValueOnce(undefined);
  const hook = renderHook(() => useAction(save));
  await act(async () => expect(await hook.result.current.run("first")).toBe(false));
  expect(hook.result.current.error).toBe("Network offline");
  act(hook.result.current.clear);
  expect(hook.result.current.error).toBeNull();
  await act(async () => expect(await hook.result.current.run("second")).toBe(true));
  expect(save).toHaveBeenLastCalledWith("second");
  expect(hook.result.current.busy).toBe(false);
});
