import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Global } from "../../definitions/load";
import { homePaths } from "../../home/layout";
import type { Engine } from "../../main";
import { HttpError } from "../server";
import type { Handlers } from "../server";

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function globalFileHandlers(engine: Engine) {
  const paths = homePaths(resolve(engine.opts.home));

  function get<K extends keyof Global>(kind: K): Promise<{ value: Global[K]; sha256: string }> {
    return engine.withGlobalFiles(async () => {
      const bytes: Buffer | null = await readBytes(paths[kind]);
      return { value: engine.global()[kind], sha256: sha256(bytes ?? "") };
    });
  }

  function put(kind: keyof Global, value: Global[keyof Global], baseSha256: string): Promise<{ sha256: string }> {
    return engine.withGlobalFiles(async () => {
      const file: string = paths[kind];
      const before: Buffer | null = await readBytes(file);
      if (sha256(before ?? "") !== baseSha256) throw new HttpError("conflict", "the file changed since it was loaded");
      if (kind === "settings" && "protectedMode" in value && value.protectedMode !== engine.global().settings.protectedMode) {
        throw new HttpError("bad_request", "protected mode changes only through POST /protected-mode");
      }
      const content: string = JSON.stringify(value, null, 2) + "\n";
      await writeFile(file, content);
      const errors = await engine.reloadGlobal();
      if (errors.length) {
        if (before === null) await rm(file);
        else await writeFile(file, before);
        await engine.reloadGlobal();
        throw new HttpError("bad_request", errors.map((error) => error.message).join("\n"));
      }
      const name: string = `${kind}.json`;
      const hash: string = sha256(content);
      engine.definitionChanged(name, hash);
      return { sha256: hash };
    });
  }

  return {
    getSettings: () => get("settings"),
    putSettings: ({ body }) => put("settings", body.value, body.baseSha256),
    getAccounts: () => get("accounts"),
    putAccounts: ({ body }) => put("accounts", body.value, body.baseSha256),
    getProfiles: () => get("profiles"),
    putProfiles: ({ body }) => put("profiles", body.value, body.baseSha256),
    getTiers: () => get("tiers"),
    putTiers: ({ body }) => put("tiers", body.value, body.baseSha256),
  } satisfies Partial<Handlers>;
}
