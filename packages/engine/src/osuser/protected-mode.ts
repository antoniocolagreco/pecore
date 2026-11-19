import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { protectedUser } from "../accounts/agents";
import { appUser } from "../runners/process";
import { createProtectedUserScript, projectAccessScript, removeProtectedUserScript } from "./script";

const execFileP = promisify(execFile);

export async function protectedUserExists(): Promise<boolean> {
  return execFileP("getent", ["passwd", protectedUser]).then(
    () => true,
    () => false,
  );
}

export function protectedModeScript(on: boolean, projectDirs: string[], opts: { createUser: boolean; removeUser: boolean }): string {
  const parts: string[] = [];
  if (on && opts.createUser) parts.push(createProtectedUserScript(appUser));
  for (const dir of projectDirs) parts.push(projectAccessScript(dir, appUser, on));
  if (!on && opts.removeUser) parts.push(removeProtectedUserScript());
  return parts.join("\n");
}
