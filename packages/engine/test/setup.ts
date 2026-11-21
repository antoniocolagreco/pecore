import { vi } from "vitest";

vi.mock("../src/scheduler/disk", () => ({
  freeDiskGb: async (): Promise<number> => 1e6,
  enoughDisk: async (_path: string, minFreeGb: number): Promise<boolean> => minFreeGb <= 1e6,
}));
