import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it } from "vitest";
import { useHistoryShortcuts } from "../shell/useHistoryShortcuts";
import { useViewState } from "./useViewState";

function View({ label }: { label: string }) {
  useHistoryShortcuts();
  const [text, setText] = useViewState("view.text", "");
  const [count, setCount] = useViewState("view.count", 0);
  return <div>
    <label>{label}<input aria-label={label} value={text} onChange={(event) => setText(event.target.value)} /></label>
    <button onClick={() => setCount((value) => value + 1)}>{label} count: {count}</button>
  </div>;
}
afterEach(cleanup);

it("restores each history entry on Back and Forward", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([
    { path: "/", element: <View label="First" /> },
    { path: "/second", element: <View label="Second" /> },
  ]);
  render(<RouterProvider router={router} />);

  await user.type(screen.getByRole("textbox", { name: "First" }), "alpha");
  await user.click(screen.getByRole("button", { name: "First count: 0" }));
  await act(() => router.navigate("/second"));
  await user.type(screen.getByRole("textbox", { name: "Second" }), "beta");
  await user.click(screen.getByRole("button", { name: "Second count: 0" }));

  await act(() => router.navigate(-1));
  expect(screen.getByRole("textbox", { name: "First" })).toHaveProperty("value", "alpha");
  expect(screen.getByRole("button", { name: "First count: 1" })).toBeTruthy();
  await act(() => { fireEvent.keyDown(window, { altKey: true, key: "ArrowRight" }); });
  expect(screen.getByRole("textbox", { name: "Second" })).toHaveProperty("value", "beta");
  expect(screen.getByRole("button", { name: "Second count: 1" })).toBeTruthy();

  await act(() => router.navigate("/"));
  expect(screen.getByRole("textbox", { name: "First" })).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "First count: 0" })).toBeTruthy();
});

it("keeps filters when the URL is replaced and separates visits to the same page", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter([{ path: "/", element: <View label="Search" /> }]);
  render(<RouterProvider router={router} />);
  const input = () => screen.getByRole("textbox", { name: "Search" });
  await user.type(input(), "first");
  await act(() => router.navigate("/?filter=open", { replace: true }));
  expect(input()).toHaveProperty("value", "first");
  await act(() => router.navigate("/?filter=open"));
  expect(input()).toHaveProperty("value", "");
  await user.type(input(), "second");

  fireEvent.keyDown(input(), { altKey: true, key: "ArrowLeft" });
  expect(input()).toHaveProperty("value", "second");
  await act(() => { fireEvent.keyDown(window, { metaKey: true, key: "[" }); });
  expect(input()).toHaveProperty("value", "first");
  await act(() => { fireEvent.keyDown(window, { key: "BrowserForward" }); });
  expect(input()).toHaveProperty("value", "second");
});
