import { execFile } from "node:child_process";
import { createReadStream, createWriteStream, linkSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { create } from "tar";
import { z } from "zod";
import { createZstdCompress } from "node:zlib";
import { ExportProjectBody } from "@pecore/schemas";
import type { ExportProjectResult } from "@pecore/schemas";
import type { ProjectContext } from "../graph/executor";
import { activeJobCount, archivePath, definitionDirs, ShareConflict } from "./archive";
import type { Manifest } from "./archive";

const execFileP = promisify(execFile);

const Report = z.array(z.object({ Fingerprint: z.string(), File: z.string(), StartLine: z.number().int(), RuleID: z.string() })).nullable();
type Finding = Extract<ExportProjectResult, { state: "findings" }>["findings"][number];

function assertIdle(ctx: ProjectContext): void {
  const count: number = activeJobCount(ctx.db.db);
  if (count > 0) throw new ShareConflict(`${count} ${count === 1 ? "job is" : "jobs are"} active: stop or archive them first`);
}

async function scan(dir: string): Promise<Finding[]> {
  const report: string = join(dir, "gitleaks.json");
  try {
    await execFileP("gitleaks", ["dir", "artifacts", "--no-banner", "--report-format", "json", "--report-path", report, "--exit-code", "0"], {
      cwd: dir,
      env: { ...process.env, GITLEAKS_CONFIG: "", GITLEAKS_CONFIG_TOML: "[extend]\nuseDefault = true\n" },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("gitleaks is not installed", { cause: error });
    throw new Error("gitleaks could not scan artifacts", { cause: error });
  }
  const contents: string = await readFile(report, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error("gitleaks returned an invalid report");
  }
  const parsed = Report.safeParse(data);
  if (!parsed.success) throw new Error("gitleaks returned an invalid report");
  return (parsed.data ?? []).map(({ Fingerprint, File, StartLine, RuleID }) => {
    const name: string = File.replace(/^\.\//, "");
    const file: string | null = archivePath(isAbsolute(name) ? relative(join(dir, "artifacts"), name).split(sep).join("/") : name.replace(/^artifacts\//, ""));
    if (file === null) throw new Error("gitleaks returned an invalid artifact path");
    return { fingerprint: Fingerprint, file, line: StartLine, rule: RuleID };
  });
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
      const findings: Finding[] = await scan(dir);
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
