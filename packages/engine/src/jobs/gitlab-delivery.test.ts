import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ForgeAccount } from "@pecore/schemas";
import { expect, it } from "vitest";
import { apiProject } from "../../test/api-project";
import { tempDir } from "../../test/tmp";
import { loadNodeFile } from "../definitions/load";
import { outcomeOutputs, runCommandNode, runMergedCheck } from "../runners/command";
import type { CommandRun } from "../runners/command";
import { appUser } from "../runners/process";
import { repositoryDefinition } from "../runners/repository";

it("resolves Open PR for GitLab, skips an identical update and detects the merge", async () => {
  const dir: string = await tempDir();
  const url: string = "https://gitlab.example.com/team/app/-/merge_requests/3";
  const draft: { title: string; body: string } = { title: "Fix the validator", body: "Accept valid\\n and reject invalid." };
  const script: string = `#!/bin/sh
set -eu
case "$2" in
  list) if [ -f "$FORGE_FIXTURE" ]; then cat "$FORGE_FIXTURE"; else printf '[]'; fi ;;
  view) test "$3" = 3; printf '{"state":"merged"}' ;;
  create)
    shift 2
    while [ "$#" -gt 1 ]; do
      case "$1" in
        --title) title=$2; shift ;;
        --description) body=$2; shift ;;
      esac
      shift
    done
    jq -nc --arg title "$title" --arg description "$body" '[{iid:3,web_url:"${url}",title:$title,description:$description}]' > "$FORGE_FIXTURE"
    ;;
  *) exit 2 ;;
esac`;
  await writeFile(join(dir, "glab"), script, { mode: 0o700 });
  const { engine, close } = await apiProject();
  try {
    const { ctx } = engine.project("demo");
    const nodeDir: string = join(ctx.templates, "nodes");
    const { value: template } = await loadNodeFile(join(nodeDir, "open-pr.json"));
    if (template?.kind !== "repository") throw new Error("Expected Open PR");
    const account: ForgeAccount = { kind: "forge", id: "gitlab", forge: "gitlab", host: "gitlab.example.com", tool: "glab", user: "developer", author: { name: "Developer", email: "dev@example.com" } };
    const { definition, sidecars } = await repositoryDefinition(ctx, template, account);
    const run: CommandRun = {
      node: definition, outputs: outcomeOutputs(definition), inlineScript: definition.script, sidecars, nodeDir, remote: true,
      user: appUser, workdir: dir, params: {},
      context: {
        job: { id: "job", title: "Example", request: "Fix the validator", branch: "factory/job", base: "a".repeat(40), oldBase: "a".repeat(40), target: "main", commit: "b".repeat(40) },
        project: { repoDir: dir, repoUrl: "https://gitlab.example.com/team/app.git", baseBranch: "main" }, ticketId: null,
      },
      inputs: [{ type: "pull_request", content: JSON.stringify(draft) }],
      extraEnv: { PATH: `${dir}:${process.env.PATH}`, FORGE_FIXTURE: join(dir, "published") },
    };
    const outputs: CommandRun["inputs"] = [{ type: "pull_request", content: JSON.stringify({ ...draft, url }) }];
    await expect(runCommandNode(run)).resolves.toMatchObject({ outcome: "success", fromProbe: false, outputs });
    await expect(runCommandNode(run)).resolves.toMatchObject({ outcome: "success", fromProbe: true, outputs });
    await expect(runMergedCheck({ ...run, inputs: outputs })).resolves.toBe("done");
  } finally {
    await close();
  }
});
