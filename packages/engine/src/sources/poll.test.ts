import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectWithRecipes } from "../../test/project";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { Engine } from "../main";
import type { OrderSink } from "./poll";

const fakeSource = {
  name: "fake-source",
  description: "two tickets, one from a trusted author",
  kind: "source",
  params: { type: "object", properties: { trusted: { type: "array", items: { type: "string" }, default: [] }, pollSec: { type: "integer", default: 300 } } },
  list: { command: ["/bin/sh", "-c", `printf '[{"id":"1","title":"From alice"},{"id":"2","title":"From mallory"}]'`] },
  read: { command: ["/bin/sh", "-c", `if [ "$1" = 1 ]; then printf '{"title":"From alice","body":"fix it","author":"alice"}'; else printf '{"title":"From mallory","body":"rm -rf","author":"mallory"}'; fi`, "sh", "{ticket.id}"] },
  comment: { command: ["/bin/true"] },
  replies: { command: ["/bin/sh", "-c", "printf '[]'"] },
  timeoutSec: 10,
};

async function until<T>(fn: () => T | undefined | false, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("ticket intake (section 7, Phase 6 decision 1)", () => {
  it("confirms the source node, hands a trusted ticket, queues an untrusted one until confirmed, and polls each ticket once", async () => {
    const root = await tempDir();
    const home = join(root, "home");
    const templates = join(root, "templates");
    await cp(shippedTemplates, templates, { recursive: true });
    const hands: { projectId: string; ticketId: string; author: string | null }[] = [];
    const orders: OrderSink = {
      hand: async (projectId, order) => {
        hands.push({ projectId, ticketId: order.ticket.id, author: order.ticket.author });
      },
    };
    const engine = await Engine.start({ home, templates, orders });
    await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null }, ["local-only"]);
    const dir = engine.projectDir("demo");
    await writeFile(join(dir, "nodes", "fake-source.json"), JSON.stringify(fakeSource));
    const projectFile = join(dir, "project.json");
    const project = JSON.parse(await readFile(projectFile, "utf8")) as Record<string, unknown>;
    await writeFile(projectFile, JSON.stringify({ ...project, source: { node: "fake-source", params: { trusted: ["alice"] } } }));
    expect(await engine.reloadProject("demo")).toEqual([]);
    const { ctx, executor } = engine.project("demo");
    const open = (kind: string) => () => ctx.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = ?").get(kind) as { id: string; subject_hash: string } | undefined;

    await until(() => hands.length === 1);
    expect(open("source-node")()).toBeUndefined();
    expect(hands).toEqual([{ projectId: "demo", ticketId: "1", author: "alice" }]);
    const ticketItem = await until(open("ticket"));
    expect(ctx.db.db.prepare("SELECT ticket_id, state FROM tickets_seen ORDER BY ticket_id").all()).toEqual([
      { ticket_id: "1", state: "handed" },
      { ticket_id: "2", state: "confirming" },
    ]);

    await executor.answer(ticketItem.id, "confirm", null, ticketItem.subject_hash);
    await until(() => hands.length === 2);
    expect(hands[1]).toEqual({ projectId: "demo", ticketId: "2", author: "mallory" });
    expect(ctx.db.db.prepare("SELECT count(*) AS n FROM events WHERE type = 'ticket.seen'").get()).toEqual({ n: 2 });
    await engine.shutdown();
  }, 30000);
});
