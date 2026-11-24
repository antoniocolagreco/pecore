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
  context?: { used: number; size: number };
  text: string;
  finalText: string;
};

type AcpMetadata = { _meta?: Record<string, unknown> | null };

export type McpServer = AcpMetadata & (
  | { type: "http"; name: string; url: string; headers: { name: string; value: string }[] }
  | { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
);

type ContentAnnotations = AcpMetadata & { audience?: ("user" | "assistant")[] | null; lastModified?: string | null; priority?: number | null };
type ResourceContents = AcpMetadata & { uri: string; mimeType?: string | null } & ({ text: string } | { blob: string });

export type PromptContent = AcpMetadata & { annotations?: ContentAnnotations | null } & (
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string; uri?: string | null }
  | { type: "audio"; mimeType: string; data: string }
  | { type: "resource_link"; name: string; uri: string; title?: string | null; description?: string | null; mimeType?: string | null; size?: number | null }
  | { type: "resource"; resource: ResourceContents }
);

export type Session = {
  sessionId: string;
  resumed: boolean;
  supportsImages: boolean;
  events: AsyncIterable<AgentEvent>;
  raw: AsyncIterable<RawLine>;
  prompt(content: string | readonly PromptContent[]): Promise<TurnResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
};

export class StartError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly raw: string,
    readonly traffic?: AsyncIterable<RawLine>,
  ) {
    super(raw);
  }
}
