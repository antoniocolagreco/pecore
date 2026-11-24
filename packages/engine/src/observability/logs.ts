import type { RawLine } from "@pecore/agents";
import type Database from "better-sqlite3";

export type LogLine = RawLine | { dir: "cmd"; text: string; at: number };

type LogRow = { direction: LogLine["dir"]; at: number; payload: string };

function toLine({ direction: dir, at, payload }: LogRow): LogLine {
  if (dir === "err") return { dir, line: payload, at };
  if (dir === "cmd") return { dir, text: payload, at };
  return { dir, msg: JSON.parse(payload) as unknown, at };
}

export class AttemptLogs {
  private readonly insert: Database.Statement<[string, string, LogLine["dir"], number, string]>;

  constructor(private readonly db: Database.Database) {
    this.insert = db.prepare(`INSERT INTO attempt_logs (attempt_id, sequence, direction, at, payload)
      VALUES (?, (SELECT coalesce(max(sequence), 0) + 1 FROM attempt_logs WHERE attempt_id = ?), ?, ?, ?)`);
  }

  write(attemptId: string, line: LogLine): void {
    const payload: string = line.dir === "err" ? line.line : line.dir === "cmd" ? line.text : JSON.stringify(line.msg);
    this.insert.run(attemptId, attemptId, line.dir, line.at, payload);
  }

status(attemptId: string): "available" | "unavailable" | "missing" {
    const row: { log_omitted: number } | undefined = this.db.prepare<[string], { log_omitted: number }>("SELECT log_omitted FROM attempts WHERE id = ?").get(attemptId);
    if (!row) return "missing";
    return row.log_omitted ? "unavailable" : "available";
  }

  read(attemptId: string): LogLine[] {
    return this.db.prepare<[string], LogRow>(
      "SELECT direction, at, payload FROM attempt_logs WHERE attempt_id = ? ORDER BY sequence",
    ).all(attemptId).map(toLine);
  }

  tail(attemptId: string, limit: number): { bytes: Buffer; truncated: boolean } {
    const rows = this.db.prepare<[string], LogRow>(
      "SELECT direction, at, payload FROM attempt_logs WHERE attempt_id = ? ORDER BY sequence DESC",
    ).iterate(attemptId);
    const chunks: Buffer[] = [];
    let remaining: number = limit;
    for (const row of rows) {
      const bytes: Buffer = Buffer.from(JSON.stringify(toLine(row)) + "\n");
      if (bytes.length > remaining) {
        chunks.push(bytes.subarray(bytes.length - remaining));
        return { bytes: Buffer.concat(chunks.reverse()), truncated: true };
      }
      chunks.push(bytes);
      remaining -= bytes.length;
    }
    return { bytes: Buffer.concat(chunks.reverse()), truncated: false };
  }
}
