import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConnector } from "./connectors";
import { fixturesDir, login, readFixture, replaySpawn, resolved } from "../test/helpers";
import { classify, errorMessage } from "./errors";
import { claudeCodeReader } from "./readers/claude-code";
import { startSession } from "./session";
import type { AgentEvent, TurnResult } from "./types";

type Expected = { resumed: boolean; startError?: { kind: string }; turns: { result: TurnResult; events: AgentEvent[] }[] };

async function replay(file: string, reader: "claude-code" | "codex" | "opencode" = "claude-code"): Promise<Expected> {
  const lines = readFixture(file);
  const outs = lines.filter((l) => l.dir === "out").map((l) => l.msg!);
  const sessionConfig = outs.filter((m) => m.method === "session/set_config_option").map((m) => {
    const p = m.params as { configId: string; value: string };
    return [p.configId, p.value] as [string, string];
  });
  const resume = outs.find((m) => m.method === "session/resume" || m.method === "session/load");
  const prompts = outs.filter((m) => m.method === "session/prompt").map((m) => ((m.params as { prompt: { text: string }[] }).prompt[0]!.text));
  const connector = resolved({ sessionConfig, reader });
  try {
    const s = await startSession({ connector, login, spawn: replaySpawn(lines), cwd: "/tmp", model: "", ...(resume ? { resumeId: (resume.params as { sessionId: string }).sessionId } : {}) });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const e of s.events) events.push(e);
    })();
    void (async () => {
      for await (const _ of s.raw) void _;
    })();
    const turns: Expected["turns"] = [];
    for (const text of prompts) {
      const before = events.length;
      const result = await s.prompt(text);
      await new Promise((r) => setTimeout(r, 5));
      turns.push({ result, events: events.slice(before) });
    }
    await s.close();
    return { resumed: s.resumed, turns };
  } catch (e) {
    return { resumed: false, startError: { kind: (e as { kind: string }).kind }, turns: [] };
  }
}

const cases = readdirSync(join(fixturesDir, "claude-code"))
  .filter((f) => f.endsWith(".jsonl"))
  .map((f) => f.replace(/\.jsonl$/, ""));

describe("claude-code connector: recorded traffic through the reader and the classifier", () => {
  for (const name of cases) {
    it(name, async () => {
      const got = JSON.parse(JSON.stringify(await replay(join(fixturesDir, "claude-code", `${name}.jsonl`)))) as Expected;
      const expectedFile = join(fixturesDir, "claude-code", `${name}.expected.json`);
      if (process.env.UPDATE_FIXTURES === "1" || !existsSync(expectedFile)) writeFileSync(expectedFile, JSON.stringify(got, null, 2) + "\n");
      expect(got).toEqual(JSON.parse(readFileSync(expectedFile, "utf8")));
    });
  }

  it("two-turns: usage adds the side model, cost only for the new session, quota and model", async () => {
    const r = await replay(join(fixturesDir, "claude-code", "two-turns.jsonl"));
    const t1 = r.turns[0]!.result;
    expect(t1).toMatchObject({ stopReason: "end_turn", text: "fatto", model: "claude-opus-5-5", usage: { input: 1208, output: 132, cacheRead: 41263, cacheWrite: 23537 } });
    expect(t1.costUsd).toBeCloseTo(0.198974, 6);
    expect(t1.quota).toMatchObject({ status: "allowed", resetAt: 1795026600000 });
    expect(t1.error).toBeUndefined();
    expect(r.turns[1]!.result.text).toBe("ciao pecora");
  });

  it("auth-missing: -32000 Authentication required is auth", async () => {
    const r = await replay(join(fixturesDir, "claude-code", "auth-missing.jsonl"));
    expect(r.turns[0]!.result.error?.kind).toBe("auth");
  });

  it("permission: answered with allow_once", async () => {
    const r = await replay(join(fixturesDir, "claude-code", "permission.jsonl"));
    expect(r.turns.flatMap((t) => t.events).find((e) => e.type === "permission")).toEqual({ type: "permission", toolCallId: "toolu_01681edTgGwPLsBixP95wrsu", optionId: "allow-once" });
  });

  it("protected-resume: resumed in a new process, no cost reported", async () => {
    const r = await replay(join(fixturesDir, "claude-code", "protected-resume.jsonl"));
    expect(r.resumed).toBe(true);
    expect(r.turns[0]!.result.text).toBe("Alfa.");
    expect(r.turns[0]!.result.costUsd).toBeUndefined();
  });
});

describe("shipped connector files", () => {
  const dir = fileURLToPath(new URL("../../app/resources/connectors/", import.meta.url));
  it("are claude-code, codex, opencode and pi, and each one is valid", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    expect(files).toEqual(["claude-code.json", "codex.json", "opencode.json", "pi.json"]);
    for (const f of files) expect({ file: f, errors: parseConnector(JSON.parse(readFileSync(join(dir, f), "utf8"))).errors }).toEqual({ file: f, errors: [] });
  });
});

describe("codex and opencode connectors: recorded traffic through their readers", () => {
  it("codex tool-call: end_turn, usage without the cached input, the account from the notification", async () => {
    const r = await replay(join(fixturesDir, "codex", "tool-call.jsonl"), "codex");
    expect(r.startError).toBeUndefined();
    const turn = r.turns.at(-1)!;
    expect(turn.result).toMatchObject({ stopReason: "end_turn", usage: { input: 226, output: 47, cacheRead: 26752, cacheWrite: 0 } });
    expect(turn.result.error).toBeUndefined();
    expect(r.turns.flatMap((t) => t.events)).toContainEqual(expect.objectContaining({ type: "account", email: "user@example.com" }));
  });

  it("opencode free model limit: the shipped connector rule makes it quota, not a harness error", () => {
    const file = fileURLToPath(new URL("../../app/resources/connectors/opencode.json", import.meta.url));
    const { connector } = parseConnector(JSON.parse(readFileSync(file, "utf8")));
    const error = { code: -32603, message: "Internal error: Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.", data: { service: "session", errorName: "provider.free-limit" } };
    expect(classify({ error, text: "", rules: connector!.errors, at: 1000 })).toEqual({ kind: "quota", raw: JSON.stringify(error) });
    expect(errorMessage(JSON.stringify(error))).toBe(error.message);
    expect(errorMessage(JSON.stringify({ code: -32603, message: "Internal error", data: { message: "You've hit your usage limit." } }))).toBe("You've hit your usage limit.");
    expect(errorMessage("stopReason max_tokens")).toBe("stopReason max_tokens");
  });

  it("opencode auth-missing: -32000 Authentication required is auth", async () => {
    const r = await replay(join(fixturesDir, "opencode", "auth-missing.jsonl"), "opencode");
    const kind = r.startError?.kind ?? r.turns[0]?.result.error?.kind;
    expect(kind).toBe("auth");
  });
});

describe("classifier (5.4), synthetic until recorded", () => {
  const base = { text: "", rules: [], at: 1000 };
  it("only an Authentication required -32000 is auth", () => {
    expect(classify({ ...base, error: { code: -32000, message: "Authentication required" } })?.kind).toBe("auth");
    expect(classify({ ...base, error: { code: -32000, message: "Internal error" } })?.kind).toBe("other");
  });

  it("reads data.errorKind and its reset time", () => {
    expect(classify({ ...base, error: { code: -32603, message: "x", data: { errorKind: "rate_limit", rateLimit: { resetsAt: 1795026600 } } } })).toMatchObject({ kind: "quota", resetAt: 1795026600000 });
    expect(classify({ ...base, error: { code: -32603, message: "x", data: { errorKind: "billing_error" } } })).toMatchObject({ kind: "quota" });
    expect(classify({ ...base, error: { code: -32603, message: "x", data: { errorKind: "authentication_failed" } } })?.kind).toBe("auth");
    expect(classify({ ...base, error: { code: -32603, message: "x", data: { errorKind: "overloaded" } } })?.kind).toBe("other");
  });

  it("a rejected quota during the turn is quota with its reset", () => {
    expect(classify({ ...base, stopReason: "end_turn", quota: { status: "rejected", resetAt: 5000 } })).toMatchObject({ kind: "quota", resetAt: 5000 });
    expect(classify({ ...base, stopReason: "end_turn", quota: { status: "allowed_warning" } })).toBeUndefined();
  });

  it("applies connector rules with a reset time", () => {
    const rules = [{ pattern: "try again in (?<s>\\d+) seconds", in: "text" as const, kind: "rate_limit" as const, resetAt: "s", resetFormat: "seconds" as const }];
    expect(classify({ ...base, stopReason: "end_turn", text: "please try again in 30 seconds", rules })).toEqual({ kind: "rate_limit", raw: "please try again in 30 seconds", resetAt: 31000 });
  });

  it("a turn that did not end with end_turn is other", () => {
    expect(classify({ ...base, stopReason: "max_tokens" })?.kind).toBe("other");
  });

  it("the claude-code reader maps an unauthenticated status to logged_out", () => {
    expect(claudeCodeReader.notification("auth/status_update", { state: "unauthenticated" })).toEqual({ account: { state: "logged_out" } });
  });
});
