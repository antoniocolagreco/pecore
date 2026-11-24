import { createHash } from "node:crypto";
import type { Artifact, HumanInterface, HumanNode } from "@pecore/schemas";

export type HumanSubject = {
  nodeRunId: string;
  node: string;
  description: string;
  interface: HumanInterface;
  contentState: string | null;
  show: Artifact[];
  notes: string[];
};

export function subjectHash(subject: unknown): string {
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex");
}

export function humanArtifacts(node: HumanNode, diff: Artifact | undefined, read: Artifact[]): Artifact[] {
  if (node.interface !== "code-review") return read.filter(({ type }) => type !== "diff");
  if (!diff) return [];
  return [diff, ...read.filter(({ type, contentState }) => type === "findings" && contentState !== null && contentState === diff.contentState)];
}

export function humanItem(nodeRunId: string, recipeNodeId: string, node: HumanNode, show: Artifact[], contentState: string | null, question?: unknown) {
  const subject: HumanSubject = {
    nodeRunId,
    node: recipeNodeId,
    description: node.interface === "decision" && typeof question === "string" && question.trim() ? question.trim() : node.description,
    interface: node.interface,
    contentState,
    show,
    notes: node.outcomes.filter((outcome) => node.outputs[outcome] === "text"),
  };
  return { kind: "human-node" as const, subject, subjectHash: subjectHash(subject), choices: [...node.outcomes] };
}

export function humanResult(node: HumanNode, choice: string, note: string | null): { outcome: string; userNote: string | null } {
  if (!node.outcomes.includes(choice)) throw new Error(`${choice} is not an outcome of ${node.name}`);
  return { outcome: choice, userNote: node.outputs[choice] === "text" && note ? note : null };
}
