import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Recipe } from "@pecore/schemas";
import type { ForgeAccount } from "@pecore/schemas";
import { describe, expect, it } from "vitest";
import { setTestConfiguration } from "../../test/configuration";
import { forgeHome, forgeProject, until } from "../../test/forge-project";
import { createProjectWithRecipes } from "../../test/project";
import { Engine } from "../main";
import { jobDefinitions } from "../definitions/snapshot";
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

it.each([
  { forge: "git", tool: "git", host: "git.example.com" },
  { forge: "codecommit", tool: "aws", host: "git-codecommit.eu-south-1.amazonaws.com" },
] as const)("pushes to $forge without running Write PR or producing a delivery artifact", async ({ forge, tool, host }) => {
  const { forge: remote, home, templates } = await forgeHome();
  await remote.createRepo("acme/shop");
  await appendFile(join(remote.dir, "home", ".gitconfig"), `[url "${join(remote.dir, "remotes")}/"]\n\tinsteadOf = https://${host}/\n`);
  const account: ForgeAccount = { id: "remote", kind: "forge", forge, tool, host, user: "default", author: { name: "Test", email: "test@example.com" } };
  await setTestConfiguration(home, "accounts", { accounts: [account] });
  const engine: Engine = await Engine.start({ home, templates });
  try {
    const recipe: Recipe = engine.catalog.recipe("deliver")!;
    engine.catalog.saveRecipe(Recipe.parse({
      ...recipe,
      nodes: { ...recipe.nodes, writer: { use: "write-pr" }, pr: { use: "open-pr", reads: ["writer"] } },
      edges: [...recipe.edges.filter(({ to }) => to !== "pr"), { from: "push", on: "success", to: "writer" }, { from: "writer", on: "success", to: "pr" }],
    }));
    await createProjectWithRecipes(engine, { id: "shop", name: "Shop", repo: { url: `https://${host}/acme/shop.git`, account: account.id } }, ["deliver"]);
    const { ctx, executor } = engine.project("shop");
    const id: string = await engine.createJob("shop", { title: "Deliver hello", request: "Add hello.txt" });
    await until(() => executor.job(id).state === "succeeded");
    expect(ctx.db.events(id).flatMap((event) => event.type === "node_run.created" ? [event.payload.node] : [])).toEqual(["write", "commit", "push", "pr"]);
    expect(jobDefinitions(ctx.db, id)?.nodes["open-pr"]?.definition.outputs).toEqual({});
    expect(executor.artifacts(id).filter(({ type }) => type === "pull_request")).toHaveLength(1);
    expect(remote.remoteHead("acme/shop", `factory/${id}`)).toBe(jobCommit(ctx.db, ctx.db.events(id)));
    expect((await remote.state()).prs).toEqual([]);
  } finally {
    await engine.shutdown();
  }
});
