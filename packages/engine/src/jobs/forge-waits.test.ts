import { describe, expect, it } from "vitest";
import { forgeProject, until } from "../../test/forge-project";

describe("auth versus network on forge nodes (decision 4)", () => {
  it("an unreachable forge with a valid login waits for network", async () => {
    const { forge, engine, stopConfirm } = await forgeProject();
    const p = engine.project("shop");
    await forge.set({ offline: true });
    const id = await engine.createJob("shop", { title: "Add hello", ticket: { text: "x", id: "7" } });
    await until(() => p.executor.job(id).waiting_reason === "network");
    const run = p.ctx.db.db.prepare("SELECT node, waiting_reason FROM node_runs WHERE job_id = ? AND state = 'waiting'").get(id);
    expect(run).toEqual({ node: "pr", waiting_reason: "network" });
    expect((await forge.state()).prs).toEqual([]);
    stopConfirm();
    await p.executor.stop(id);
    await engine.shutdown();
  });

  it("an expired login waits for auth with kind tool, before the command runs", async () => {
    const { forge, engine, stopConfirm } = await forgeProject();
    const p = engine.project("shop");
    const id = await engine.createJob("shop", { title: "Add hello", ticket: { text: "x", id: "7" } });
    await forge.set({ tokenValid: false });
    await until(() => p.executor.job(id).waiting_reason === "auth");
    const auth = p.ctx.db.events(id).find((e) => e.type === "node_run.state_changed" && e.payload.waitingReason === "auth");
    expect(auth?.type === "node_run.state_changed" && auth.payload.auth).toMatchObject({ account: "gh-test", kind: "tool" });
    expect(p.ctx.db.events(id).some((e) => e.type === "effect.requested")).toBe(false);
    stopConfirm();
    await p.executor.stop(id);
    await engine.shutdown();
  });

  it("the ticket id reaches {ticket.id}: the comment goes to issue 7", async () => {
    const { forge, engine, stopConfirm } = await forgeProject();
    const p = engine.project("shop");
    const id = await engine.createJob("shop", { title: "Add hello", ticket: { text: "x", id: "7" } });
    await until(() => p.executor.job(id).state === "succeeded");
    expect((await forge.state()).calls).toContain(`issue comment --repo acme/shop 7 --body ${(await forge.state()).prs[0]!.url}`);
    stopConfirm();
    await engine.shutdown();
  });
});
