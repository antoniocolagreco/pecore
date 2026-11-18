import type Database from "better-sqlite3";
import type { Project } from "@pecore/schemas";

export type BudgetBlock = { limit: "jobTokens" | "dayTokens" | "jobUsd" | "dayUsd"; used: number; max: number };

function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function budgetBlock(db: Database.Database, project: Project, jobId: string, now = Date.now()): BudgetBlock | null {
  const b = project.limits.budget;
  const sum = (where: string, ...args: unknown[]) =>
    db
      .prepare(`SELECT coalesce(sum(a.tokens_in + a.tokens_out + a.cache_write), 0) AS tokens, coalesce(sum(a.cost), 0) AS cost FROM attempts a JOIN node_runs n ON a.node_run_id = n.id WHERE a.ended_at IS NOT NULL AND ${where}`)
      .get(...args) as { tokens: number; cost: number };
  const job = sum("n.job_id = ?", jobId);
  const day = sum("a.started_at >= ?", startOfLocalDay(now));
  if (b.jobTokens !== undefined && job.tokens >= b.jobTokens) return { limit: "jobTokens", used: job.tokens, max: b.jobTokens };
  if (b.jobUsd !== undefined && job.cost >= b.jobUsd) return { limit: "jobUsd", used: job.cost, max: b.jobUsd };
  if (b.dayTokens !== undefined && day.tokens >= b.dayTokens) return { limit: "dayTokens", used: day.tokens, max: b.dayTokens };
  if (b.dayUsd !== undefined && day.cost >= b.dayUsd) return { limit: "dayUsd", used: day.cost, max: b.dayUsd };
  return null;
}
