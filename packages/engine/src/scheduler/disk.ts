import { statfs } from "node:fs/promises";

export async function freeDiskGb(path: string): Promise<number> {
  const s = await statfs(path);
  return (s.bavail * s.bsize) / 1024 ** 3;
}

export async function enoughDisk(path: string, minFreeGb: number): Promise<boolean> {
  return (await freeDiskGb(path)) >= minFreeGb;
}
