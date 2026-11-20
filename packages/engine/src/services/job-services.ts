import { join } from "node:path";
import type { Settings } from "@pecore/schemas";
import { gitAppResult } from "../workdir/git-as";
import { readComposeFile } from "./compose-file";
import type { ComposeFile } from "./compose-file";
import { ServicesRuntimeController } from "./runtime";

type Running = { path: string; file: ComposeFile; env: Record<string, string>; stopped: boolean };

export const standardComposeFiles: readonly string[] = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

export class JobServices {
  private readonly jobs = new Map<string, Running>();

  constructor(
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

  async ensure(jobId: string, base: string, onStarting: () => void): Promise<Record<string, string>> {
    const running = this.jobs.get(jobId);
    if (running && !running.stopped) return running.env;
    const path: string | null = running?.path ?? (await this.composePath(base));
    if (path === null) return {};
    const file = running?.file ?? (await readComposeFile(join(this.projectDir, "repo.git"), base, path, this.runtime()));
    onStarting();
    if (running) await this.controller().start(jobId, file);
    else await this.controller().up(jobId, file);
    const env = await this.controller().readPorts(jobId, file);
    this.jobs.set(jobId, { path, file, env, stopped: false });
    return env;
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
