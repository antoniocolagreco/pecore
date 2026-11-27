import { createReadStream, createWriteStream, linkSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { create } from "tar";
import { createZstdCompress } from "node:zlib";
import { ExportProjectBody } from "@pecore/schemas";
import type { ExportProjectResult } from "@pecore/schemas";
import type { ProjectContext } from "../graph/executor";
import { nodeSidecars } from "../definitions/load";
import { activeJobCount, archivePath, definitionDirs, ShareConflict } from "./archive";
import type { Manifest } from "./archive";
import { historyArtifacts, historyEffects, historyLogs } from "./history";
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

async function copyTemplates(ctx: Pick<ProjectContext, "project" | "defs">, dir: string): Promise<void> {
  const nodes: Set<string> = new Set(ctx.project.recipes === undefined ? ctx.defs.nodes.keys() : []);
  for (const name of ctx.project.recipes ?? ctx.defs.recipes.keys()) {
    const recipe = ctx.defs.recipes.get(name);
    if (!recipe) throw new ShareConflict(`recipe template ${name} not found`);
    await writeFile(join(dir, "recipes", `${name}.json`), JSON.stringify(recipe, null, 2) + "\n");
    for (const { use } of Object.values(recipe.nodes)) nodes.add(use);
  }
  if (ctx.project.createRepo) nodes.add(ctx.project.createRepo);
  const bodies: Set<string> = new Set();
  for (const name of nodes) {
    const node = ctx.defs.nodes.get(name);
    if (!node) throw new ShareConflict(`node template ${name} not found`);
    await writeFile(join(dir, "nodes", `${name}.json`), JSON.stringify(node, null, 2) + "\n");
    for (const [, key] of nodeSidecars(node)) bodies.add(key);
  }
  for (const key of bodies) {
    const content: string | undefined = ctx.defs.sidecars?.[key];
    if (content === undefined) throw new ShareConflict(`node content ${key} not found`);
    await writeFile(join(dir, "nodes", key), content);
  }
}

export async function exportProject(ctx: ProjectContext, input: ExportProjectBody): Promise<ExportProjectResult> {
  const { path, history, logs, acceptFindings }: ExportProjectBody = ExportProjectBody.parse(input);
  const snapshot: Pick<ProjectContext, "project" | "defs"> = { project: ctx.project, defs: ctx.defs };
  if (history) assertIdle(ctx);
  const dir: string = await mkdtemp(join(tmpdir(), "pecore-export-"));
  try {
    const db: string = join(dir, "pecore.db");
    const revision = (): number => ctx.db.db.prepare("SELECT total_changes() AS changes").pluck().get() as number;
    const before: number = history ? revision() : 0;
    await writeFile(join(dir, "project.json"), JSON.stringify(snapshot.project, null, 2) + "\n");
    await copyEntry(ctx.dir, dir, "knowledge", true);
    for (const name of ["nodes", "recipes"]) await mkdir(join(dir, name));
    await copyTemplates(snapshot, dir);
    if (history) {
      assertIdle(ctx);
      const findings: Finding[] = scanSecrets(historyArtifacts(ctx.db.db));
      findings.push(...scanSecrets(historyEffects(ctx.db.db)));
      if (logs) findings.push(...scanSecrets(historyLogs(ctx.db.db)));
      const accepted: Set<string> = new Set(acceptFindings);
      if (findings.some((finding) => !accepted.has(finding.fingerprint))) return { state: "findings", findings };
      if (before !== revision()) throw new ShareConflict("project history changed during export: retry the export");
      ctx.db.db.prepare("VACUUM INTO ?").run(db);
      if (!logs) {
        const copy: Database.Database = new Database(db, { fileMustExist: true });
        try {
          copy.exec("DELETE FROM attempt_logs; UPDATE attempts SET log_omitted = 1; VACUUM");
        } finally {
          copy.close();
        }
      }
    }
    const manifest: Manifest = { format: 1, projectId: ctx.id, exportedAt: new Date().toISOString(), history, logs };
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest) + "\n");
    const tar: string = join(dir, "project.tar");
    await create({ cwd: dir, file: tar, portable: true, strict: true }, ["manifest.json", "project.json", ...definitionDirs, ...(history ? ["pecore.db"] : [])]);
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
