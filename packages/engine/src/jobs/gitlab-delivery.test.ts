import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { loadNodeFile } from "../definitions/load";

const exec = promisify(execFile);

it("passes the draft title and body to GitLab and reuses the existing request", async () => {
  const dir: string = await tempDir();
  const nodeDir: string = join(shippedTemplates, "nodes");
  const { value: node } = await loadNodeFile(join(nodeDir, "gitlab-mr.json"));
  if (node?.kind !== "repository") throw new Error("Expected GitLab MR");
  const url: string = "https://gitlab.example.com/team/app/-/merge_requests/3";
  const draft: { title: string; body: string } = { title: "Fix the validator", body: "Accept valid\\n and reject invalid." };
  const script: string = `#!/bin/sh
set -eu
case "$2" in
  list) if [ -f published ]; then cat published; else printf '[]'; fi ;;
  create)
    shift 2
    while [ "$#" -gt 1 ]; do
      case "$1" in
        --title) title=$2; shift ;;
        --description) body=$2; shift ;;
      esac
      shift
    done
    jq -nc --arg title "$title" --arg description "$body" '[{iid:3,web_url:"${url}",title:$title,description:$description}]' > published
    ;;
  *) exit 2 ;;
esac`;
  await writeFile(join(dir, "glab"), script, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}`, PECORE_PROJECT_REPO_URL: "https://gitlab.example.com/team/app.git", PECORE_JOB_BRANCH: "factory/job", PECORE_JOB_TARGET: "main" };
  const run = (body: string, name: string) => {
    const child = exec("/bin/sh", ["-c", body, name], { cwd: dir, env });
    child.child.stdin!.end(JSON.stringify({ pull_request: draft }));
    return child;
  };
  expect(JSON.parse((await run(node.script, node.name)).stdout)).toEqual({ ...draft, url });
  const probe: string = await readFile(join(nodeDir, "gitlab-mr.sh"), "utf8");
  expect(JSON.parse((await run(probe, "gitlab-mr-probe")).stdout)).toEqual({ ...draft, url });
});
