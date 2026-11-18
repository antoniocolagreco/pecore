import type { NodeRunState } from "@pecore/schemas";

const table: Record<NodeRunState, NodeRunState[]> = {
  pending: ["waiting", "running", "skipped", "interrupted"],
  waiting: ["waiting", "running", "interrupted", "completed"],
  running: ["waiting", "completed", "failed", "interrupted"],
  completed: [],
  failed: [],
  interrupted: [],
  skipped: [],
};

export function canTransitionRun(from: NodeRunState, to: NodeRunState): boolean {
  return table[from].includes(to);
}

export function assertRunTransition(from: NodeRunState, to: NodeRunState): void {
  if (!canTransitionRun(from, to)) throw new Error(`node run cannot go from ${from} to ${to}`);
}
