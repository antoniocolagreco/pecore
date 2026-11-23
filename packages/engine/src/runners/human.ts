import { createHash } from "node:crypto";
import type { Artifact, HumanNode, ReviewView } from "@pecore/schemas";

export type HumanSubject = {
  nodeRunId: string;
  node: string;
  description: string;
  mode: "decision" | "review";
  contentState: string | null;
  show: Artifact[];
  reviewView?: ReviewView;
  answer: boolean;
};

export function subjectHash(subject: unknown): string {
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex");
}

function reviewArtifacts(node: HumanNode, artifacts: Artifact[], reviewView: ReviewView | undefined): Artifact[] {
  if (reviewView === "report") {
    const report: Artifact | undefined = artifacts.findLast(({ type }) => type !== "diff" && type !== "attachment");
    return report ? [report] : [];
  }
  if (reviewView === "code") {
    const diff: Artifact | undefined = artifacts.findLast(({ type }) => type === "diff");
    if (!diff) return [];
    const risk: Artifact | undefined = artifacts.findLast(({ type, contentState }) => type === "risk" && contentState !== null && contentState === diff.contentState);
    return risk ? [diff, risk] : [diff];
  }
  const shown = new Map<Artifact["type"], Artifact>();
  for (const artifact of artifacts) {
    if (artifact.type !== "attachment" && node.show.includes(artifact.type)) shown.set(artifact.type, artifact);
  }
  return [...shown.values()];
}

export function humanItem(nodeRunId: string, recipeNodeId: string, node: HumanNode, artifacts: Artifact[], contentState: string | null, question?: unknown) {
  const mode: HumanSubject["mode"] = node.mode;
  const reviewView: ReviewView | undefined = mode === "review" ? node.reviewView : undefined;
  const subject: HumanSubject = {
    nodeRunId,
    node: recipeNodeId,
    description: mode === "decision" && typeof question === "string" && question.trim() ? question.trim() : node.description,
    mode,
    contentState,
    show: reviewArtifacts(node, artifacts, reviewView),
    ...(reviewView ? { reviewView } : {}),
    answer: node.answer,
  };
  return { kind: "human-node" as const, subject, subjectHash: subjectHash(subject), choices: [...node.outcomes] };
}

export function humanResult(node: HumanNode, choice: string, note: string | null): { outcome: string; userNote: string | null } {
  if (!node.outcomes.includes(choice)) throw new Error(`${choice} is not an outcome of ${node.name}`);
  return { outcome: choice, userNote: node.answer && note ? note : null };
}
