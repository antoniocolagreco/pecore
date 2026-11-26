import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { setTestConfiguration } from "../../test/configuration";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeAgent, Project } from "@pecore/schemas";
import { describe, expect, it } from "vitest";
import { createProjectWithRecipes } from "../../test/project";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { Engine } from "../main";

const fakeAgent = fileURLToPath(new URL("../../../agents/test/fake-agent/agent.mjs", import.meta.url));

const init = [{ expect: "initialize" }, { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } } } } }];
const startSession = (sessionId: string): object[] => [{ expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId } } }];
const newSession: object[] = startSession("S1");
const resumeSession = [{ expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }];
const prompt = { expect: "session/prompt" };
const usageAnswer = { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: 30, cachedWriteTokens: 40 } } } };
const message = (text: string, messageId: string = "final", sessionId: string = "S1"): object => ({
  send: { jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } } } },
});
const output = (o: object, sessionId: string = "S1"): object => message(JSON.stringify(o), "final", sessionId);

const agentNode = (extra: object = {}) => ({
  name: "agent-x",
  description: "test agent",
  kind: "agent",
  prompt: "agent-x.md",
  agent: { tier: "strong" },
  outcomes: ["done", "again"],
  changesFiles: true,
  timeoutSec: 60,
  retry: 1,
  ...extra,
});

async function setup(scripts: object[][], node: object = agentNode(), recipeExtra: object = {}, knowledge: Record<string, string> = {},
  recipeKnowledge?: Project["recipeKnowledge"], configureAgent: boolean = true) {
  const root = await tempDir();
  const home = join(root, "home");
  const lib = join(root, "templates");
  await cp(shippedTemplates, lib, { recursive: true });
  await writeFile(join(lib, "nodes", "agent-x.json"), JSON.stringify(node));
  await writeFile(join(lib, "nodes", "agent-x.md"), "Do the task {job.title}.\n");
  await writeFile(
    join(lib, "recipes", "one-agent.json"),
    JSON.stringify({ name: "one-agent", description: "one agent", start: "x", successOutcomes: ["x:done"], nodes: { x: { use: "agent-x" } }, edges: [{ from: "x", on: "again", to: "x", maxRounds: 1 }], ...recipeExtra }),
  );
  const files = [];
  for (const [i, s] of scripts.entries()) {
    const f = join(root, `script-${i}.jsonl`);
    await writeFile(f, s.map((x) => JSON.stringify(x)).join("\n") + "\n");
    files.push(f);
  }
  const connectors = join(root, "connectors");
  await mkdir(connectors);
  await writeFile(
    join(connectors, "fake.json"),
    JSON.stringify({ name: "fake", title: "Fake", kind: "native", harness: { program: "node", versionArgs: ["--version"], versionRange: ">=18.0.0" }, command: ["{harnessPath}", fakeAgent], env: { FAKE_AGENT_SCRIPT: files.join(",") }, reader: "claude-code" }),
  );
  await mkdir(home, { recursive: true });
  await setTestConfiguration(home, "accounts", { accounts: [
    { id: "fake", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" },
    { id: "fake-alt", kind: "model", provider: "fakeco", connector: "fake", login: "subscription" },
  ] });
  if (configureAgent) {
    await setTestConfiguration(home, "profiles", { profiles: [{ id: "p1", account: "fake", model: "m1" }] });
    await setTestConfiguration(home, "tiers", { tiers: { strong: ["p1"], standard: ["p1"] } });
    await setTestConfiguration(home, "agents", { agents: [
      { id: "agent-default", kind: "agent", name: "Default Agent", color: "#68389A",
        model: { account: "fake", model: "m-default" }, compaction: { auto: 131_072, max: 262_144 } },
      { id: "reviewer", kind: "agent", name: "Reviewer", color: "#FFFFFF",
        model: { account: "fake", model: "m-default" }, compaction: { auto: 131_072, max: 262_144 } },
    ] });
  }
  const engine = await Engine.start({ home, templates: lib, agents: { connectorsDir: connectors, adaptersDir: join(root, "adapters"), adapters: {} }, checkLogins: false });
  engine.setAgentContext("agent-default", "# Shared agent context");
  if (configureAgent) engine.setAgentContext("reviewer", "# Reviewer instructions");
  await createProjectWithRecipes(engine, { id: "demo", name: "Demo", repo: null, recipeKnowledge }, ["one-agent"]);
  const p = engine.project("demo");
  for (const [name, content] of Object.entries(knowledge)) await writeFile(join(p.ctx.dir, "knowledge", name), content);
  const id = await engine.createJob("demo", { title: "Fix it", request: "x" });
  return { engine, p, id, root };
}

async function until<T>(fn: () => T | undefined | false, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const final = (p: Awaited<ReturnType<typeof setup>>["p"], id: string) => () => {
  const j = p.executor.job(id);
  return ["succeeded", "failed", "waiting", "not_delivered", "stopped"].includes(j.state) ? j : undefined;
};

describe("agent nodes with the fake agent (5.4)", () => {
  it("stops at an unconfigured agent and runs the same step after Resume", async () => {
    const { engine, p, id } = await setup([[
      ...init, ...newSession, prompt, output({ outcome: "done" }), usageAnswer,
    ]], agentNode(), {}, {}, undefined, false);
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "stopped", failure_reason: "AGENT_UNAVAILABLE" });
      expect(engine.why(id).reasons).toContainEqual(expect.objectContaining({ reason: "AGENT_UNAVAILABLE", text: "Choose a provider and model on the Default Agent card." }));
      expect(p.ctx.db.db.prepare("SELECT count(*) FROM attempts").pluck().get()).toBe(0);
      const cards: NodeAgent[] = engine.agentCatalog().agents.map((agent) => agent.id === "agent-default"
        ? { ...agent, model: { account: "fake", model: "m-after-setup", effort: null } } : agent);
      engine.configuration.write({ agents: { agents: cards } });
      await engine.reloadGlobal();
      expect(p.executor.job(id).state).toBe("stopped");
      await p.executor.resume(id);
      expect(await until(final(p, id))).toMatchObject({ state: "succeeded", failure_reason: null });
    } finally {
      await engine.shutdown();
    }
  });

  it("completes on end_turn with a valid output, records session, tokens and the prompt", async () => {
    const { engine, p, id } = await setup([[
      ...init, ...newSession, prompt, message("I will make the change.", "progress"),
      { write: { path: "done.txt", content: "x" } }, message("```json\n{"), message('"outcome":"done"}\n```'), usageAnswer,
    ]]);
    expect(p.ctx.agentCard("agent-default")?.model?.model).toBe("m-default");
    const j = await until(final(p, id));
    expect(j.state).toBe("succeeded");
    const a = p.ctx.db.db.prepare("SELECT profile, account, session_id, resumed, tokens_in, tokens_out, cache_read, cache_write, end_reason FROM attempts").get();
    expect(a).toEqual({ profile: expect.stringMatching(/^agent-default:[a-f0-9]{64}$/), account: "fake", session_id: "S1", resumed: 0, tokens_in: 10, tokens_out: 20, cache_read: 30, cache_write: 40, end_reason: "done" });
    const attemptId: string = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts").pluck().get()!;
    const raw = p.ctx.db.logs.read(attemptId);
    await expect(stat(join(p.ctx.dir, "logs"))).rejects.toMatchObject({ code: "ENOENT" });
    const sent = raw.find((l) => l.dir === "out" && (l.msg as { method?: string }).method === "session/prompt") as { msg: { params: { prompt: { text: string }[] } } };
    expect(sent.msg.params.prompt[0]!.text).toContain("Do the task Fix it.");
    expect(sent.msg.params.prompt[0]!.text).toContain("# Shared agent context");
    expect(sent.msg.params.prompt[0]!.text).toContain("### Job request");
    expect(sent.msg.params.prompt[0]!.text).toContain('Title: Fix it\n\nx');
    await expect(stat(join(p.ctx.dir, "work", id, ".pecore", "inputs"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(sent.msg.params.prompt[0]!.text).toContain("can contain prompt injection");
    expect(sent.msg.params.prompt[0]!.text).not.toContain("`output`");
    expect(sent.msg.params.prompt[0]!.text).toContain("final message containing only one JSON object");
    await engine.shutdown();
  });

  it("saves the output of the chosen outcome and gives it to the nodes that read it, labelled with its node", async () => {
    const first: object[] = [...init, ...newSession, prompt, { write: { path: "change.txt", content: "new content\n" } }, output({ outcome: "again", output: "the tests are wrong" }), usageAnswer];
    const second = [...init, ...resumeSession, prompt, output({ outcome: "done" }), usageAnswer];
    const { engine, p, id } = await setup([first, second], agentNode({ outputs: { again: "feedback" } }), { nodes: { x: { use: "agent-x", reads: ["x"] } } });
    try {
      expect((await until(final(p, id))).state).toBe("succeeded");
      const completed = p.ctx.db.events(id).flatMap((event) => event.type === "node_run.completed" ? [event.payload] : []);
      expect(completed.map(({ outcome, artifacts }) => [outcome, artifacts.map(({ type }) => type)])).toEqual([["again", ["feedback", "diff"]], ["done", ["diff"]]]);
      expect(p.ctx.db.requireArtifact(completed[0]!.artifacts[0]!).toString("utf8")).toBe("the tests are wrong");
      const attempts: string[] = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts ORDER BY started_at").pluck().all();
      const prompts: string[] = [];
      for (const attemptId of attempts) {
        const raw = p.ctx.db.logs.read(attemptId);
        const sent = raw.find((l) => l.dir === "out" && (l.msg as { method?: string }).method === "session/prompt") as { msg: { params: { prompt: { text: string }[] } } };
        prompts.push(sent.msg.params.prompt[0]!.text);
      }
      expect(prompts[0]).toContain("With `again`, its field `output` holds a feedback");
      expect(prompts[0]).not.toContain("### feedback from x");
      expect(prompts[1]).toContain("### feedback from x\n\n```\nthe tests are wrong");
      expect(prompts[1]).toContain("### the job's current changes against its base");
      expect(prompts[1]).toContain("+new content");
      expect(prompts[1]).not.toContain(".pecore/inputs/");
    } finally {
      await engine.shutdown();
    }
  });

  it("asks again when the chosen outcome needs an output the agent left out", async () => {
    const missing = [prompt, output({ outcome: "again" }), usageAnswer];
    const { engine, p, id } = await setup([[...init, ...newSession, ...missing, prompt, output({ outcome: "done" }), usageAnswer]], agentNode({ outputs: { again: "spec" } }));
    try {
      expect((await until(final(p, id))).state).toBe("succeeded");
      const attemptId: string = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts").pluck().get()!;
      const raw = p.ctx.db.logs.read(attemptId);
      const sent = raw.filter((l) => l.dir === "out" && (l.msg as { method?: string }).method === "session/prompt") as { msg: { params: { prompt: { text: string }[] } } }[];
      expect(sent[1]!.msg.params.prompt[0]!.text).toContain("/output is required with again");
    } finally {
      await engine.shutdown();
    }
  });

  it("includes the selected knowledge and its linked files inline", async () => {
    const { engine, p, id } = await setup([[...init, ...newSession, prompt, output({ outcome: "done" }), usageAnswer]], agentNode({ knowledge: ["architecture.md"] }), {}, {
      "architecture.md": "See [naming](naming.md).\n",
      "naming.md": "Names.\n",
      "unrelated.md": "Other.\n",
    });
    expect((await until(final(p, id))).state).toBe("succeeded");
    const attemptId: string = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts").pluck().get()!;
    const raw = p.ctx.db.logs.read(attemptId);
    const sent = raw.find((l) => l.dir === "out" && (l.msg as { method?: string }).method === "session/prompt") as { msg: { params: { prompt: { text: string }[] } } };
    const text: string = sent.msg.params.prompt[0]!.text;
    expect(text).toContain("### architecture.md\n\n```\nSee [naming](naming.md).");
    expect(text).toContain("### naming.md\n\n```\nNames.");
    expect(text).not.toContain(".pecore/context");
    expect(text).not.toContain("unrelated.md");
    await engine.shutdown();
  });

  it("uses the project recipe step's knowledge instead of the node template list", async () => {
    const { engine, p, id } = await setup([[...init, ...newSession, prompt, output({ outcome: "done" }), usageAnswer]],
      agentNode({ knowledge: ["template.md"] }), {}, {
        "project.md": "See [naming](naming.md).\n",
        "naming.md": "Names.\n",
        "template.md": "Old template selection.\n",
      }, { "one-agent": { x: ["project.md"] } });
    try {
      expect((await until(final(p, id))).state).toBe("succeeded");
      expect(p.ctx.db.events(id).find(({ type }) => type === "job.created")?.payload)
        .toMatchObject({ definitions: { knowledgeByStep: { x: ["project.md"] } } });
      const attemptId: string = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts").pluck().get()!;
      const raw = p.ctx.db.logs.read(attemptId);
      const sent = raw.find((line) => line.dir === "out" && (line.msg as { method?: string }).method === "session/prompt") as {
        msg: { params: { prompt: { text: string }[] } };
      };
      const text: string = sent.msg.params.prompt[0]!.text;
      expect(text).toContain("### project.md");
      expect(text).toContain("### naming.md");
      expect(text).not.toContain("template.md");
    } finally {
      await engine.shutdown();
    }
  });

  it("rejects missing JSON, surrounding prose and invalid outcomes after two corrections", async () => {
    const { engine, p, id } = await setup([[
      ...init, ...newSession, prompt, usageAnswer,
      prompt, message('Done: {"outcome":"done"}'), usageAnswer,
      prompt, output({ outcome: "nope" }), usageAnswer,
    ]]);
    const j = await until(final(p, id));
    expect(j).toMatchObject({ state: "failed", failure_reason: "INVALID_OUTPUT" });
    expect(p.ctx.db.db.prepare("SELECT count(*) AS n FROM attempts").get()).toEqual({ n: 1 });
    expect(p.ctx.db.db.prepare("SELECT tokens_in FROM attempts").get()).toEqual({ tokens_in: 30 });
    await engine.shutdown();
  });

  it("asks the user through the final message and resumes the same session with the answer", async () => {
    const asks: object[] = [...init, ...newSession, prompt, output({ question: "Email or username?" }), usageAnswer];
    const answered = [...init, ...resumeSession, prompt, output({ outcome: "done" }), usageAnswer];
    const { engine, p, id } = await setup([asks, answered]);
    const asked: string[] = [];
    p.ctx.agentQuestion = (itemId) => asked.push(itemId);
    const waiting = await until(final(p, id));
    expect(waiting).toMatchObject({ state: "waiting", waiting_reason: "human" });
    const workdir: string = join(p.ctx.dir, "work", id);
    expect((await stat(workdir)).isDirectory()).toBe(true);
    for (const file of ["output.json", "output.schema.json", "question.json", "context"]) {
      await expect(stat(join(workdir, ".pecore", file))).rejects.toMatchObject({ code: "ENOENT" });
    }
    const item = p.ctx.db.db.prepare("SELECT id, kind, subject, subject_hash FROM human_queue WHERE state = 'open'").get() as { id: string; kind: string; subject: string; subject_hash: string };
    expect(item.kind).toBe("agent-question");
    expect(JSON.parse(item.subject)).toMatchObject({ question: "Email or username?", sessionId: "S1" });
    expect(asked).toEqual([item.id]);
    await p.executor.answer(item.id, "answer", "Email", item.subject_hash);
    const j = await until(() => (p.executor.job(id).state === "succeeded" ? p.executor.job(id) : undefined));
    expect(j.state).toBe("succeeded");
    expect(p.ctx.db.db.prepare("SELECT session_id, resumed FROM attempts ORDER BY started_at").all()).toEqual([
      { session_id: "S1", resumed: 0 },
      { session_id: "S1", resumed: 1 },
    ]);
    const attempts: string[] = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts ORDER BY started_at").pluck().all();
    const raw = p.ctx.db.logs.read(attempts[1]!);
    const sent = raw.find((l) => l.dir === "out" && (l.msg as { method?: string }).method === "session/prompt") as { msg: { params: { prompt: { text: string }[] } } };
    expect(sent.msg.params.prompt[0]!.text).toContain("Email");
    await engine.shutdown();
  });

  it("waits for quota with the reset time from data.errorKind, without using a retry", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const { engine, p, id } = await setup([[...init, ...newSession, prompt, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32603, message: "limit", data: { errorKind: "rate_limit", rateLimit: { resetsAt } } } } }]]);
    const j = await until(final(p, id));
    expect(j).toMatchObject({ state: "waiting", waiting_reason: "quota" });
    expect(p.ctx.db.db.prepare("SELECT state, waiting_reason, reset_at FROM node_runs").get()).toEqual({ state: "waiting", waiting_reason: "quota", reset_at: resetsAt * 1000 });
    expect(engine.agents!.cooling("fake")?.until).toBe(resetsAt * 1000);
    await p.executor.stop(id);
    await engine.shutdown();
  });

  it("waits for a login on Authentication required", async () => {
    const { engine, p, id } = await setup([[...init, ...newSession, prompt, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32000, message: "Authentication required" } } }]]);
    const j = await until(final(p, id));
    expect(j).toMatchObject({ state: "waiting", waiting_reason: "auth" });
    expect(p.ctx.db.db.prepare("SELECT auth_account, auth_kind FROM node_runs").get()).toEqual({ auth_account: "fake", auth_kind: "harness" });
    await p.executor.stop(id);
    await engine.shutdown();
  });

  it("stores ACP traffic when the connector rejects session creation", async () => {
    const { engine, p, id } = await setup([[
      ...init, { expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32000, message: "Authentication required" } } },
    ]]);
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "waiting", waiting_reason: "auth" });
      const attemptId: string = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts").pluck().get()!;
      expect(p.ctx.db.logs.read(attemptId).slice(0, 4)).toMatchObject([
        { dir: "out", msg: { method: "initialize" } },
        { dir: "in", msg: { result: { protocolVersion: 1 } } },
        { dir: "out", msg: { method: "session/new" } },
        { dir: "in", msg: { error: { code: -32000, message: "Authentication required" } } },
      ]);
    } finally {
      await engine.shutdown();
    }
  });

  it("uses the retry after a connector crash, then fails with HARNESS_ERROR", async () => {
    const crash = [...init, ...newSession, prompt, { exit: 1 }];
    const probe = [...init, ...newSession];
    const { engine, p, id } = await setup([crash, probe, crash, probe]);
    const j = await until(final(p, id));
    expect(j).toMatchObject({ state: "failed", failure_reason: "HARNESS_ERROR" });
    expect(p.ctx.db.db.prepare("SELECT count(*) AS n FROM attempts").get()).toEqual({ n: 2 });
    await engine.shutdown();
  }, 30000);

  it("times out: cancel, then stop", async () => {
    const t0 = Date.now();
    const { engine, p, id } = await setup([[...init, ...newSession, prompt, { sleep: 60000 }]], agentNode({ timeoutSec: 1, retry: 0 }));
    const j = await until(final(p, id), 25000);
    expect(j).toMatchObject({ state: "failed", failure_reason: "TIMEOUT" });
    expect(Date.now() - t0).toBeLessThan(20000);
    await engine.shutdown();
  }, 30000);

  it.each([
    { mode: "job", session: "S1", resumed: 1 },
    { mode: "node", session: "S1", resumed: 1 },
    { mode: "new", session: "S2", resumed: 0 },
  ])("uses $mode session rules when a step repeats", async ({ mode, session, resumed }) => {
    const { engine, p, id } = await setup([
      [...init, ...newSession, prompt, output({ outcome: "again" }), usageAnswer],
      [...init, ...(resumed ? resumeSession : startSession("S2")), prompt, output({ outcome: "done" }, session), usageAnswer],
    ], agentNode({ agentSession: mode }));
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "succeeded" });
      expect(p.ctx.db.db.prepare("SELECT session_id, resumed FROM attempts ORDER BY id").all()).toEqual([
        { session_id: "S1", resumed: 0 },
        { session_id: session, resumed },
      ]);
    } finally {
      await engine.shutdown();
    }
  });

  it("keeps Node sessions separate for two steps that use the same template and from the Job session", async () => {
    const { engine, p, id } = await setup([
      [...init, ...newSession, prompt, output({ outcome: "again" }), usageAnswer],
      [...init, ...startSession("S2"), prompt, output({ outcome: "done" }, "S2"), usageAnswer],
      [...init, ...startSession("S3"), prompt, output({ outcome: "done" }, "S3"), usageAnswer],
      [...init, ...resumeSession, prompt, output({ outcome: "done" }), usageAnswer],
    ], agentNode({ agentSession: "node" }), {
      nodes: { x: { use: "agent-x" }, y: { use: "agent-x" }, z: { use: "agent-x", agentSession: "job" } },
      edges: [{ from: "x", on: "again", to: "y" }, { from: "y", on: "done", to: "z" }, { from: "z", on: "done", to: "x" }],
    });
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "succeeded" });
      expect(p.ctx.db.db.prepare("SELECT session_id, resumed FROM attempts ORDER BY id").all()).toEqual([
        { session_id: "S1", resumed: 0 }, { session_id: "S2", resumed: 0 },
        { session_id: "S3", resumed: 0 }, { session_id: "S1", resumed: 1 },
      ]);
    } finally {
      await engine.shutdown();
    }
  });

  it("starts a separate Job session for a different job with the same card", async () => {
    const { engine, p, id } = await setup([
      [...init, ...newSession, prompt, output({ outcome: "done" }), usageAnswer],
      [...init, ...startSession("S2"), prompt, output({ outcome: "done" }, "S2"), usageAnswer],
    ]);
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "succeeded" });
      const next: string = await engine.createJob("demo", { title: "Second job", request: "y" });
      expect(await until(final(p, next))).toMatchObject({ state: "succeeded" });
      expect(p.ctx.db.db.prepare("SELECT session_id, resumed FROM attempts ORDER BY id").all()).toEqual([
        { session_id: "S1", resumed: 0 }, { session_id: "S2", resumed: 0 },
      ]);
    } finally {
      await engine.shutdown();
    }
  });

  it("keeps separate Job sessions per card across nodes and skips New runs", async () => {
    const { engine, p, id } = await setup([
      [...init, ...newSession, prompt, output({ outcome: "done" }), usageAnswer],
      [...init, ...startSession("S2"), prompt, output({ outcome: "done" }, "S2"), usageAnswer],
      [...init, ...startSession("S3"), prompt, output({ outcome: "done" }, "S3"), usageAnswer],
      [...init, ...resumeSession, prompt, output({ outcome: "done" }), usageAnswer],
      [...init, ...resumeSession, prompt, output({ outcome: "done" }, "S3"), usageAnswer],
    ], agentNode({ agentSession: "new" }), {
      nodes: {
        x: { use: "agent-x", agentSession: "job" }, "new-run": { use: "agent-x" },
        review: { use: "agent-x", agentId: "reviewer", agentSession: "job" },
        build: { use: "agent-x", agentSession: "job" },
        verify: { use: "agent-x", agentId: "reviewer", agentSession: "job" },
      },
      successOutcomes: ["verify:done"],
      edges: [
        { from: "x", on: "done", to: "new-run" }, { from: "new-run", on: "done", to: "review" },
        { from: "review", on: "done", to: "build" }, { from: "build", on: "done", to: "verify" },
      ],
    });
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "succeeded" });
      expect(p.ctx.db.db.prepare("SELECT agent_id, agent_session, session_id, resumed FROM attempts ORDER BY id").all()).toEqual([
        { agent_id: "agent-default", agent_session: "job", session_id: "S1", resumed: 0 },
        { agent_id: "agent-default", agent_session: "new", session_id: "S2", resumed: 0 },
        { agent_id: "reviewer", agent_session: "job", session_id: "S3", resumed: 0 },
        { agent_id: "agent-default", agent_session: "job", session_id: "S1", resumed: 1 },
        { agent_id: "reviewer", agent_session: "job", session_id: "S3", resumed: 1 },
      ]);
      const attemptId: string = p.ctx.db.db.prepare<[], string>("SELECT id FROM attempts WHERE agent_id = 'reviewer' ORDER BY id LIMIT 1").pluck().get()!;
      const text: string = JSON.stringify(p.ctx.db.logs.read(attemptId));
      expect(text).toContain("# Reviewer instructions");
      expect(text).not.toContain("# Shared agent context");
    } finally {
      await engine.shutdown();
    }
  });

  it.each([
    { account: "fake-alt", model: "m-default", effort: null },
    { account: "fake", model: "m-next", effort: null },
    { account: "fake", model: "m-default", effort: "high" },
  ].flatMap((model: NonNullable<NodeAgent["model"]>) => [
    { mode: "job", model },
    { mode: "node", model },
  ]))("starts a fresh $mode session after the card changes to $model.account/$model.model/$model.effort", async ({ mode, model }) => {
    const repeat: boolean = mode === "node";
    const { engine, p, id } = await setup([
      [...init, ...newSession, prompt, output({ question: "Continue?" }), usageAnswer],
      [...init, ...resumeSession, prompt, output({ outcome: repeat ? "again" : "done" }), usageAnswer],
      [...init, ...startSession("S2"), prompt, output({ outcome: "done" }, "S2"), usageAnswer],
    ], agentNode({ agentSession: mode }), repeat ? {} : {
      nodes: { x: { use: "agent-x" }, y: { use: "agent-x" } },
      successOutcomes: ["y:done"],
      edges: [{ from: "x", on: "done", to: "y" }],
    });
    try {
      expect(await until(final(p, id))).toMatchObject({ state: "waiting", waiting_reason: "human" });
      const cards: NodeAgent[] = engine.agentCatalog().agents.map((agent) => agent.id === "agent-default" ? { ...agent, model } : agent);
      engine.configuration.write({ agents: { agents: cards } });
      await engine.reloadGlobal();
      const item = p.ctx.db.db.prepare<[], { id: string; subject_hash: string }>("SELECT id, subject_hash FROM human_queue WHERE state = 'open'").get()!;
      await p.executor.answer(item.id, "answer", "Yes", item.subject_hash);
      expect(await until(() => {
        const job = p.executor.job(id);
        return job.state === "waiting" ? undefined : final(p, id)();
      })).toMatchObject({ state: "succeeded" });
      expect(p.ctx.db.db.prepare("SELECT session_id, resumed FROM attempts ORDER BY id").all()).toEqual([
        { session_id: "S1", resumed: 0 }, { session_id: "S1", resumed: 1 }, { session_id: "S2", resumed: 0 },
      ]);
    } finally {
      await engine.shutdown();
    }
  });
});

void readFile;
