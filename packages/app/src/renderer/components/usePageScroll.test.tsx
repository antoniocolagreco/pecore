import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { Page, ui } from "./ui";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("waits for the old scroll position to become reachable after returning", async () => {
  let ready = true;
  const renders = new Set<() => void>();
  const subscribe = (render: () => void) => {
    renders.add(render);
    return () => { renders.delete(render); };
  };
  function List() {
    const loaded = useSyncExternalStore(subscribe, () => ready);
    return <Page title="List">{loaded ? <div data-loaded="">Items</div> : <p>Loading</p>}</Page>;
  }
  const write = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!.set!;
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, top: number) {
    write.call(this, this.querySelector("[data-loaded]") ? top : 0);
  });
  let resized: (() => void) | undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe(): void { return undefined; }
    disconnect(): void { resized = undefined; }
  });
  const router = createMemoryRouter([
    { path: "/", element: <List /> },
    { path: "/item", element: <Page title="Item">Item details</Page> },
  ]);
  render(<RouterProvider router={router} />);
  const viewport = () => screen.getByRole("heading", { name: "List" }).closest<HTMLElement>(`.${ui.page}`)!;
  viewport().scrollTop = 320;
  fireEvent.scroll(viewport());

  await act(() => router.navigate("/item"));
  ready = false;
  await act(() => router.navigate(-1));
  expect(viewport().scrollTop).toBe(0);
  expect(resized).toBeDefined();

  await act(() => {
    ready = true;
    renders.forEach((render) => render());
  });
  resized?.();
  expect(viewport().scrollTop).toBe(320);
  expect(resized).toBeUndefined();
});
