import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createZstdCompress, createZstdDecompress } from "node:zlib";

export type LogLine = { dir: "in" | "out"; msg: unknown; at: number } | { dir: "err"; line: string; at: number } | { dir: "cmd"; text: string; at: number };

export class LogWriter {
  private readonly input = new Readable({ read() {} });
  private done: Promise<void> | null = null;
  private closed = false;

  private constructor(readonly path: string) {}

  static async open(path: string): Promise<LogWriter> {
    await mkdir(dirname(path), { recursive: true });
    const w = new LogWriter(path);
    w.done = pipeline(w.input, createZstdCompress(), createWriteStream(path, { mode: 0o600 }));
    return w;
  }

  write(line: LogLine): void {
    if (!this.closed) this.input.push(JSON.stringify(line) + "\n");
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.input.push(null);
    }
    await this.done;
  }
}

export async function readLog(path: string): Promise<LogLine[]> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(path).pipe(createZstdDecompress());
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogLine);
}
