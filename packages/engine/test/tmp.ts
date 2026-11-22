import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

const dirs: string[] = [];

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pecore-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export const shippedTemplates = fileURLToPath(new URL("../../app/resources/templates/", import.meta.url));
