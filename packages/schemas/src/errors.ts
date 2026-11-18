import { z } from "zod";

export const JobState = z.enum(["queued", "running", "waiting", "paused", "succeeded", "not_delivered", "failed", "stopped"]);
export type JobState = z.infer<typeof JobState>;

export const finalJobStates = ["succeeded", "not_delivered", "failed", "stopped"] as const satisfies readonly JobState[];

export const JobWaitingReason = z.enum(["parent_job", "parent_failed", "concurrency", "disk"]);
export type JobWaitingReason = z.infer<typeof JobWaitingReason>;

export const PauseReason = z.enum(["user", "quit"]);
export type PauseReason = z.infer<typeof PauseReason>;

export const NodeRunState = z.enum(["pending", "waiting", "running", "completed", "failed", "interrupted", "skipped"]);
export type NodeRunState = z.infer<typeof NodeRunState>;

export const WaitingReason = z.enum([
  "concurrency",
  "quota",
  "rate_limit",
  "budget",
  "human",
  "services",
  "round_limit",
  "network",
  "auth",
  "confirmation",
  "disk",
]);
export type WaitingReason = z.infer<typeof WaitingReason>;

export const FailureReason = z.enum([
  "HARNESS_ERROR",
  "TIMEOUT",
  "INVALID_OUTPUT",
  "READ_ONLY_VIOLATION",
  "PROCESS_KILLED",
  "COMMAND_NOT_FOUND",
]);
export type FailureReason = z.infer<typeof FailureReason>;

export const AuthKind = z.enum(["harness", "tool"]);
export type AuthKind = z.infer<typeof AuthKind>;

export const builtinOutcomes = ["stale", "skipped"] as const;
