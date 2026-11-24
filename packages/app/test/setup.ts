import { vi } from "vitest";

vi.stubGlobal("ResizeObserver", class {
  observe(): void { return undefined; }
  unobserve(): void { return undefined; }
  disconnect(): void { return undefined; }
});
