import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { monotonicFactory } from "ulid";
import type { z } from "zod";
import { EventBody } from "@pecore/schemas";
import type { Artifact, StoredEvent } from "@pecore/schemas";
import { AttemptLogs } from "../observability/logs";
import { migrate } from "./migrate";
import { ProjectDefinition } from "./project-definition";
import { Catalog } from "./catalog";

type EventInput = z.input<typeof EventBody>;
type TicketSeen = Extract<EventInput, { type: "ticket.seen" }>;
export type NewEvent = (Exclude<EventInput, TicketSeen> | { type: "ticket.seen"; payload: Omit<TicketSeen["payload"], "orderId"> }) & { jobId: string | null };

const ulid = monotonicFactory();

export class ProjectDb {
  readonly db: Database.Database;
  readonly logs: AttemptLogs;
  readonly definition: ProjectDefinition;
  readonly catalog: Catalog;
  onAppend: (events: StoredEvent[]) => void = () => undefined;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    migrate(this.db, "");
    this.logs = new AttemptLogs(this.db);
    this.definition = new ProjectDefinition(this.db);
    this.catalog = new Catalog(this.db);
  }

  close(): void {
    this.db.close();
  }

  version(): number {
    return (this.db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
  }

  saveArtifact(jobId: string, run: string, name: string, type: Artifact["type"], content: string | Buffer, contentState: string | null): Artifact {
    const bytes: Buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const sha256: string = createHash("sha256").update(bytes).digest("hex");
    this.db.prepare(`INSERT INTO artifacts (job_id, run, name, type, sha256, content_state, content) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (job_id, run, name, type) DO UPDATE SET sha256 = excluded.sha256, content_state = excluded.content_state, content = excluded.content`)
      .run(jobId, run, name, type, sha256, contentState, bytes);
    return { jobId, run, name, type, sha256, contentState };
  }

  artifactContent({ jobId, run, name, type }: Artifact, limit: number | null = null): Buffer | undefined {
    return this.db.prepare<[number | null, number | null, string, string, string, string], Buffer>(
      `SELECT CASE WHEN ? IS NULL THEN content ELSE substr(content, 1, ?) END
       FROM artifacts WHERE job_id = ? AND run = ? AND name = ? AND type = ?`,
    ).pluck().get(limit, limit, jobId, run, name, type);
  }

  requireArtifact(artifact: Artifact, limit?: number): Buffer {
    const content: Buffer | undefined = this.artifactContent(artifact, limit);
    if (content === undefined) throw new Error(`artifact ${artifact.jobId}/${artifact.run}/${artifact.name} not found`);
    return content;
  }

  append(events: NewEvent[], now = Date.now()): StoredEvent[] {
    const insert = this.db.prepare("INSERT INTO events (id, job_id, type, payload, at) VALUES (?, ?, ?, ?, ?)");
    const stored = this.db.transaction(() => {
      const stored: StoredEvent[] = [];
      for (const e of events) {
        const id: string = ulid(now);
        const payload: unknown = e.type === "ticket.seen" ? { ...e.payload, orderId: id } : e.payload;
        const body = EventBody.parse({ type: e.type, payload });
        const ev = { ...body, id, jobId: e.jobId, at: now } as StoredEvent;
        insert.run(ev.id, ev.jobId, ev.type, JSON.stringify(ev.payload), ev.at);
        this.project(ev);
        stored.push(ev);
      }
      return stored;
    })();
    this.onAppend(stored);
    return stored;
  }

  events(jobId?: string): StoredEvent[] {
    const rows = (jobId === undefined
      ? this.db.prepare("SELECT * FROM events ORDER BY id").all()
      : this.db.prepare("SELECT * FROM events WHERE job_id = ? ORDER BY id").all(jobId)) as EventRow[];
    return rows.map(eventFromRow);
  }

  orderEvents(orderId: string): StoredEvent[] {
    return (this.db.prepare("SELECT * FROM events WHERE type LIKE 'order.%' AND json_extract(payload, '$.orderId') = ? ORDER BY id").all(orderId) as EventRow[]).map(eventFromRow);
  }

  private project(e: StoredEvent): void {
    const run = (sql: string, params: Record<string, unknown>) => this.db.prepare(sql).run(params);
    const at = e.at;
    switch (e.type) {
      case "job.created": {
        const p = e.payload;
        run(
          `INSERT INTO jobs (id, title, recipe, state, parent_job_id, base_branch, base, old_base, target, branch, created_at, updated_at, order_id, order_key)
           VALUES (@id, @title, @recipe, 'queued', @parent, @baseBranch, @base, @base, @target, @branch, @at, @at, @orderId, @orderKey)`,
          { id: e.jobId, title: p.title, recipe: JSON.stringify(p.recipe), parent: p.parentJobId, baseBranch: p.baseBranch, base: p.base, target: p.target, branch: p.branch, at, orderId: p.orderId ?? null, orderKey: p.orderKey ?? null },
        );
        return;
      }
      case "job.state_changed": {
        const { state, reason } = e.payload;
        const failed = state === "failed" || state === "not_delivered" || state === "stopped";
        const waiting = state === "queued" || state === "waiting" || state === "paused";
        run("UPDATE jobs SET state = @state, waiting_reason = @w, failure_reason = @f, updated_at = @at WHERE id = @id", {
          id: e.jobId,
          state,
          w: waiting ? reason : null,
          f: failed ? reason : null,
          at,
        });
        return;
      }
      case "job.base_changed":
        run("UPDATE jobs SET old_base = @oldBase, base = @base, target = @target, updated_at = @at WHERE id = @id", { id: e.jobId, base: e.payload.base, oldBase: e.payload.oldBase, target: e.payload.target, at });
        return;
      case "job.delivery_merged":
        run("UPDATE jobs SET merged_at = @at, updated_at = @at WHERE id = @id", { id: e.jobId, at });
        return;
      case "job.archived":
      case "job.unarchived":
        run("UPDATE jobs SET archived = @a, updated_at = @at WHERE id = @id", { id: e.jobId, a: e.type === "job.archived" ? 1 : 0, at });
        return;
      case "node_run.created":
        run("INSERT INTO node_runs (id, job_id, node, round, via_edge, state) VALUES (@id, @job, @node, @round, @via, 'pending')", {
          id: e.payload.nodeRunId,
          job: e.jobId,
          node: e.payload.node,
          round: e.payload.round,
          via: e.payload.viaEdge,
        });
        return;
      case "node_run.state_changed": {
        const p = e.payload;
        run(
          `UPDATE node_runs SET state = @state, waiting_reason = @reason, reset_at = @resetAt, queue_item_id = @queue,
             auth_account = @authAccount, auth_os_user = @authUser, auth_kind = @authKind,
             pgid = CASE WHEN @state = 'running' THEN coalesce(@pgid, pgid) ELSE NULL END, os_user = coalesce(@osUser, os_user),
             started_at = CASE WHEN @state = 'running' AND started_at IS NULL THEN @at ELSE started_at END,
             ended_at = CASE WHEN @state IN ('interrupted', 'skipped') THEN @at ELSE ended_at END
           WHERE id = @id`,
          {
            id: p.nodeRunId,
            state: p.state,
            reason: p.waitingReason,
            resetAt: p.resetAt ?? null,
            queue: p.queueItemId ?? null,
            authAccount: p.auth?.account ?? null,
            authUser: p.auth?.osUser ?? null,
            authKind: p.auth?.kind ?? null,
            pgid: p.pgid ?? null,
            osUser: p.osUser ?? null,
            at,
          },
        );
        return;
      }
      case "node_run.git_recorded":
        run("UPDATE node_runs SET git_before = @git WHERE id = @id", {
          id: e.payload.nodeRunId,
          git: JSON.stringify({ branch: e.payload.branch, head: e.payload.head }),
        });
        return;
      case "node_run.completed":
        run(
          "UPDATE node_runs SET state = 'completed', outcome = @outcome, content_before = @before, content_after = @after, waiting_reason = NULL, ended_at = @at WHERE id = @id",
          { id: e.payload.nodeRunId, outcome: e.payload.outcome, before: e.payload.contentBefore, after: e.payload.contentAfter, at },
        );
        return;
      case "node_run.failed":
        run("UPDATE node_runs SET state = 'failed', failure_reason = @reason, waiting_reason = NULL, ended_at = @at WHERE id = @id", { id: e.payload.nodeRunId, reason: e.payload.reason, at });
        return;
      case "attempt.started": {
        const p = e.payload;
        run(
          `INSERT INTO attempts (id, node_run_id, profile, connector, harness_version, connector_version, account, os_user, session_group, started_at)
           VALUES (@id, @nodeRun, @profile, @connector, @harness, @connectorVersion, @account, @osUser, @group, @at)`,
          {
            id: p.attemptId,
            nodeRun: p.nodeRunId,
            profile: p.profile,
            connector: p.connector,
            harness: p.harnessVersion,
            connectorVersion: p.connectorVersion,
            account: p.account,
            osUser: p.osUser,
            group: p.sessionGroup,
            at,
          },
        );
        return;
      }
      case "attempt.session_started":
        run("UPDATE attempts SET session_id = @session, resumed = @resumed WHERE id = @id", { id: e.payload.attemptId, session: e.payload.sessionId, resumed: e.payload.resumed ? 1 : 0 });
        return;
      case "attempt.ended": {
        const p = e.payload;
        const t = p.tokens;
        run(
          `UPDATE attempts SET end_reason = @reason, model = coalesce(@model, model), tokens_in = @in, tokens_out = @out,
             cache_read = @cr, cache_write = @cw, cost = @cost, ended_at = @at WHERE id = @id`,
          { id: p.attemptId, reason: p.endReason, model: p.model, in: t.input, out: t.output, cr: t.cacheRead, cw: t.cacheWrite, cost: p.cost, at },
        );
        return;
      }
      case "effect.requested":
      case "effect.completed":
      case "effect.failed":
        return;
      case "queue.added": {
        const p = e.payload;
        run(
          `INSERT INTO human_queue (id, job_id, kind, subject, subject_hash, state, choices, created_at)
           VALUES (@id, @job, @kind, @subject, @hash, 'open', @choices, @at)`,
          { id: p.itemId, job: e.jobId, kind: p.kind, subject: JSON.stringify(p.subject), hash: p.subjectHash, choices: JSON.stringify(p.choices), at },
        );
        return;
      }
      case "queue.resolved":
        run("UPDATE human_queue SET state = @state, choice = @choice, note = @note, resolved_at = @at WHERE id = @id", {
          id: e.payload.itemId,
          state: e.payload.state,
          choice: e.payload.choice,
          note: e.payload.note,
          at,
        });
        return;
      case "confirmation.recorded":
        return;
      case "ticket.seen":
        run("INSERT OR IGNORE INTO tickets_seen (source, ticket_id, seen_at, order_id) VALUES (@source, @ticket, @at, @orderId)", { source: e.payload.source, ticket: e.payload.ticketId, at, orderId: e.payload.orderId });
        return;
      case "order.read":
        run("UPDATE tickets_seen SET state = @state WHERE order_id = @id AND state = 'received'", { id: e.payload.orderId, state: e.payload.trusted ? "received" : "confirming" });
        return;
      case "order.handed":
        run(
          `UPDATE tickets_seen SET state = 'handed' WHERE order_id = @id AND
           (state IN ('received', 'confirming', 'handed') OR (state = 'asking' AND (@onlyIfCurrent = 0 OR @askId = (
             SELECT id FROM events WHERE type LIKE 'order.%' AND type = 'order.asked'
             AND json_extract(payload, '$.orderId') = @id ORDER BY id DESC LIMIT 1))))`,
          { id: e.payload.orderId, askId: e.payload.askId ?? null, onlyIfCurrent: e.payload.askId === undefined ? 0 : 1 },
        );
        return;
      case "order.asked":
        run("UPDATE tickets_seen SET state = 'asking' WHERE order_id = @id AND state IN ('received', 'confirming', 'handed', 'asking')", { id: e.payload.orderId });
        return;
      case "order.planned":
      case "order.done":
      case "order.dropped":
        run("UPDATE tickets_seen SET state = @state WHERE order_id = @id AND state NOT IN ('done', 'dropped')", { id: e.payload.orderId, state: { "order.planned": "planned", "order.done": "done", "order.dropped": "dropped" }[e.type] });
        return;
    }
  }
}

type EventRow = { id: string; job_id: string | null; type: string; payload: string; at: number };

function eventFromRow(row: EventRow): StoredEvent {
  const payload: unknown = JSON.parse(row.payload);
  return { id: row.id, jobId: row.job_id, type: row.type, payload: row.type === "ticket.seen" ? { ...(payload as TicketSeen["payload"]), orderId: row.id } : payload, at: row.at } as StoredEvent;
}
