import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forgeProject, until } from "../../test/forge-project";
import { Engine } from "../main";

const deliveryNodes = [
  { node: "push", hang: "git push" },
  { node: "pr", hang: "pr create" },
  { node: "comment", hang: "issue comment" },
] as const;

describe("crash during delivery (G12, 4.8)", () => {
  it("a job without a crash delivers once: push, one pull request, one comment", async () => {
    const { forge, engine } = await forgeProject();
    const p = engine.project("shop");
    const id = await engine.createJob("shop", { title: "Add hello", ticket: { text: "x", id: "7" } });
    await until(() => p.executor.job(id).state === "succeeded");
    const s = await forge.state();
    expect(s.prs).toMatchObject([{ head: `factory/${id}`, base: "main", state: "OPEN" }]);
    expect(s.comments).toEqual([{ issue: "7", body: s.prs[0]!.url }]);
    const commit = p.executor.artifacts(id).find((a) => a.type === "commit")!;
    const sha = (JSON.parse(await readFile(join(p.ctx.dir, commit.path), "utf8")) as { sha: string }).sha;
    expect(forge.remoteHead("acme/shop", `factory/${id}`)).toBe(sha);
    await engine.shutdown();
  });

  for (const { node, hang } of deliveryNodes) {
    it(`a kill during ${node}, then a restart and play, delivers once`, async () => {
      const { forge, home, templates, engine } = await forgeProject();
      const p = engine.project("shop");
      await forge.set({ hang });
      const id = await engine.createJob("shop", { title: "Add hello", ticket: { text: "x", id: "7" } });
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
      expect(s.comments).toHaveLength(1);
      expect(s.calls.filter((c) => c.startsWith("pr create"))).toHaveLength(1);
      expect(s.calls.filter((c) => c.startsWith("issue comment"))).toHaveLength(1);
      const requested = q.ctx.db.events(id).filter((e) => e.type === "effect.requested" && e.payload.node === node);
      expect(requested).toHaveLength(1);
      await again.shutdown();
    }, 60_000);
  }
});
