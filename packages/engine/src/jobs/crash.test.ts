import { describe, expect, it } from "vitest";
import { forgeProject, until } from "../../test/forge-project";
import { Engine } from "../main";
import { jobCommit } from "./stacked";

const deliveryNodes = [
  { node: "push", hang: "git push" },
  { node: "pr", hang: "pr create" },
] as const;

describe("crash during delivery (G12, 4.8)", () => {
  it("a job without a crash pushes and opens one pull request", async () => {
    const { forge, engine } = await forgeProject();
    const p = engine.project("shop");
    const id = await engine.createJob("shop", { title: "Add hello", request: "x", ticketId: "7" });
    await until(() => p.executor.job(id).state === "succeeded");
    const s = await forge.state();
    expect(s.prs).toMatchObject([{ head: `factory/${id}`, base: "main", state: "OPEN", title: "Add hello", body: "Add hello.txt" }]);
    const delivery = p.executor.artifacts(id).filter(({ type }) => type === "pull_request").at(-1)!;
    expect(JSON.parse(p.ctx.db.requireArtifact(delivery).toString("utf8"))).toEqual({
      title: "Add hello", body: "Add hello.txt", url: s.prs[0]!.url,
    });
    const sha: string | null = jobCommit(p.ctx.db, p.ctx.db.events(id));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(forge.remoteHead("acme/shop", `factory/${id}`)).toBe(sha);
    await engine.shutdown();
  });

  for (const { node, hang } of deliveryNodes) {
    it(`a kill during ${node}, then a restart and play, delivers once`, async () => {
      const { forge, home, templates, engine } = await forgeProject();
      const p = engine.project("shop");
      await forge.set({ hang });
      const id = await engine.createJob("shop", { title: "Add hello", request: "x", ticketId: "7" });
      await until(() => p.ctx.db.events(id).some((e) => e.type === "effect.requested" && e.payload.node === node));
      await new Promise((r) => setTimeout(r, 300));
      await engine.shutdown();

      await forge.set({ hang: null });
      const again = await Engine.start({ home, templates });
      const q = again.project("shop");
      expect(q.executor.job(id)).toMatchObject({ state: "paused", waiting_reason: "quit" });
      await q.executor.play(id);
      await until(() => q.executor.job(id).state === "succeeded");
      const s = await forge.state();
      expect(s.prs).toHaveLength(1);
      expect(s.calls.filter((c) => c.startsWith("pr create"))).toHaveLength(1);
      const requested = q.ctx.db.events(id).filter((e) => e.type === "effect.requested" && e.payload.node === node);
      expect(requested).toHaveLength(1);
      await again.shutdown();
    }, 60_000);
  }
});
