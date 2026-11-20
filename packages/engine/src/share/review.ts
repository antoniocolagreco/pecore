import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ArchiveReview, ArchiveRisk } from "@pecore/schemas";
import type { Engine } from "../main";
import { ProjectDb } from "../store/project-db";
import { InvalidArchive } from "./archive";
import { migrateHistory } from "./history";
import { withProjectArchive } from "./import";
import { reviewWithModel } from "./review-model";
import type { ReviewInput } from "./review-model";

type FileReview = ArchiveReview["files"][number];
const maxArchiveBytes: number = 32 * 1024 * 1024;
const maxModelChars: number = 64 * 1024;
const rules: Record<ArchiveRisk, RegExp> = {
  prompt_injection: /\b(?:ignore|disregard|override|forget)\b[^\n]{0,80}\b(?:instructions?|system|developer)\b|\b(?:system|developer)\s*:\s*(?:you must|follow|execute)|<\|(?:im_start|system|assistant)\|>/i,
  credential_access: /\b(?:gh\s+auth\s+token|security\s+find-generic-password|printenv\b[^\n]{0,80}(?:TOKEN|KEY|SECRET)|\w*(?:API_KEY|ACCESS_TOKEN|PRIVATE_KEY))\b|(?:\.ssh\/|\.aws\/|\.netrc\b|credentials\.json)/i,
  network_access: /\b(?:curl|wget|scp|sftp|ssh|netcat)\s+|\bfetch\s*\(|\b(?:https?|ftp):\/\//i,
  shell_execution: /\b(?:bash|sh|zsh|powershell)\s+-c\b|\b(?:eval|exec)\s+|\b(?:child_process|subprocess)\b|\|\s*(?:bash|sh)\b/i,
  privileged_operation: /\b(?:sudo|setcap|chmod\s+[24][0-7]{3})\b|\bprivileged\s*:\s*true\b/i,
  destructive_operation: /\brm\s+-[a-z]*r[a-z]*\b|\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|\bDROP\s+(?:TABLE|DATABASE)\b/i,
};

function scanText(content: string): FileReview["findings"] {
  const findings: FileReview["findings"] = [];
  const remaining: Map<ArchiveRisk, RegExp> = new Map(Object.entries(rules) as [ArchiveRisk, RegExp][]);
  let line: number = 0;
  for (const [text] of content.matchAll(/[^\n]*(?:\n|$)/g)) {
    line++;
    if (text === "\n") continue;
    for (const [risk, pattern] of remaining) {
      if (!pattern.test(text)) continue;
      findings.push({ risk, line, source: "static" });
      remaining.delete(risk);
    }
    if (remaining.size === 0) break;
  }
  return findings;
}

function decode(bytes: Buffer): string | null {
  const encoding: string = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  try {
    const text: string = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

function historyText(path: string): string {
  migrateHistory(path);
  const project: ProjectDb = new ProjectDb(path);
  try {
    const lines: string[] = [];
    let size: number = 0;
    for (const table of ["jobs", "node_runs", "attempts", "events", "human_queue", "tickets_seen"]) {
      for (const row of project.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate()) {
        const line: string = JSON.stringify({ table, row });
        size += line.length + 1;
        if (size > maxArchiveBytes) throw new InvalidArchive("The project history exceeds the security review size limit");
        lines.push(line);
      }
    }
    return lines.join("\n");
  } finally {
    project.close();
  }
}

export async function analyzeProjectArchive(engine: Engine, path: string): Promise<ArchiveReview> {
  if (!isAbsolute(path) || !path.endsWith(".tar.zst")) throw new InvalidArchive("Choose a local PeCore .tar.zst archive");
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) throw new InvalidArchive("Choose a local PeCore .tar.zst archive");
  if (info.size > maxArchiveBytes) throw new InvalidArchive("The archive exceeds the security review size limit");
  return withProjectArchive(engine.opts.home, path, async (dir, manifest) => {
    const files: FileReview[] = [];
    const modelFiles: ReviewInput[] = [];
    let modelChars: number = 0;
    const entries = (await readdir(dir, { withFileTypes: true, recursive: true })).filter((entry) => entry.isFile());
    const paths: string[] = entries.map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();
    paths.sort((a, b) => Number(/^(?:logs|artifacts)\//.test(a)) - Number(/^(?:logs|artifacts)\//.test(b)));
    for (const path of paths) {
      const bytes: Buffer = await readFile(join(dir, path));
      const history: boolean = path === "pecore.db";
      const content: string | null = history ? historyText(join(dir, path)) : decode(bytes);
      const file: number = files.length;
      files.push({ path, bytes: bytes.length, content: content === null ? "binary" : history ? "history" : "text", modelReviewed: false, findings: content === null ? [] : scanText(content) });
      if (content !== null) {
        const input: ReviewInput = { file, path, text: content };
        const chars: number = JSON.stringify(input).length;
        if (modelChars + chars <= maxModelChars) {
          modelFiles.push(input);
          modelChars += chars;
        }
      }
    }
    const model = await reviewWithModel(engine, modelFiles);
    if (model.status !== "complete") return { projectId: manifest.projectId, model: model.status, files };
    for (const { file } of modelFiles) files[file]!.modelReviewed = true;
    for (const { file, risk, line } of model.findings) {
      const findings: FileReview["findings"] = files[file]!.findings;
      if (!findings.some((entry) => entry.risk === risk && entry.line === line)) findings.push({ risk, line, source: "model" });
    }
    return { projectId: manifest.projectId, model: files.every(({ content, modelReviewed }) => content === "binary" || modelReviewed) ? "complete" : "partial", files };
  }, { entries: 4096, bytes: maxArchiveBytes });
}
