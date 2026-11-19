import { describe, expect, it } from "vitest";
import { JobWaitingReason, WaitingReason } from "@pecore/schemas";
import type { NewEvent } from "../../src/store/project-db";
import { apiProject } from "../api-project";

const recipe = { name: "reviewed", start: "write", successOutcomes: [], nodes: {}, edges: [] };

function job(id: string, extra: Partial<{ parentJobId: string }> = {}): NewEvent {
  return {
    jobId: id,
    type: "job.created",
    payload: { title: `Job ${id}`, recipe, ticket: null, parentJobId: extra.parentJobId ?? null, baseBranch: "main", base: "0".repeat(40), target: "main", branch: `factory/${id}` },
  };
}

describe("why (G13): one blocking reason per waiting reason, through GET /jobs/:id/why", () => {
  it("explains every job and node run waiting reason, and pauses", async () => {
    const { engine, call, close } = await apiProject();
    const db = engine.project("demo").ctx.db;
    db.append([job("parent"), { jobId: "parent", type: "job.state_changed", payload: { state: "failed", reason: "HARNESS_ERROR" } }]);

    for (const reason of JobWaitingReason.options) {
      const id = `queued-${reason}`;
      db.append([job(id, { parentJobId: "parent" }), { jobId: id, type: "job.state_changed", payload: { state: "queued", reason } }]);
      const why = await call("whyJob", { params: { id } });
      expect(why, reason).toMatchObject({ state: "queued", reasons: [{ reason, text: expect.any(String) }] });
      if (reason === "parent_job" || reason === "parent_failed") expect(why.reasons[0]).toMatchObject({ jobId: "parent", text: expect.stringContaining("Job parent") });
    }

    for (const reason of WaitingReason.options) {
      const id = `waiting-${reason}`;
      const nodeRunId = `${id}/build#0`;
      db.append([
        job(id),
        { jobId: id, type: "job.state_changed", payload: { state: "running", reason: null } },
        { jobId: id, type: "node_run.created", payload: { nodeRunId, node: "build", round: 0 } },
        { jobId: id, type: "attempt.started", payload: { attemptId: `${id}-a`, nodeRunId, profile: "p", connector: "claude-code", harnessVersion: null, connectorVersion: null, account: "claude-main", osUser: "u", sessionGroup: null, logPath: "logs/x" } },
        {
          jobId: id,
          type: "node_run.state_changed",
          payload: { nodeRunId, state: "waiting", waitingReason: reason, resetAt: 1_900_000_000_000, queueItemId: "item-1", auth: reason === "auth" ? { account: "claude-main", osUser: "u", kind: "harness" } : null },
        },
        { jobId: id, type: "job.state_changed", payload: { state: "waiting", reason } },
      ]);
      const why = await call("whyJob", { params: { id } });
      expect(why, reason).toMatchObject({ state: "waiting", reasons: [{ reason, nodeRunId, until: 1_900_000_000_000, queueItemId: "item-1", text: expect.stringContaining("Node build") }] });
      expect(why.reasons[0]!.text, reason).not.toContain("no reason recorded");
      if (["quota", "rate_limit", "auth", "network"].includes(reason)) expect(why.reasons[0]!.account, reason).toBe("claude-main");
    }

    for (const reason of ["user", "quit"]) {
      const id = `paused-${reason}`;
      db.append([job(id), { jobId: id, type: "job.state_changed", payload: { state: "paused", reason } }]);
      expect(await call("whyJob", { params: { id } }), reason).toMatchObject({ state: "paused", reasons: [{ reason }] });
    }

    expect(await call("whyJob", { params: { id: "parent" } })).toMatchObject({ state: "failed", reasons: [] });
    await close();
  });

  it("says the global pause holds a queued job", async () => {
    const { engine, call, close } = await apiProject();
    await call("pauseAll");
    const db = engine.project("demo").ctx.db;
    db.append([job("held"), { jobId: "held", type: "job.state_changed", payload: { state: "queued", reason: null } }]);
    expect(await call("whyJob", { params: { id: "held" } })).toMatchObject({ reasons: [{ reason: "global_pause" }] });
    expect(await call("getStatus")).toMatchObject({ globalPause: true });
    await close();
  });
});
