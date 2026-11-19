import { z } from "zod";
import { ProjectId } from "@pecore/schemas";
import type { ProjectDb } from "../store/project-db";

export const Manifest = z.object({
  format: z.literal(1),
  projectId: ProjectId,
  exportedAt: z.iso.datetime(),
  history: z.boolean(),
  logs: z.boolean(),
}).strict().refine((manifest) => !manifest.logs || manifest.history, "logs require history");
export type Manifest = z.infer<typeof Manifest>;

export class ShareConflict extends Error {}

export class InvalidArchive extends Error {}

export const definitionDirs: readonly string[] = ["nodes", "recipes", "knowledge"];

export function activeJobCount(db: ProjectDb["db"]): number {
  const row: { count: number } = db.prepare("SELECT count(*) AS count FROM jobs WHERE state IN ('queued', 'running', 'waiting', 'paused')").get() as { count: number };
  return row.count;
}

export function archivePath(path: string): string | null {
  const name: string = path.replace(/^(\.\/)+/, "").replace(/\/$/, "");
  if (/[\\\0]/.test(name) || name.split("/").some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")) return null;
  return name;
}
