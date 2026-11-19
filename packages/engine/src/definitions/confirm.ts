import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import { Node } from "@pecore/schemas";
import type { Project } from "@pecore/schemas";
import type { ProjectDb } from "../store/project-db";

const ulid = monotonicFactory();

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function runFiles(node: Node): string[] {
  const out: string[] = [];
  if (node.kind === "command") {
    if (node.script) out.push(node.script);
    if (node.probe && !Array.isArray(node.probe)) out.push(node.probe.script);
    if (node.mergedCheck && !Array.isArray(node.mergedCheck)) out.push(node.mergedCheck.script);
  }
  if (node.kind === "source") for (const k of ["list", "read", "comment", "replies"] as const) if (node[k].script) out.push(node[k].script!);
  return [...new Set(out)].sort();
}

export type SourceScope = Pick<Project, "repo" | "baseBranch"> & { source: NonNullable<Project["source"]> };
export type ConfirmSubject = { path: string; kind: "engine-node" | "source-node"; definition: unknown; scripts: Record<string, string> };

export function subjectSha(s: { definition: unknown; scripts: Record<string, string> }): string {
  const h = createHash("sha256").update(canonical(s.definition));
  for (const name of Object.keys(s.scripts).sort()) h.update("\0").update(name).update("\0").update(s.scripts[name]!);
  return h.digest("hex");
}

export function needsConfirmation(node: Node): boolean {
  return node.kind === "source" || (node.kind === "command" && node.runsAs === "engine");
}

export async function readSubject(nodesDir: string, node: Node, scope?: SourceScope): Promise<ConfirmSubject> {
  const path = `nodes/${node.name}.json`;
  const definition = JSON.parse(await readFile(join(nodesDir, `${node.name}.json`), "utf8")) as unknown;
  const snapshot: Node = node.kind === "source" ? Node.parse(definition) : node;
  if (snapshot.kind !== node.kind || snapshot.name !== node.name) throw new Error(`node ${node.name} changed`);
  const scripts: Record<string, string> = {};
  for (const f of runFiles(snapshot)) scripts[f] = await readFile(join(nodesDir, f), "utf8");
  return { path, kind: node.kind === "source" ? "source-node" : "engine-node", definition: scope ? { node: definition, project: scope } : definition, scripts };
}

export type ConfirmState = { confirmed: true; scripts: Record<string, string>; definition: unknown } | { confirmed: false; itemId: string };

export async function ensureConfirmed(db: ProjectDb, jobId: string | null, nodesDir: string, node: Node, scope?: SourceScope): Promise<ConfirmState> {
  const subject = await readSubject(nodesDir, node, scope);
  const sha = subjectSha(subject);
  const row = db.db.prepare("SELECT sha256 FROM confirmed_hashes WHERE path = ?").get(subject.path) as { sha256: string } | undefined;
  if (row?.sha256 === sha) {
    const definition: unknown = scope ? (subject.definition as { node: unknown }).node : subject.definition;
    return { confirmed: true, scripts: subject.scripts, definition };
  }
  const open = db.db.prepare("SELECT id, subject_hash, subject FROM human_queue WHERE state = 'open' AND kind IN ('engine-node', 'source-node')").all() as { id: string; subject_hash: string; subject: string }[];
  const itemHash = createHash("sha256").update(JSON.stringify(subject)).digest("hex");
  for (const item of open) {
    const s = JSON.parse(item.subject) as ConfirmSubject;
    if (s.path !== subject.path) continue;
    if (item.subject_hash === itemHash) return { confirmed: false, itemId: item.id };
    db.append([{ jobId: null, type: "queue.resolved", payload: { itemId: item.id, state: "cancelled", choice: null, note: "the definition changed" } }]);
  }
  const itemId = ulid();
  db.append([{ jobId, type: "queue.added", payload: { itemId, kind: subject.kind, subject, subjectHash: itemHash, choices: ["confirm", "reject"] } }]);
  return { confirmed: false, itemId };
}

export function recordConfirmation(db: ProjectDb, subject: ConfirmSubject): void {
  db.append([{ jobId: null, type: "confirmation.recorded", payload: { path: subject.path, sha256: subjectSha(subject) } }]);
}
