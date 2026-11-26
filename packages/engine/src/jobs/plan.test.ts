import { describe, expect, it } from "vitest";
import { apiProject } from "../../test/api-project";
import { createJob } from "./create";
import { planOrder, resumeOrders } from "./plan";

const plan = [
  { key: "api", title: "API", request: "add the endpoint", dependsOn: [] },
  { key: "ui", title: "UI", request: "add the screen", dependsOn: ["api"] },
];

describe("orders (Phase 6 decision 1)", () => {
  it("creates the planned jobs with keys, the dependency as parent, and refuses a second plan", async () => {
    const { engine, close } = await apiProject();
    const { ctx } = engine.project("demo");
    const first = await planOrder(ctx, "order-1", plan);
    expect(first.accepted).toBe(true);
    const ui = ctx.db.db.prepare("SELECT parent_job_id, order_id, order_key FROM jobs WHERE id = ?").get(first.jobIds.ui);
    expect(ui).toEqual({ parent_job_id: first.jobIds.api, order_id: "order-1", order_key: "ui" });
    const again = await planOrder(ctx, "order-1", [{ key: "other", title: "Other", request: "x", dependsOn: [] }]);
    expect(again).toEqual({ accepted: false, plan: first.plan, jobIds: first.jobIds });
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM jobs WHERE order_id = 'order-1'").get()).toEqual({ n: 2 });
    await close();
  });

  it("refuses more than one dependency and a dependency on a later key", async () => {
    const { engine, close } = await apiProject();
    const { ctx } = engine.project("demo");
    await expect(planOrder(ctx, "o", [{ key: "a", title: "A", request: "x", dependsOn: ["b"] }, { key: "b", title: "B", request: "x", dependsOn: [] }])).rejects.toThrow(/earlier key/);
    await expect(planOrder(ctx, "o", [{ key: "a", title: "A", request: "x", dependsOn: ["b", "c"] }])).rejects.toThrow();
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
    await close();
  });

  it("after a crash between two jobs, start creates only the missing job from the stored plan and marks the order done", async () => {
    const { engine, close } = await apiProject();
    const { ctx } = engine.project("demo");
    const orderId: string = "chat-order";
    ctx.db.append([{ jobId: null, type: "order.planned", payload: { orderId, plan: plan.map((p) => ({ ...p, recipe: "reviewed" })) } }]);
    const api = await createJob(ctx, { title: "API", request: "add the endpoint", recipe: "reviewed", orderId, orderKey: "api" });
    await expect(createJob(ctx, { title: "API", request: "again", recipe: "reviewed", orderId, orderKey: "api" })).rejects.toThrow();
    await resumeOrders(ctx);
    const jobs = ctx.db.db.prepare("SELECT id, parent_job_id, order_key FROM jobs WHERE order_id = ? ORDER BY order_key").all(orderId);
    expect(jobs).toEqual([
      { id: api, parent_job_id: null, order_key: "api" },
      { id: expect.any(String), parent_job_id: api, order_key: "ui" },
    ]);
    await close();
  });
});
