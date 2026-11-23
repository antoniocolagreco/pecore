import { describe, expect, it } from "vitest";
import { Node } from "@pecore/schemas";
import type { Artifact, HumanNode } from "@pecore/schemas";
import { humanItem } from "./human";

const ticket: Artifact = { type: "ticket", path: "artifacts/job/create/ticket.json", sha256: "a".repeat(64), contentState: null };
const log: Artifact = { type: "check-log", path: "artifacts/job/check/check-log.txt", sha256: "b".repeat(64), contentState: "tree" };
const diff: Artifact = { type: "diff", path: "artifacts/job/build/diff.patch", sha256: "c".repeat(64), contentState: "tree" };
const risk: Artifact = { type: "risk", path: "artifacts/job/assess/risk.json", sha256: "d".repeat(64), contentState: "tree" };
const outdatedRisk: Artifact = { type: "risk", path: "artifacts/job/old-assess/risk.json", sha256: "e".repeat(64), contentState: "old-tree" };

function review(fields: Record<string, unknown>): HumanNode {
  const node = Node.parse({ name: "review", description: "Review the job", kind: "human", mode: "review",
    outcomes: ["approve", "changes", "reject"], ...fields });
  if (node.kind !== "human") throw new Error("Expected a human node");
  return node;
}

describe("Human review views", () => {
  it("shows the latest textual artifact for Report", () => {
    const item = humanItem("run", "review", review({ reviewView: "report" }), [ticket, log, diff], "tree");
    expect(item.subject).toMatchObject({ reviewView: "report", show: [log] });
    expect(item.choices).toEqual(["approve", "changes", "reject"]);
  });

  it("shows code changes and matching risk annotations for Code", () => {
    const item = humanItem("run", "review", review({ reviewView: "code" }), [ticket, diff, log, risk, outdatedRisk], "tree");
    expect(item.subject).toMatchObject({ reviewView: "code", show: [diff, risk] });
  });

  it("keeps the artifact list for older reviews", () => {
    const item = humanItem("run", "review", review({ show: ["ticket", "diff"] }), [ticket, log, diff, risk], "tree");
    expect(item.subject).not.toHaveProperty("reviewView");
    expect(item.subject.show).toEqual([ticket, diff]);
  });
});
