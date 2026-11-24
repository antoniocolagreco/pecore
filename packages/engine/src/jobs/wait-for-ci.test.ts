import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { loadNodeFile } from "../definitions/load";

const exec = promisify(execFile);
const nodeDir: string = join(shippedTemplates, "nodes");
const commit: string = "a".repeat(40);

async function runCi(forge: "github" | "gitlab", cli: string) {
  const dir: string = await tempDir();
  const url: string = forge === "github" ? "https://github.com/team/app/pull/3" : "https://gitlab.com/team/app/-/merge_requests/3";
  const env: NodeJS.ProcessEnv = {
    PATH: `${dir}:${process.env.PATH}`,
    GH_HOST: forge === "github" ? "github.com" : undefined,
    GITLAB_HOST: forge === "gitlab" ? "gitlab.com" : undefined,
    PECORE_PROJECT_REPO_OWNER: "team",
    PECORE_PROJECT_REPO_NAME: "app",
    PECORE_PROJECT_REPO_URL: `https://${forge}.com/team/app.git`,
    PECORE_JOB_COMMIT: commit,
    PECORE_INPUTS_REFERENCE_PATH: join(dir, "reference.json"),
    COMMIT: commit,
  };
  await Promise.all([
    writeFile(env.PECORE_INPUTS_REFERENCE_PATH!, JSON.stringify({ url })),
    writeFile(join(dir, forge === "github" ? "gh" : "glab"), `#!/bin/sh\n${cli}\n`, { mode: 0o700 }),
    writeFile(join(dir, "time"), "0"),
    writeFile(join(dir, "date"), "#!/bin/sh\ncat time\n", { mode: 0o700 }),
    writeFile(join(dir, "sleep"), "#!/bin/sh\n[ \"$1\" = 30 ] || exit 2\nprintf '%s' \"$(($(cat time) + $1))\" > time\n", { mode: 0o700 }),
  ]);
  const result = await exec("/bin/sh", [join(nodeDir, "wait-for-ci.sh")], { cwd: dir, env, timeout: 5_000 }).then(
    ({ stdout }) => ({ code: 0, log: stdout }),
    (error: { code: unknown; stderr: string }) => ({ code: error.code, log: error.stderr }),
  );
  return { ...result, elapsed: Number(await readFile(join(dir, "time"), "utf8")) };
}

describe("Wait for CI command", () => {
  it("loads as a Command with two recipe outcomes", async () => {
    const loaded = await loadNodeFile(join(nodeDir, "wait-for-ci.json"));
    expect(loaded.errors).toEqual([]);
    expect(loaded.value).toMatchObject({ kind: "command", outcomes: ["success", "failure"], failOutcomes: ["failure"] });
  });

  it("polls pending GitHub checks until they pass", async () => {
    const result = await runCi("github", `
if [ "$2" = view ]; then printf '%s\\n' "$COMMIT"; exit 0; fi
if [ "$(cat time)" = 0 ]; then echo '[{"bucket":"pending"}]'; exit 8; fi
echo '[{"bucket":"pass"}]'`);
    expect(result).toEqual({ code: 0, log: `CI passed for ${commit}\n`, elapsed: 30 });
  });

  it("routes canceled GitHub checks to failure", async () => {
    const result = await runCi("github", `
if [ "$2" = view ]; then printf '%s\\n' "$COMMIT"; exit 0; fi
echo '[{"bucket":"cancel"}]'
exit 1`);
    expect(result).toMatchObject({ code: 1, elapsed: 0 });
  });

  it("ignores a stale GitLab pipeline and reports failure for the current commit", async () => {
    const result = await runCi("gitlab", `
if [ "$(cat time)" = 0 ]; then
  printf '{"sha":"%s","head_pipeline":{"sha":"old","status":"success"}}\\n' "$COMMIT"
else
  printf '{"sha":"%s","head_pipeline":{"sha":"%s","status":"failed"}}\\n' "$COMMIT" "$COMMIT"
fi`);
    expect(result).toEqual({ code: 1, log: `CI failed for ${commit}\n`, elapsed: 30 });
  });

  it("routes missing GitLab pipelines to failure after the deadline", async () => {
    const result = await runCi("gitlab", `printf '{"sha":"%s","head_pipeline":null}\\n' "$COMMIT"`);
    expect(result).toEqual({ code: 1, log: `CI did not finish within 30 minutes for ${commit}\n`, elapsed: 1800 });
  });
});
