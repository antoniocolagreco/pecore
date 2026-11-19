import { AcpClient, ExitError, RpcError, TimeoutError } from "./acp/client";
import type { JsonRpcError } from "./acp/client";
import { connectorProcess, fill, fillSessionValue, forPlatform } from "./connectors";
import { classify } from "./errors";
import { AsyncQueue } from "./queue";
import { readerFor } from "./readers";
import type { Account } from "./readers/claude-code";
import { StartError } from "./types";
import type { AgentEvent, Login, McpServer, PromptContent, Quota, ResolvedConnector, Session, Spawn, TurnResult } from "./types";

type ConfigOption = { id: string; category?: string; currentValue?: unknown; options?: { value: string }[] };
type SessionResult = { sessionId?: string; configOptions?: ConfigOption[] };
type InitResult = {
  agentInfo?: { version?: string };
  agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: unknown }; promptCapabilities?: { image?: boolean } };
};

export type StartParams = {
  connector: ResolvedConnector;
  login: Login;
  spawn: Spawn;
  cwd: string;
  model: string;
  effort?: string | null;
  resumeId?: string;
  mcpServers?: McpServer[];
  requestTimeoutMs?: number;
};

export type OpenedConnection = {
  client: AcpClient;
  init: InitResult;
  account: () => Account | undefined;
};

function errorText(e: unknown): string {
  if (e instanceof RpcError) return JSON.stringify(e.error);
  return e instanceof Error ? e.message : String(e);
}

export async function runBefore(spawn: Spawn, commands: string[][] | undefined, c: ResolvedConnector, login: Login): Promise<void> {
  for (const cmd of commands ?? []) {
    const p = await spawn({ argv: cmd.map((a) => fill(a, c, { home: login.home })), env: {}, cwd: login.home });
    p.stdin.end();
    const exit = await p.exited;
    if (exit.code !== 0) throw new StartError("other", `${cmd[0]} exited with ${exit.code ?? exit.signal}`);
  }
}

export async function openConnection(p: { connector: ResolvedConnector; login: Login; spawn: Spawn; cwd: string; secrets?: string[]; requestTimeoutMs?: number }): Promise<OpenedConnection> {
  const c = p.connector;
  if (!p.login.defaultDir) await runBefore(p.spawn, forPlatform(c.beforeStart, c.platform), c, p.login);
  const { argv, env } = connectorProcess(c, p.login);
  const proc = await p.spawn({ argv, env, cwd: p.cwd });
  const client = new AcpClient(proc, p.secrets ?? [], p.requestTimeoutMs);
  const reader = readerFor(c.reader);
  let account: Account | undefined;
  client.handleNotifications((method, params) => {
    const r = reader.notification(method, params);
    if (r.account) account = r.account;
  });
  client.handleRequests((method) => {
    throw new RpcError({ code: -32601, message: `${method} not supported` });
  });
  try {
    const init = await client.request<InitResult>("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    return { client, init, account: () => account };
  } catch (e) {
    await proc.stop();
    throw new StartError("other", errorText(e));
  }
}

export async function probeImageSupport(p: Pick<StartParams, "connector" | "login" | "spawn" | "cwd">): Promise<boolean> {
  const { client, init } = await openConnection(p);
  await client.proc.stop();
  return init.agentCapabilities?.promptCapabilities?.image === true;
}

export async function startSession(p: StartParams): Promise<Session> {
  const c = p.connector;
  const secrets = (p.mcpServers ?? []).flatMap((s) => ("headers" in s ? s.headers : s.env).map(({ value }) => value));
  const { client, init } = await openConnection({ connector: c, login: p.login, spawn: p.spawn, cwd: p.cwd, secrets, ...(p.requestTimeoutMs !== undefined ? { requestTimeoutMs: p.requestTimeoutMs } : {}) });
  const reader = readerFor(c.reader);
  const events = new AsyncQueue<AgentEvent>();
  const turn = { text: "", quota: undefined as Quota | undefined, model: undefined as string | undefined, cost: undefined as { amount: number; currency: string } | undefined };
  let dropReplay = false;

  client.handleNotifications((method, params) => {
    const r = reader.notification(method, params);
    if (r.account) events.push({ type: "account", email: r.account.state === "logged_in" ? r.account.email : null, plan: r.account.state === "logged_in" ? (r.account.plan ?? null) : null });
    if (r.quota) {
      turn.quota = r.quota;
      events.push({ type: "quota", quota: r.quota });
    }
    if (r.model) turn.model = r.model;
    if (r.cost) turn.cost = r.cost;
    if (method !== "session/update" || dropReplay) return;
    const u = (params as { update?: Record<string, unknown> }).update ?? {};
    if (u.sessionUpdate === "agent_message_chunk") {
      const text = (u.content as { text?: string } | undefined)?.text ?? "";
      turn.text += text;
      events.push({ type: "text", text });
    } else if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
      events.push({ type: "tool_call", toolCallId: String(u.toolCallId ?? ""), title: String(u.title ?? ""), kind: String(u.kind ?? ""), status: String(u.status ?? "") });
    }
  });
  client.handleRequests((method, params) => {
    if (method !== "session/request_permission") throw new RpcError({ code: -32601, message: `${method} not supported` });
    const q = params as { toolCall?: { toolCallId?: string }; options?: { optionId: string; kind: string }[] };
    const opt = q.options?.find((o) => o.kind === "allow_once");
    events.push({ type: "permission", toolCallId: q.toolCall?.toolCallId ?? "", optionId: opt?.optionId ?? null });
    return { outcome: opt ? { outcome: "selected", optionId: opt.optionId } : { outcome: "cancelled" } };
  });

  const fail = async (e: unknown): Promise<never> => {
    await client.proc.stop();
    events.end();
    if (e instanceof StartError) throw e;
    const kind = e instanceof RpcError && e.error.code === -32000 && e.error.message.startsWith("Authentication required") ? "auth" : "other";
    throw new StartError(kind, errorText(e));
  };

  const meta = c.sessionMeta ?? undefined;
  const base = { cwd: p.cwd, mcpServers: p.mcpServers ?? [], ...(meta ? { _meta: meta } : {}) };
  let session: SessionResult | undefined;
  let sessionId: string | undefined;
  let resumed = false;
  try {
    if (p.resumeId) {
      const caps = init.agentCapabilities;
      try {
        if (caps?.sessionCapabilities?.resume !== undefined) {
          session = await client.request<SessionResult>("session/resume", { ...base, sessionId: p.resumeId });
          resumed = true;
        } else if (caps?.loadSession) {
          dropReplay = true;
          session = await client.request<SessionResult>("session/load", { ...base, sessionId: p.resumeId });
          dropReplay = false;
          resumed = true;
        }
      } catch (e) {
        dropReplay = false;
        if (e instanceof ExitError) throw e;
      }
      if (resumed) sessionId = session?.sessionId ?? p.resumeId;
    }
    if (!resumed) {
      session = await client.request<SessionResult>("session/new", base);
      sessionId = session.sessionId;
    }
    if (!sessionId) throw new StartError("other", "no session id");
    turn.model = reader.model?.(session) ?? turn.model;
    const suppliedModel: RegExpExecArray | null = c.reader === "codex" ? /^(.+)\[([a-z][a-z0-9_-]*)\]$/.exec(p.model) : null;
    const vars: { model: string; effort: string | null } = { model: suppliedModel?.[1] ?? p.model, effort: p.effort || suppliedModel?.[2] || null };
    for (const [id, value] of c.sessionConfig) {
      const v = fillSessionValue(value, vars);
      if (v === "") continue;
      const r = await client.request<SessionResult>("session/set_config_option", { sessionId, configId: id, value: v });
      const current = r?.configOptions?.find((o) => o.id === id)?.currentValue;
      if (current !== v) throw new StartError("other", `config option ${id}: sent ${v}, current ${JSON.stringify(current)}`);
      turn.model = reader.model?.(r) ?? turn.model;
    }
  } catch (e) {
    return fail(e);
  }

  const sid = sessionId;
  let closed = false;
  return {
    sessionId: sid,
    resumed,
    supportsImages: init.agentCapabilities?.promptCapabilities?.image === true,
    events,
    raw: client.raw,
    async prompt(content: string | readonly PromptContent[]): Promise<TurnResult> {
      turn.text = "";
      turn.quota = undefined;
      const at = Date.now();
      let result: { stopReason?: TurnResult["stopReason"] } | undefined;
      let error: JsonRpcError | undefined;
      try {
        const prompt: readonly PromptContent[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
        result = await client.request("session/prompt", { sessionId: sid, prompt }, null);
      } catch (e) {
        if (e instanceof RpcError) error = e.error;
        else if (e instanceof ExitError || e instanceof TimeoutError) error = { code: -1, message: e.message };
        else error = { code: -1, message: String(e) };
      }
      const usage = result ? reader.usage(result) : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      events.push({ type: "usage", usage });
      const err = classify({ ...(error ? { error } : {}), ...(result?.stopReason ? { stopReason: result.stopReason } : {}), ...(turn.quota ? { quota: turn.quota } : {}), text: turn.text, rules: c.errors, at });
      const out: TurnResult = { usage, text: turn.text };
      if (result?.stopReason) out.stopReason = result.stopReason;
      if (err) out.error = err;
      const model: string | undefined = reader.model?.(result) ?? turn.model;
      if (model) out.model = model;
      if (turn.quota) out.quota = turn.quota;
      if (!resumed && turn.cost && turn.cost.currency === "USD") out.costUsd = turn.cost.amount;
      return out;
    },
    async cancel() {
      client.notify("session/cancel", { sessionId: sid });
    },
    async close() {
      if (closed) return;
      closed = true;
      client.endInput();
      await Promise.race([client.exited, new Promise((r) => setTimeout(r, 5000))]);
      await client.proc.stop();
      events.end();
    },
  };
}
