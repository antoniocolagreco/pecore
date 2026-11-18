import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { HomeLockedError, takeLock } from "./lock";

describe("home lock", () => {
  it("takes a free lock and releases it", async () => {
    const path = join(await tempDir(), "lock");
    const release = await takeLock(path);
    expect(await readFile(path, "utf8")).toBe(String(process.pid));
    await release();
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("refuses a lock held by a running process", async () => {
    const path = join(await tempDir(), "lock");
    await writeFile(path, "1");
    await expect(takeLock(path)).rejects.toBeInstanceOf(HomeLockedError);
  });

  it("takes over a lock whose process is not running", async () => {
    const path = join(await tempDir(), "lock");
    await writeFile(path, "999999999");
    await takeLock(path);
    expect(await readFile(path, "utf8")).toBe(String(process.pid));
  });
});
