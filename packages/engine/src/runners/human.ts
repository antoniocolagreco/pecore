import { createHash } from "node:crypto";
import type { Artifact, HumanInterface, HumanNode } from "@pecore/schemas";

export type HumanSubject = {
  nodeRunId: string;
  node: string;
  description: string;
  interface: HumanInterface;
  filesHash: string | null;
  show: Artifact[];
  notes: string[];
  inlineReview?: true;
  job?: { title: string; request: string };
};

export function subjectHash(subject: unknown): string {
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex");
}

export function humanArtifacts(node: HumanNode, diff: Artifact | undefined, read: Artifact[]): Artifact[] {
  if (node.interface !== "code-review") return read.filter(({ type }) => type !== "diff");
  if (!diff) return [];
  return [diff, ...read.filter(({ type, filesHash }) => (type === "code_analysis" || type === "code_review") && filesHash !== null && filesHash === diff.filesHash)];
}

export function humanItem(nodeRunId: string, recipeNodeId: string, node: HumanNode, show: Artifact[], filesHash: string | null, question?: unknown, job?: HumanSubject["job"]) {
  const subject: HumanSubject = {
    nodeRunId,
    node: recipeNodeId,
    description: node.interface === "decision" && typeof question === "string" && question.trim() ? question.trim() : node.description,
    interface: node.interface,
    filesHash,
    show,
    job,
    ...(node.interface === "code-review" && (node.outputs.changes_requested ?? node.outputs.changes) === "code_review" ? { inlineReview: true as const } : {}),
    notes: node.outcomes.filter((outcome) => ["feedback", "code_review"].includes(node.outputs[outcome] ?? "")),
  };
  return { kind: "human-node" as const, subject, subjectHash: subjectHash(subject), choices: [...node.outcomes] };
}

export function humanResult(node: HumanNode, choice: string, note: string | null): { outcome: string; userNote: string | null } {
  if (!node.outcomes.includes(choice)) throw new Error(`${choice} is not an outcome of ${node.name}`);
  return { outcome: choice, userNote: node.outputs[choice] === "feedback" && note ? note : null };
}
