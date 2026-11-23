import { createHash } from "node:crypto";
import type { Artifact, HumanNode } from "@pecore/schemas";

export type HumanSubject = {
  nodeRunId: string;
  node: string;
  description: string;
  mode: "decision" | "review";
  contentState: string | null;
  show: Artifact[];
  answer: boolean;
};

export function subjectHash(subject: unknown): string {
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex");
}

export function humanItem(nodeRunId: string, recipeNodeId: string, node: HumanNode, artifacts: Artifact[], contentState: string | null, question?: unknown) {
  const mode: HumanSubject["mode"] = node.mode;
  const subject: HumanSubject = {
    nodeRunId,
    node: recipeNodeId,
    description: mode === "decision" && typeof question === "string" && question.trim() ? question.trim() : node.description,
    mode,
    contentState,
    show: artifacts.filter((a) => a.type !== "attachment" && node.show.includes(a.type)),
    answer: node.answer,
  };
  return { kind: "human-node" as const, subject, subjectHash: subjectHash(subject), choices: [...node.outcomes] };
}

export function humanResult(node: HumanNode, choice: string, note: string | null): { outcome: string; userNote: string | null } {
  if (!node.outcomes.includes(choice)) throw new Error(`${choice} is not an outcome of ${node.name}`);
  return { outcome: choice, userNote: node.answer && note ? note : null };
}
