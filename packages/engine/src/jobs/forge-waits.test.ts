import { rename } from "node:fs/promises";
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
    await until(() => p.executor.job(id).state !== "queued");
    await forge.set({ tokenValid: false });
    await until(() => p.executor.job(id).waiting_reason === "auth");
    expect(p.executor.job(id).state).toBe("waiting");
    const auth = p.ctx.db.events(id).find((e) => e.type === "node_run.state_changed" && e.payload.waitingReason === "auth");
    expect(auth?.type === "node_run.state_changed" && auth.payload.auth).toMatchObject({ account: "gh-test", kind: "tool" });
    expect(p.ctx.db.events(id).some((e) => e.type === "effect.requested")).toBe(false);
    stopConfirm();
    await p.executor.stop(id);
    await engine.shutdown();
  });

  async function queuedJob() {
    const project = await forgeProject();
    const p = project.engine.project("shop");
    const settings = p.ctx.settings;
    p.ctx.settings = { ...settings, minFreeDiskGb: 1e12 };
    const id = await project.engine.createJob("shop", { title: "Add hello", ticket: { text: "x", id: "7" } });
    await until(() => p.executor.job(id).waiting_reason === "disk");
    const release = async () => {
      p.ctx.settings = settings;
      await p.executor.kick();
    };
    return { ...project, p, id, release };
  }

  it("a queued job fetches its base branch again when it starts", async () => {
    const { forge, engine, stopConfirm, p, id, release } = await queuedJob();
    const created = p.executor.job(id).base;
    const moved = forge.advance("acme/shop", "main", "later.txt");
    expect(moved).not.toBe(created);
    await release();
    await until(() => p.executor.job(id).state === "succeeded");
    expect(p.executor.job(id).base).toBe(moved);
    stopConfirm();
    await engine.shutdown();
  });

  it("a queued job whose fetch fails stays queued with reason network, on its old base", async () => {
    const { forge, engine, stopConfirm, p, id, release } = await queuedJob();
    const created = p.executor.job(id).base;
    await rename(forge.remote("acme/shop"), `${forge.remote("acme/shop")}.away`);
    await release();
    await until(() => p.executor.job(id).waiting_reason === "network");
    expect(p.executor.job(id)).toMatchObject({ state: "queued", base: created });
    expect(p.ctx.db.events(id).some((e) => e.type === "node_run.created")).toBe(false);
    await p.executor.stop(id);
    stopConfirm();
    await engine.shutdown();
  });

  it("a queued job whose login expired stays queued with reason auth", async () => {
    const { forge, engine, stopConfirm, p, id, release } = await queuedJob();
    await forge.set({ tokenValid: false });
    await release();
    await until(() => p.executor.job(id).waiting_reason === "auth");
    expect(p.executor.job(id).state).toBe("queued");
    await p.executor.stop(id);
    stopConfirm();
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
