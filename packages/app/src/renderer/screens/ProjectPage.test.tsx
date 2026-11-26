import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Project } from "@pecore/schemas";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ViewHistoryProvider } from "../components/ViewHistoryProvider";
import { ProjectPage } from "./ProjectPage";

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined }));

afterEach(cleanup);

it("restores the project's tab and expanded variable on Forward", async () => {
  const project = Project.parse({ id: "garden", name: "Garden", repo: null, variables: { tools: { editor: "Helix" } } });
  const view = { id: "garden", project, creating: false, errors: [] };
  api.call.mockImplementation(async (route: string) => {
    if (route === "getProject") return view;
    if (route === "listProjects") return [view];
    if (route === "listJobs") return [];
    if (route === "getDefinition") return { content: JSON.stringify(project), sha256: "project-start" };
    throw new Error(`Unexpected route ${route}`);
  });
  const router = createMemoryRouter([
    { path: "/", element: <h1>Factory</h1> },
    { path: "/projects/:id", element: <ProjectPage /> },
  ]);
  render(<RouterProvider router={router} />, { wrapper: ViewHistoryProvider });
  await act(() => router.navigate("/projects/garden"));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "Variables" }));
  const details = () => screen.getByText("1 keys").closest("details")!;
  await user.click(await screen.findByText("1 keys"));
  fireEvent(details(), new Event("toggle"));
  expect(details().open).toBe(true);

  await act(() => router.navigate(-1));
  await act(() => router.navigate(1));
  expect(await screen.findByRole("tabpanel", { name: "Variables" })).toBeTruthy();
  await screen.findByText("1 keys");
  expect(details().open).toBe(true);
});
