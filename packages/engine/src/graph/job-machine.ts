import type { JobState } from "@pecore/schemas";

const table: Record<JobState, JobState[]> = {
  queued: ["running", "stopped"],
  running: ["waiting", "paused", "succeeded", "not_delivered", "failed", "stopped"],
  waiting: ["running", "paused", "stopped"],
  paused: ["running", "waiting", "stopped"],
  succeeded: ["running"],
  not_delivered: ["running"],
  failed: ["running"],
  stopped: ["running"],
};

export class TransitionError extends Error {
  constructor(from: string, to: string, why = "") {
    super(`job cannot go from ${from} to ${to}${why ? `: ${why}` : ""}`);
  }
}

export function canTransition(from: JobState, to: JobState, ctx: { archived: boolean; cause?: "resume" | "base_change" }): boolean {
  if (!table[from].includes(to)) return false;
  if (to !== "running") return true;
  if (from === "failed" || from === "stopped") return ctx.cause === "resume" && !ctx.archived;
  if (from === "succeeded" || from === "not_delivered") return ctx.cause === "base_change";
  return true;
}

export function assertTransition(from: JobState, to: JobState, ctx: { archived: boolean; cause?: "resume" | "base_change" }): void {
  if (!canTransition(from, to, ctx)) throw new TransitionError(from, to);
}

export function isFinal(state: JobState): boolean {
  return state === "succeeded" || state === "not_delivered" || state === "failed" || state === "stopped";
}
