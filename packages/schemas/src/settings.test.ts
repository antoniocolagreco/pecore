import { describe, expect, it } from "vitest";
import { roleProfile } from "./settings";

describe("roleProfile", () => {
  it("gives the Orchestrator the Assistant's profile unless it has its own", () => {
    expect(roleProfile({ assistant: { profile: "a" }, orchestrator: null }, "orchestrator")).toBe("a");
    expect(roleProfile({ assistant: { profile: "a" }, orchestrator: { profile: "o" } }, "orchestrator")).toBe("o");
    expect(roleProfile({ assistant: { profile: "a" }, orchestrator: { profile: "o" } }, "assistant")).toBe("a");
  });

  it("reads an older settings file, where the orchestrator profile was the chat's, as the Assistant's", () => {
    expect(roleProfile({ assistant: null, orchestrator: { profile: "old" } }, "assistant")).toBe("old");
    expect(roleProfile({ assistant: null, orchestrator: { profile: "old" } }, "orchestrator")).toBe("old");
  });

  it("has no profile when neither role is set", () => {
    expect(roleProfile({ assistant: null, orchestrator: null }, "assistant")).toBeNull();
    expect(roleProfile({ assistant: null, orchestrator: null }, "orchestrator")).toBeNull();
  });
});
