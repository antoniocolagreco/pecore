import { createHash } from "node:crypto";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import type { Settings } from "@pecore/schemas";
import type { ProjectDb } from "../store/project-db";
import { gitAppResult } from "../workdir/git-as";
import { readComposeFile } from "./compose-file";
import type { ComposeFile } from "./compose-file";
import { ServicesRuntimeController } from "./runtime";

const ulid = monotonicFactory();

export type ServicesSubject = { path: string; kind: "services"; sha256: string; compose: unknown };
export type ServicesState = { kind: "ready"; env: Record<string, string> } | { kind: "confirm"; itemId: string };

type Running = { path: string; file: ComposeFile; env: Record<string, string>; stopped: boolean };

export const standardComposeFiles: readonly string[] = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

export class JobServices {
  private readonly jobs = new Map<string, Running>();

  constructor(
    private readonly db: ProjectDb,
    private readonly projectDir: string,
    private readonly configuredPath: () => string | null,
    private readonly runtime: () => Settings["servicesRuntime"],
  ) {}

  private controller(): ServicesRuntimeController {
    return new ServicesRuntimeController(this.runtime());
  }

  private async composePath(base: string): Promise<string | null> {
    const path: string | null = this.configuredPath();
    if (path !== null) return path;
    if (this.runtime() === null) return null;
    for (const name of standardComposeFiles) {
      if ((await gitAppResult(join(this.projectDir, "repo.git"), ["cat-file", "-e", `${base}:${name}`])).code === 0) return name;
    }
    return null;
  }

  private confirm(jobId: string, file: ComposeFile, composePath: string): string | null {
    const path = `services/${composePath}`;
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
    const running = this.jobs.get(jobId);
    if (running && !running.stopped) return { kind: "ready", env: running.env };
    const path: string | null = running?.path ?? (await this.composePath(base));
    if (path === null) return { kind: "ready", env: {} };
    const file = running?.file ?? (await readComposeFile(join(this.projectDir, "repo.git"), base, path, this.runtime()));
    const itemId = this.confirm(jobId, file, path);
    if (itemId !== null) return { kind: "confirm", itemId };
    onStarting();
    if (running) await this.controller().start(jobId, file);
    else await this.controller().up(jobId, file);
    const env = await this.controller().readPorts(jobId, file);
    this.jobs.set(jobId, { path, file, env, stopped: false });
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
    if (!this.jobs.has(jobId) && this.configuredPath() === null && this.runtime() === null) return;
    this.jobs.delete(jobId);
    await this.controller().sweep((id) => id === jobId);
  }
}

export function recordServicesConfirmation(db: ProjectDb, subject: ServicesSubject): void {
  db.append([{ jobId: null, type: "confirmation.recorded", payload: { path: subject.path, sha256: subject.sha256 } }]);
}
