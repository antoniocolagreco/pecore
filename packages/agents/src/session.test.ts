import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { login, processSpawn, resolved } from "../test/helpers";
import { startSession } from "./session";
import { StartError } from "./types";
import type { ResolvedConnector, Spawn } from "./types";

const init = [{ expect: "initialize" }, { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, agentInfo: { version: "9.9.9" } } } }];
const newSession = [{ expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: { sessionId: "S1" } } }];
const option = (id: string, value: string) => [{ expect: "session/set_config_option" }, { send: { jsonrpc: "2.0", id: "$id", result: { configOptions: [{ id, currentValue: value }] } } }];
const endTurn = (text: string) => [
  { expect: "session/prompt" },
  { send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } } },
  { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 2, cachedReadTokens: 3, cachedWriteTokens: 4 } } } },
];

function script(steps: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pecore-fake-"));
  const file = join(dir, "script.jsonl");
  writeFileSync(file, steps.map((s) => JSON.stringify(s)).join("\n") + "\n");
  return file;
}

const connector = resolved({ sessionConfig: [["mode", "bypassPermissions"], ["model", "{model}"], ["effort", "{effort}"]] });

async function start(steps: object[], extra: Partial<Parameters<typeof startSession>[0]> = {}) {
  return startSession({ connector, login, spawn: processSpawn({ FAKE_AGENT_SCRIPT: script(steps) }), cwd: tmpdir(), model: "opus", effort: "high", ...extra });
}

describe("ACP session with the fake agent", () => {
  it("applies the options in order, checks each value, and runs a turn", async () => {
    const s = await start([...init, ...newSession, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...option("effort", "high"), ...endTurn("hi")]);
    const r = await s.prompt("hello");
    expect(r).toMatchObject({ stopReason: "end_turn", text: "hi", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } });
    expect(r.error).toBeUndefined();
    await s.close();
  });

  it("starts a new paragraph when the text resumes after a tool call", async () => {
    const chunk = (text: string) => ({ send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } } } });
    const tool = { send: { jsonrpc: "2.0", method: "session/update", params: { sessionId: "S1", update: { sessionUpdate: "tool_call", toolCallId: "T1", title: "Read", kind: "read", status: "pending" } } } };
    const s = await start([
      ...init, ...newSession, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...option("effort", "high"),
      { expect: "session/prompt" },
      chunk("I check the "), chunk("agents."), tool, chunk("I see "), chunk("them."),
      { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn" } } },
    ]);
    const streamed: string[] = [];
    const reading: Promise<void> = (async () => { for await (const event of s.events) if (event.type === "text") streamed.push(event.text); })();
    expect(await s.prompt("x")).toMatchObject({ text: "I check the agents.\n\nI see them.", finalText: "I see them." });
    await s.close();
    await reading;
    expect(streamed.join("")).toBe("I check the agents.\n\nI see them.");
  });

  it("skips an option with an empty value", async () => {
    const s = await start([...init, ...newSession, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...endTurn("ok")], { effort: null });
    expect((await s.prompt("x")).text).toBe("ok");
    await s.close();
  });

  it("fails the start when an option does not take the value sent", async () => {
    await expect(start([...init, ...newSession, ...option("mode", "default")])).rejects.toMatchObject({ kind: "other", raw: expect.stringContaining("config option mode") });
  });

  it.each([false, true])("answers permission requests according to denyPermissions=%s", async (denyPermissions) => {
    const steps = [
      ...init,
      ...newSession,
      ...option("mode", "bypassPermissions"),
      ...option("model", "opus"),
      ...option("effort", "high"),
      { expect: "session/prompt" },
      { send: { jsonrpc: "2.0", id: 0, method: "session/request_permission", params: { toolCall: { toolCallId: "T1" }, options: [{ optionId: "yes", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }] } } },
      { expect: "response" },
      { send: { jsonrpc: "2.0", id: "$id", result: { stopReason: "end_turn" } } },
    ];
    const s = await start(steps, { denyPermissions });
    const events: unknown[] = [];
    void (async () => {
      for await (const e of s.events) events.push(e);
    })();
    const raw: { dir: string; msg?: { id?: number; result?: unknown } }[] = [];
    void (async () => {
      for await (const l of s.raw) raw.push(l as never);
    })();
    await s.prompt("x");
    expect(events).toContainEqual({ type: "permission", toolCallId: "T1", optionId: denyPermissions ? null : "yes" });
    expect(raw.find((l) => l.dir === "out" && l.msg?.id === 0)?.msg?.result).toEqual({ outcome: denyPermissions ? { outcome: "cancelled" } : { outcome: "selected", optionId: "yes" } });
    await s.close();
  });

  it("resumes a session when the connector offers it", async () => {
    const s = await start([...init, { expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", result: {} } }, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...option("effort", "high")], { resumeId: "OLD" });
    expect(s).toMatchObject({ sessionId: "OLD", resumed: true });
    await s.close();
  });

  it("starts Codex with the selected model before resuming and streams only prompt text", async () => {
    const codex: ResolvedConnector = resolved({
      reader: "codex",
      env: { CODEX_CONFIG: '{"model":"gpt-6.2-sol","service_tier":"fast"}' },
      sessionConfig: [["model", "{model}"], ["reasoning_effort", "{effort}"]],
    });
    const fake: Spawn = processSpawn({ FAKE_AGENT_SCRIPT: script([
      ...init,
      { expect: "session/resume" },
      endTurn("Resume warning")[1]!,
      { send: { jsonrpc: "2.0", id: "$id", result: {} } },
      ...option("model", "gpt-6-luna"),
      ...option("reasoning_effort", "low"),
      ...endTurn("Reply"),
    ]) });
    const spawn: Spawn = (params) => {
      expect(JSON.parse(params.env.CODEX_CONFIG!)).toEqual({
        model: "gpt-6-luna",
        model_reasoning_effort: "low",
        service_tier: "fast",
      });
      return fake(params);
    };
    const s = await startSession({ connector: codex, login, spawn, cwd: tmpdir(), model: "gpt-6-luna[low]", resumeId: "S1" });
    try {
      expect(s.resumed).toBe(true);
      expect((await s.prompt("hello")).text).toBe("Reply");
    } finally {
      await s.close();
    }
    const chunks: string[] = [];
    for await (const event of s.events) {
      if (event.type === "text") chunks.push(event.text);
    }
    expect(chunks).toEqual(["Reply"]);
  });

  it("falls back to a new session when resume fails", async () => {
    const s = await start(
      [...init, { expect: "session/resume" }, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32602, message: "no such session" } } }, ...newSession, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...option("effort", "high")],
      { resumeId: "OLD" },
    );
    expect(s).toMatchObject({ sessionId: "S1", resumed: false });
    await s.close();
  });

  it("stops the connector when a request before the prompt gets no answer in time", async () => {
    const t0 = Date.now();
    await expect(start([...init, { expect: "session/new" }, { sleep: 5000 }], { requestTimeoutMs: 300 })).rejects.toBeInstanceOf(StartError);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it("gives an error result, never a rejection, when the connector exits during a turn", async () => {
    const s = await start([...init, ...newSession, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...option("effort", "high"), { expect: "session/prompt" }, { exit: 1 }]);
    const r = await s.prompt("x");
    expect(r.error?.kind).toBe("other");
    await s.close();
  });

  it("redacts MCP tokens from the raw log", async () => {
    const s = await start([...init, ...newSession, ...option("mode", "bypassPermissions"), ...option("model", "opus"), ...option("effort", "high")], {
      mcpServers: [{ type: "http", name: "pecore", url: "http://127.0.0.1:1/mcp", headers: [{ name: "Authorization", value: "Bearer SECRET-TOKEN" }] }],
    });
    const lines: string[] = [];
    await s.close();
    for await (const l of s.raw) lines.push(JSON.stringify(l));
    expect(lines.join("\n")).not.toContain("SECRET-TOKEN");
    expect(lines.join("\n")).toContain("***");
  });
});
