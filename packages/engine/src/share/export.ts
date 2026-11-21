import { createReadStream, createWriteStream, linkSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { create } from "tar";
import { createZstdCompress } from "node:zlib";
import { ExportProjectBody } from "@pecore/schemas";
import type { ExportProjectResult } from "@pecore/schemas";
import type { ProjectContext } from "../graph/executor";
import { activeJobCount, archivePath, definitionDirs, ShareConflict } from "./archive";
import type { Manifest } from "./archive";
import { scanSecrets } from "./secrets";

type Finding = Extract<ExportProjectResult, { state: "findings" }>["findings"][number];

function assertIdle(ctx: ProjectContext): void {
  const count: number = activeJobCount(ctx.db.db);
  if (count > 0) throw new ShareConflict(`${count} ${count === 1 ? "job is" : "jobs are"} active: stop or archive them first`);
}

async function copyEntry(from: string, to: string, name: string, directory: boolean): Promise<void> {
  const src: string = join(from, name);
  if (directory && !(await lstat(src).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  }))) {
    await mkdir(join(to, name));
    return;
  }
  await cp(src, join(to, name), {
    recursive: directory,
    filter: async (path) => {
      const stat = await lstat(path);
      const rel: string = relative(from, path);
      const file: boolean = stat.isFile() && stat.nlink === 1;
      const allowed: boolean = path === src ? (directory ? stat.isDirectory() : file) : stat.isDirectory() || file;
      if (!allowed || !archivePath(rel)) {
        throw new Error(`cannot export ${rel}: expected a regular file or directory`);
      }
      return true;
    },
  });
}

export async function exportProject(ctx: ProjectContext, input: ExportProjectBody): Promise<ExportProjectResult> {
  const { path, history, logs, acceptFindings }: ExportProjectBody = ExportProjectBody.parse(input);
  if (history) assertIdle(ctx);
  const dir: string = await mkdtemp(join(tmpdir(), "pecore-export-"));
  try {
    const dirs: string[] = [...definitionDirs, ...(history ? ["artifacts"] : []), ...(logs ? ["logs"] : [])];
    const db: string = join(dir, "pecore.db");
    const revision = (): number => ctx.db.db.prepare("SELECT total_changes() AS changes").pluck().get() as number;
    const before: number = history ? revision() : 0;
    await copyEntry(ctx.dir, dir, "project.json", false);
    for (const name of dirs) await copyEntry(ctx.dir, dir, name, true);
    if (history) {
      assertIdle(ctx);
      const findings: Finding[] = await scanSecrets(join(dir, "artifacts"));
      assertIdle(ctx);
      const accepted: Set<string> = new Set(acceptFindings);
      if (findings.some((finding) => !accepted.has(finding.fingerprint))) return { state: "findings", findings };
      if (before !== revision()) throw new ShareConflict("project history changed during export: retry the export");
      ctx.db.db.prepare("VACUUM INTO ?").run(db);
    }
    const manifest: Manifest = { format: 1, projectId: ctx.id, exportedAt: new Date().toISOString(), history, logs };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest) + "\n");
    const tar: string = join(dir, "project.tar");
    await create({ cwd: dir, file: tar, portable: true, strict: true }, ["manifest.json", "project.json", ...dirs, ...(history ? ["pecore.db"] : [])]);
    const output: string = await mkdtemp(join(dirname(resolve(path)), ".pecore-export-"));
    try {
      const archive: string = join(output, "project.tar.zst");
      await pipeline(createReadStream(tar), createZstdCompress(), createWriteStream(archive, { mode: 0o600 }));
      if (history) assertIdle(ctx);
      try {
        linkSync(archive, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ShareConflict(`file ${path} already exists`, { cause: error });
        throw error;
      }
    } finally {
      await rm(output, { recursive: true, force: true });
    }
    return { state: "written", path };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
