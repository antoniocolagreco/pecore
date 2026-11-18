import { readFile, rm, writeFile } from "node:fs/promises";

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class HomeLockedError extends Error {
  constructor(readonly pid: number) {
    super(`PECORE_HOME is in use by process ${pid}`);
  }
}

export async function takeLock(path: string, pid = process.pid): Promise<() => Promise<void>> {
  for (let i = 0; i < 2; i++) {
    try {
      await writeFile(path, String(pid), { flag: "wx", mode: 0o600 });
      return async () => {
        const owner = Number(await readFile(path, "utf8").catch(() => ""));
        if (owner === pid) await rm(path, { force: true });
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const owner = Number((await readFile(path, "utf8").catch(() => "")).trim());
      if (Number.isInteger(owner) && owner > 0 && owner !== pid && running(owner)) throw new HomeLockedError(owner);
      await rm(path, { force: true });
    }
  }
  throw new Error(`cannot take lock ${path}`);
}
