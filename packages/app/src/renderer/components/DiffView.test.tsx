import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { DiffView } from "./DiffView";

afterEach(cleanup);

it("passes the file and line for every line chosen for review", async () => {
  const content: string = "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -0,0 +1,2 @@\n+const first = 1;\n+const second = 2;\n";
  const onComment = vi.fn<(line: { file: string; line: number }) => void>();
  render(<DiffView content={content} onComment={onComment} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Comment on line 1" }));
  await user.click(screen.getByRole("button", { name: "Comment on line 2" }));
  expect(onComment.mock.calls).toEqual([[{ file: "app.ts", line: 1 }], [{ file: "app.ts", line: 2 }]]);
});

it("restores individual collapsed files on Forward", async () => {
  const content = "diff --git a/index.ts b/index.ts\n--- a/index.ts\n+++ b/index.ts\n@@ -0,0 +1 @@\n+export const index = 1;\n"
    + "diff --git a/style.css b/style.css\n--- a/style.css\n+++ b/style.css\n@@ -0,0 +1 @@\n+body { margin: 0; }\n";
  const router = createMemoryRouter([
    { path: "/", element: <p>Jobs</p> },
    { path: "/diff", element: <DiffView content={content} /> },
  ]);
  render(<RouterProvider router={router} />);
  await act(() => router.navigate("/diff"));
  await userEvent.setup().click(screen.getByRole("button", { name: /index.ts/ }));
  await act(() => router.navigate(-1));
  await act(() => router.navigate(1));
  expect(screen.getByRole("button", { name: /index.ts/ }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("button", { name: /style.css/ }).getAttribute("aria-expanded")).toBe("true");
});
