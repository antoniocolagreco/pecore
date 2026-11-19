import { createHash } from "node:crypto";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import type { Settings } from "@pecore/schemas";
import type { ProjectDb } from "../store/project-db";
import { readComposeFile } from "./compose-file";
import type { ComposeFile } from "./compose-file";
import { ServicesRuntimeController } from "./runtime";

const ulid = monotonicFactory();

export type ServicesSubject = { path: string; kind: "services"; sha256: string; compose: unknown };
export type ServicesState = { kind: "ready"; env: Record<string, string> } | { kind: "confirm"; itemId: string };

type Running = { file: ComposeFile; env: Record<string, string>; stopped: boolean };

export class JobServices {
  private readonly jobs = new Map<string, Running>();

  constructor(
    private readonly db: ProjectDb,
    private readonly projectDir: string,
    private readonly path: string | null,
    private readonly runtime: () => Settings["servicesRuntime"],
  ) {}

  private controller(): ServicesRuntimeController {
    return new ServicesRuntimeController(this.runtime());
  }

  private confirm(jobId: string, file: ComposeFile): string | null {
    const path = `services/${this.path}`;
    const row = this.db.db.prepare("SELECT sha256 FROM confirmed_hashes WHERE path = ?").get(path) as { sha256: string } | undefined;
    if (row?.sha256 === file.sha256) return null;
    const subject: ServicesSubject = { path, kind: "services", sha256: file.sha256, compose: JSON.parse(file.bytes.toString("utf8")) as unknown };
    const subjectHash = createHash("sha256").update(JSON.stringify(subject)).digest("hex");
    const open = this.db.db.prepare("SELECT id, subject_hash FROM human_queue WHERE state = 'open' AND kind = 'services'").all() as { id: string; subject_hash: string }[];
    for (const item of open) {
      if (item.subject_hash === subjectHash) return item.id;
    }
    const itemId = ulid();
    this.db.append([{ jobId, type: "queue.added", payload: { itemId, kind: "services", subject, subjectHash, choices: ["confirm", "reject"] } }]);
    return itemId;
  }

  async ensure(jobId: string, base: string, onStarting: () => void): Promise<ServicesState> {
    if (this.path === null) return { kind: "ready", env: {} };
    const running = this.jobs.get(jobId);
    if (running && !running.stopped) return { kind: "ready", env: running.env };
    const file = running?.file ?? (await readComposeFile(join(this.projectDir, "repo.git"), base, this.path, this.runtime()));
    const itemId = this.confirm(jobId, file);
    if (itemId !== null) return { kind: "confirm", itemId };
    onStarting();
    if (running) await this.controller().start(jobId, file);
    else await this.controller().up(jobId, file);
    const env = await this.controller().readPorts(jobId, file);
    this.jobs.set(jobId, { file, env, stopped: false });
    return { kind: "ready", env };
  }

  async stop(jobId: string): Promise<void> {
    const running = this.jobs.get(jobId);
    if (!running || running.stopped) return;
    running.stopped = true;
    await this.controller().stop(jobId, running.file);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.jobs.keys()].map((id) => this.stop(id)));
  }

  async down(jobId: string): Promise<void> {
    if (this.path === null) return;
    this.jobs.delete(jobId);
    await this.controller().sweep((id) => id === jobId);
  }
}

export function recordServicesConfirmation(db: ProjectDb, subject: ServicesSubject): void {
  db.append([{ jobId: null, type: "confirmation.recorded", payload: { path: subject.path, sha256: subject.sha256 } }]);
}
