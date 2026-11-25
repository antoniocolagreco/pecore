import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipeGraph } from "./RecipeGraph";
import type { RecipeGraphLink, RecipeGraphNode } from "./RecipeGraph";
import { recipeEnd, recipeStart } from "./recipeLayout";
import type { RecipeLayout } from "./recipeLayout";

const layout: RecipeLayout = {
  [recipeStart]: { x: -272, y: 0 },
  read: { x: 0, y: 0 },
  review: { x: 272, y: 0 },
  [recipeEnd]: { x: 544, y: 0 },
};
const steps: RecipeGraphNode[] = Object.keys(layout).map((id) => ({ id, label: <section>{id}</section>, invalid: false }));
const links: RecipeGraphLink[] = [{ from: "read", to: "review", on: "failure", failed: true, invalid: false }];

function setup() {
  const onConnect = vi.fn();
  const onReconnect = vi.fn();
  const onDelete = vi.fn();
  const onLayout = vi.fn();
  const rendered: RenderResult = render(<RecipeGraph steps={steps} links={links} layout={layout} automatic={layout}
    start={recipeStart} editable selected="" onSelect={vi.fn()} onConnect={onConnect} onReconnect={onReconnect}
    onDelete={onDelete} onLayout={onLayout} />);
  const edge: Element = rendered.getByTestId("rf__edge-read:failure");
  const card = (id: string): HTMLElement => rendered.container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  const dropOn = (id: string): HTMLElement => {
    const target: HTMLElement = card(id).querySelector<HTMLElement>('[data-handleid="card"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => target) });
    return target;
  };
  const pane: Element = rendered.container.querySelector(".react-flow__pane")!;
  return { edge, pane, card, dropOn, onConnect, onReconnect, onDelete, onLayout };
}

beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value: () => new DOMRect(0, 0, 50, 14) });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "elementFromPoint");
  Reflect.deleteProperty(SVGElement.prototype, "getBBox");
});

it.each(["top", "right", "bottom", "left"])("connects from the %s to the body of End", (side) => {
  const { card, dropOn, onConnect } = setup();
  const target: HTMLElement = dropOn(recipeEnd);
  const handle: HTMLElement = card("read").querySelector<HTMLElement>(`[data-handleid="${side}"]`)!;
  fireEvent.mouseDown(handle, { button: 0, clientX: 70, clientY: 90 });
  expect(target.style.pointerEvents).toBe("all");
  fireEvent.mouseMove(document, { clientX: 700, clientY: 160 });
  fireEvent.mouseUp(document, { clientX: 700, clientY: 160 });
  expect(onConnect).toHaveBeenCalledWith({ source: "read", target: recipeEnd, sourceHandle: side, targetHandle: "card" });
  expect(target.style.pointerEvents).toBe("none");
});

it("uses React Flow to reconnect the destination with the same outcome and delete a selected arrow", async () => {
  const { edge, dropOn, onReconnect, onDelete } = setup();
  fireEvent.click(edge);
  const updater: SVGCircleElement = edge.querySelector<SVGCircleElement>(".react-flow__edgeupdater-target")!;
  dropOn(recipeEnd);
  fireEvent.mouseDown(updater, { button: 0, clientX: 240, clientY: 130 });
  fireEvent.mouseMove(document, { clientX: 700, clientY: 160 });
  fireEvent.mouseUp(document, { clientX: 700, clientY: 160 });
  expect(onReconnect).toHaveBeenCalledWith("read", "failure", recipeEnd);
  fireEvent.keyDown(document, { key: "Delete", code: "Delete" });
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith([{ from: "read", on: "failure", to: "review" }]));
  fireEvent.keyUp(document, { key: "Delete", code: "Delete" });
});

it("deletes an arrow when its destination is dragged to empty canvas", async () => {
  const { edge, pane, onDelete, onReconnect } = setup();
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Fit view" }).disabled).toBe(false));
  fireEvent.click(edge);
  const updater: SVGCircleElement = edge.querySelector<SVGCircleElement>(".react-flow__edgeupdater-target")!;
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => pane) });
  fireEvent.mouseDown(updater, { button: 0, clientX: 240, clientY: 130 });
  fireEvent.mouseMove(pane, { clientX: 350, clientY: 350 });
  fireEvent.mouseUp(pane, { clientX: 350, clientY: 350 });
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith([{ from: "read", on: "failure", to: "review" }]));
  expect(onReconnect).not.toHaveBeenCalled();
});

it("reroutes on mouse movement before dropping a card", () => {
  const { card, edge, onLayout } = setup();
  const path = (): string | null => edge.querySelector(".react-flow__edge-path")!.getAttribute("d");
  const before: string | null = path();
  const down: MouseEvent = new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, clientX: 300, clientY: 15 });
  Object.defineProperty(down, "view", { value: document.defaultView });
  fireEvent(card("review"), down);
  fireEvent.mouseMove(document.defaultView!, { buttons: 1, clientX: 295, clientY: 20 });
  fireEvent.mouseMove(document.defaultView!, { buttons: 1, clientX: 130, clientY: 246 });
  expect(path()).not.toBe(before);
  expect(path()).toMatch(/^M [\d.]+,120 L/);
  expect(onLayout).not.toHaveBeenCalled();
  const up: MouseEvent = new MouseEvent("mouseup", { bubbles: true, clientX: 130, clientY: 246 });
  Object.defineProperty(up, "view", { value: document.defaultView });
  fireEvent(document.defaultView!, up);
  expect(onLayout).toHaveBeenCalledWith({ ...layout, review: { x: 0, y: 176 } });
});
