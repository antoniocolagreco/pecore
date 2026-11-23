import { readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { appUser, baseEnv } from "../runners/process";

export type HomeFinding = { path: string; mode: number; fix: string[] };

export async function checkHome(home?: string): Promise<HomeFinding[]> {
  if (process.platform === "darwin") throw new Error("not supported on macOS yet");
  const path = home ?? (await baseEnv(appUser)).HOME!;
  const config = (home === undefined ? process.env.XDG_CONFIG_HOME : undefined) || join(path, ".config");
  const gh = (home === undefined ? process.env.GH_CONFIG_DIR : undefined) || join(config, "gh");
  const glab = (home === undefined ? process.env.GLAB_CONFIG_DIR : undefined) || join(config, "glab-cli");
  const files = new Set([join(gh, "hosts.yml"), join(glab, "config.yml"), join(path, ".aws")]);
  for (const name of await readdir(path)) if (name.startsWith(".claude") && !name.endsWith(".lock")) files.add(join(path, name));
  if (home === undefined) {
    for (const key of ["AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "CLAUDE_CONFIG_DIR"]) {
      const override = process.env[key];
      if (override) files.add(override);
    }
  }
  const findings: HomeFinding[] = [];
  for (const file of [path, ...files]) {
    let info: Stats;
    try {
      info = await stat(file);
    } catch (error) {
      if (file !== path && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const mode = info.mode & 0o7777;
    const privateDirectory = file !== path && info.isDirectory();
    if ((mode & (privateDirectory ? 0o055 : 0o044)) !== 0) {
      findings.push({ path: file, mode, fix: ["chmod", privateDirectory ? "go-rwx" : "go-r", "--", file] });
    }
  }
  return findings;
}
