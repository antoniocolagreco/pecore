import { vi } from "vitest";

const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
const range = (globalThis as unknown as { Range: { prototype: object } }).Range.prototype;
Object.defineProperty(range, "getClientRects", { configurable: true, value: () => [rect] });
Object.defineProperty(range, "getBoundingClientRect", { configurable: true, value: () => rect });

vi.stubGlobal("ResizeObserver", class {
  observe(): void { return undefined; }
  unobserve(): void { return undefined; }
  disconnect(): void { return undefined; }
});
