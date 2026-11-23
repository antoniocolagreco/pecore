import { describe, expect, it } from "vitest";
import { Node } from "@pecore/schemas";
import type { Artifact, HumanNode } from "@pecore/schemas";
import { humanItem } from "./human";

const artifacts: Artifact[] = [
  { type: "ticket", path: "artifacts/job/create/ticket.json", sha256: "a".repeat(64), contentState: null },
  { type: "diff", path: "artifacts/job/build/diff.txt", sha256: "b".repeat(64), contentState: "tree" },
  { type: "risk", path: "artifacts/job/assess/risk.json", sha256: "c".repeat(64), contentState: "tree" },
];

function review(fields: Record<string, unknown>): HumanNode {
  const node = Node.parse({ name: "review", description: "Review the job", kind: "human", mode: "review",
    outcomes: ["approve", "changes", "reject"], ...fields });
  if (node.kind !== "human") throw new Error("Expected a human node");
  return node;
}

describe("Human review views", () => {
  it("uses the same input for Text and Code", () => {
    for (const reviewView of ["text", "code"]) {
      const item = humanItem("run", "review", review({ reviewView, inputs: ["ticket"] }), artifacts, "tree");
      expect(item.subject).toMatchObject({ reviewView, show: [artifacts[0]] });
      expect(item.choices).toEqual(["approve", "changes", "reject"]);
    }
  });

  it("passes risk annotations only alongside a Diff view", () => {
    const item = humanItem("run", "review", review({ reviewView: "diff", inputs: ["diff"] }), artifacts, "tree");
    expect(item.subject).toMatchObject({ reviewView: "diff", show: [artifacts[1], artifacts[2]] });
  });

  it("keeps the artifact list for older reviews", () => {
    const item = humanItem("run", "review", review({ show: ["ticket", "diff"] }), artifacts, "tree");
    expect(item.subject).not.toHaveProperty("reviewView");
    expect(item.subject.show).toEqual([artifacts[0], artifacts[1]]);
  });
});
