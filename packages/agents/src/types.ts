import type { Readable, Writable } from "node:stream";
import type { Connector } from "@pecore/schemas";

export type Login = { account: string; osUser: string; configDir: string; defaultDir: boolean; home: string };

export type SpawnedProcess = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pgid: number;
  exited: Promise<{ code: number | null; signal: string | null }>;
  stop(): Promise<void>;
};

export type Spawn = (p: { argv: string[]; env: Record<string, string>; cwd: string }) => Promise<SpawnedProcess>;

export type ResolvedConnector = Connector & {
  harnessPath: string;
  nodePath: string;
  adaptersDir: string;
  adapters: Record<string, { version: string; entry: string }>;
  platform: "linux" | "darwin";
};

export type RawLine = { dir: "in" | "out"; msg: unknown; at: number } | { dir: "err"; line: string; at: number };

export type Quota = { status: string; resetAt?: number; windows?: Record<string, { utilization: number; resetAt: number }> };

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCallId: string; title: string; kind: string; status: string }
  | { type: "permission"; toolCallId: string; optionId: string | null }
  | { type: "account"; email: string | null; plan: string | null }
  | { type: "quota"; quota: Quota }
  | { type: "usage"; usage: Usage };

export type ErrorKind = "auth" | "quota" | "rate_limit" | "other";

export type TurnResult = {
  stopReason?: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
  error?: { kind: ErrorKind; resetAt?: number; raw: string };
  usage: Usage;
  model?: string;
  costUsd?: number;
  quota?: Quota;
  text: string;
};

export type McpServer = { type: "http"; name: string; url: string; headers: { name: string; value: string }[] };

export type Session = {
  sessionId: string;
  resumed: boolean;
  events: AsyncIterable<AgentEvent>;
  raw: AsyncIterable<RawLine>;
  prompt(text: string): Promise<TurnResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
};

export class StartError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly raw: string,
  ) {
    super(raw);
  }
}
