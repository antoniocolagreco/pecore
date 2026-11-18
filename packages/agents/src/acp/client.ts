import { createInterface } from "node:readline";
import { AsyncQueue } from "../queue";
import type { RawLine, SpawnedProcess } from "../types";

export type JsonRpcError = { code: number; message: string; data?: unknown };

export class RpcError extends Error {
  constructor(readonly error: JsonRpcError) {
    super(error.message);
  }
}

export class ExitError extends Error {
  constructor(readonly exit: { code: number | null; signal: string | null }) {
    super(`connector exited (${exit.code ?? exit.signal})`);
  }
}

export class TimeoutError extends Error {
  constructor(readonly method: string) {
    super(`${method}: no answer within 30 s`);
  }
}

type Message = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: JsonRpcError };

export type RequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;
export type NotificationHandler = (method: string, params: unknown) => void;

export const requestTimeoutMs = 30_000;

function redact(value: unknown, secrets: string[]): unknown {
  if (secrets.length === 0) return value;
  let s = JSON.stringify(value);
  for (const secret of secrets) if (secret) s = s.split(secret).join("***");
  return JSON.parse(s);
}

export class AcpClient {
  readonly raw = new AsyncQueue<RawLine>();
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private onNotification: NotificationHandler = () => undefined;
  private onRequest: RequestHandler = () => {
    throw new RpcError({ code: -32601, message: "not supported" });
  };
  readonly exited: Promise<{ code: number | null; signal: string | null }>;

  constructor(
    readonly proc: SpawnedProcess,
    private readonly secrets: string[] = [],
    private readonly timeoutMs: number = requestTimeoutMs,
  ) {
    createInterface({ input: proc.stdout }).on("line", (line) => this.receive(line));
    createInterface({ input: proc.stderr }).on("line", (line) => this.raw.push({ dir: "err", line: this.redactLine(line), at: Date.now() }));
    proc.stdin.on("error", () => undefined);
    this.exited = proc.exited.then((exit) => {
      for (const p of this.pending.values()) p.reject(new ExitError(exit));
      this.pending.clear();
      setTimeout(() => this.raw.end(), 50);
      return exit;
    });
  }

  private redactLine(line: string): string {
    let s = line;
    for (const secret of this.secrets) if (secret) s = s.split(secret).join("***");
    return s;
  }

  handleNotifications(h: NotificationHandler): void {
    this.onNotification = h;
  }

  handleRequests(h: RequestHandler): void {
    this.onRequest = h;
  }

  private write(msg: Message): void {
    this.raw.push({ dir: "out", msg: redact(msg, this.secrets), at: Date.now() });
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private receive(line: string): void {
    let msg: Message;
    try {
      msg = JSON.parse(line) as Message;
    } catch {
      this.raw.push({ dir: "err", line: this.redactLine(line), at: Date.now() });
      return;
    }
    this.raw.push({ dir: "in", msg: redact(msg, this.secrets), at: Date.now() });
    if (msg.method === undefined && msg.id !== undefined) {
      const p = this.pending.get(Number(msg.id));
      if (!p) return;
      this.pending.delete(Number(msg.id));
      if (msg.error) p.reject(new RpcError(msg.error));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method !== undefined && msg.id !== undefined) {
      const id = msg.id;
      Promise.resolve()
        .then(() => this.onRequest(msg.method!, msg.params))
        .then(
          (result) => this.write({ jsonrpc: "2.0", id, result: result ?? null }),
          (e: unknown) => this.write({ jsonrpc: "2.0", id, error: e instanceof RpcError ? e.error : { code: -32603, message: String(e) } }),
        );
      return;
    }
    if (msg.method !== undefined) this.onNotification(msg.method, msg.params);
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs: number | null = this.timeoutMs): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      if (timeoutMs !== null)
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new TimeoutError(method));
        }, timeoutMs);
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  endInput(): void {
    this.proc.stdin.end();
  }
}
