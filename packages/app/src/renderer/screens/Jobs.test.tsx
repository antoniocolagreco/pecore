import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobView, RouteInput } from "@pecore/schemas";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Factory } from "./Factory";
import { Jobs } from "./Jobs";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined }));

const parent: JobView = {
  id: "parent", title: "Review login", projectId: "demo", recipe: "feature", state: "waiting", waitingReason: "human",
  failureReason: null, parentJobId: null, baseBranch: "main", base: null, target: "main", branch: "factory/parent",
  archived: false, mergedAt: null, createdAt: 1, updatedAt: 3000,
};

const child: JobView = {
  id: "child", title: "Update login docs", projectId: "demo", recipe: "feature", state: "queued", waitingReason: "parent_job",
  failureReason: null, parentJobId: "parent", baseBranch: "main", base: null, target: "factory/parent", branch: "factory/child",
  archived: false, mergedAt: null, createdAt: 2, updatedAt: 4000,
};

const failed: JobView = {
  id: "failed", title: "Build failed", projectId: "demo", recipe: "feature", state: "failed", waitingReason: null,
  failureReason: "INVALID_OUTPUT", parentJobId: null, baseBranch: "main", base: null, target: "main", branch: "factory/failed",
  archived: false, mergedAt: null, createdAt: 3, updatedAt: 5000,
};

beforeEach(() => {
  api.call.mockReset();
  let interrupted: number = 1;
  api.call.mockImplementation(async (route: string, input?: RouteInput<"getJob">) => {
    if (route === "listJobs") return [parent, child, failed];
    if (route === "listProjects") return [];
    if (route === "getJob") return { job: [parent, child, failed].find(({ id }) => id === input?.params.id), nodeRuns: [] };
    if (route === "getStatus") return { interrupted, notifications: 2 };
    if (route === "playInterrupted") { interrupted = 0; return { ok: true }; }
    if (route === "pauseJob" || route === "stopJob") return { ok: true };
    if (route === "whyJob") return { reasons: [{ queueItemId: "review-1" }] };
    throw new Error(`Unexpected route ${route}`);
  });
});

afterEach(cleanup);

it("collapses stacked jobs, searches titles and shows a failed job's reason", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Jobs /></MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Update login docs" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Collapse stacked jobs" }));
  expect(screen.queryByRole("button", { name: "Update login docs" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Expand stacked jobs" }));
  expect(screen.getByRole("button", { name: "Update login docs" })).toBeTruthy();

  const search: HTMLElement = screen.getByPlaceholderText("Search job titles");
  await user.type(search, "build");
  expect(screen.getByRole("button", { name: "Build failed" })).toBeTruthy();
  expect(screen.getByText("INVALID_OUTPUT")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review login" })).toBeNull();
  await user.type(search, " impossible");
  expect(screen.getByText("No jobs match these filters.")).toBeTruthy();
});

it("offers recovery after a restart and takes a pending review to Notifications", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter>
    <Routes>
      <Route path="/" element={<Factory />} />
      <Route path="/notifications/review-1" element={<p>Review opened</p>} />
    </Routes>
  </MemoryRouter>);
  expect(await screen.findByRole("button", { name: "Review login" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Build failed" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Play interrupted jobs" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Play interrupted jobs" })).toBeNull());
  await user.click(screen.getByRole("button", { name: "Review login" }));
  expect(await screen.findByText("Review opened")).toBeTruthy();
  expect(api.call).toHaveBeenCalledWith("whyJob", { params: { id: "parent" } });
});

it("restores job filters and collapsed stacks after opening a job", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([
    { path: "/jobs", element: <Jobs /> },
    { path: "/jobs/:id", element: <h1>Job opened</h1> },
  ], { initialEntries: ["/jobs"] });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Review login" });
  await user.type(screen.getByPlaceholderText("Search job titles"), "login");
  await user.click(screen.getByRole("button", { name: "Collapse stacked jobs" }));
  await user.click(screen.getByRole("button", { name: "Review login" }));
  await screen.findByRole("heading", { name: "Job opened" });
  await act(() => router.navigate(-1));
  expect((await screen.findByPlaceholderText("Search job titles"))).toHaveProperty("value", "login");
  expect(await screen.findByRole("button", { name: "Expand stacked jobs" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Update login docs" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Build failed" })).toBeNull();
});
