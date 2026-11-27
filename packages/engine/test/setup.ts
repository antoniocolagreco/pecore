import { vi } from "vitest";
import { setBrowserOpener } from "../src/accounts/native-mcp";

// Tests must never launch a real browser. Tests that assert the opener install their own spy.
setBrowserOpener(() => undefined);

vi.mock("../src/scheduler/disk", () => ({
  freeDiskGb: async (): Promise<number> => 1e6,
  enoughDisk: async (_path: string, minFreeGb: number): Promise<boolean> => minFreeGb <= 1e6,
}));
