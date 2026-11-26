import { describe, expect, it } from "vitest";
import { Node } from "@pecore/schemas";
import type { Artifact, HumanNode } from "@pecore/schemas";
import { humanArtifacts, humanItem, humanResult } from "./human";

const log: Artifact = { type: "log", jobId: "job", run: "check", name: "log.txt", sha256: "b".repeat(64), filesHash: "tree" };
const diff: Artifact = { type: "diff", jobId: "job", run: "build", name: "diff.patch", sha256: "c".repeat(64), filesHash: "tree" };
const risk: Artifact = { type: "code_analysis", jobId: "job", run: "assess", name: "findings.json", sha256: "d".repeat(64), filesHash: "tree" };
const outdatedRisk: Artifact = { type: "code_analysis", jobId: "job", run: "old-assess", name: "findings.json", sha256: "e".repeat(64), filesHash: "old-tree" };
const spec: Artifact = { type: "spec", jobId: "job", run: "spec", name: "spec.json", sha256: "f".repeat(64), filesHash: "tree" };

function human(fields: Record<string, unknown>): HumanNode {
  const node = Node.parse({ name: "review", description: "Review the job", kind: "human", interface: "code-review",
    outcomes: ["approve", "changes", "reject"], outputs: { changes: "feedback" }, ...fields });
  if (node.kind !== "human") throw new Error("Expected a human node");
  return node;
}

describe("human interfaces", () => {
  it("shows the job diff and the read findings of the same content for a code review", () => {
    expect(humanArtifacts(human({}), diff, [log, risk, outdatedRisk, spec])).toEqual([diff, risk]);
    expect(humanArtifacts(human({}), undefined, [risk])).toEqual([]);
  });

  it("shows what the read nodes produced for a report review and a decision", () => {
    expect(humanArtifacts(human({ interface: "report-review" }), diff, [spec, log, diff])).toEqual([spec, log]);
    expect(humanArtifacts(human({ interface: "decision", outcomes: ["yes", "no"], outputs: {} }), diff, [spec])).toEqual([spec]);
  });

  it("puts the interface, the shown files and the outcomes that take a note in the item", () => {
    const item = humanItem("run", "review", human({}), [diff, risk], "tree");
    expect(item.subject).toMatchObject({ interface: "code-review", show: [diff, risk], notes: ["changes"], description: "Review the job" });
    expect(item.choices).toEqual(["approve", "changes", "reject"]);
  });

  it("asks the decision's question", () => {
    const item = humanItem("run", "pick", human({ interface: "decision", outcomes: ["yes", "no"], outputs: {} }), [], "tree", " Ship it? ");
    expect(item.subject).toMatchObject({ interface: "decision", description: "Ship it?", notes: [] });
  });

  it("keeps the note only on outcomes that produce text", () => {
    expect(humanResult(human({}), "changes", "rename x")).toEqual({ outcome: "changes", userNote: "rename x" });
    expect(humanResult(human({}), "approve", "looks good")).toEqual({ outcome: "approve", userNote: null });
    expect(() => humanResult(human({}), "merge", null)).toThrow();
  });
});
