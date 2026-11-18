# Stage 5: Zoom Out Report

*   **Target:** `docs/design.md` (lines 1-806). FeatureRange 1-580, DetailedRange 581-806.
*   **Reviewer:** egm-zoom-out, with `zoom-out-standard.md`. Decisions D1-D27 in `concepts_brief.md` were read so that author choices are not flagged.
*   **Verdict:** Needs revision. 1 Blocker, 6 Major, 5 Nit.
*   **Context sufficiency:** passes.

## Blocker

### B1. The app user runs git inside workdirs the agent controls

*   **Where:** 4.5 (`safe.directory`), 4.4 content state, section 8, `src/workdir/content-state.ts`.
*   **Problem:** the agent owns the worktree's `.git` file and can write `repo.git/worktrees/<id>/commondir`, because `worktrees/` is group-writable. Either one can point git at a gitdir with a `config` the agent controls. When the engine computes the content state as the app user with `safe.directory=<workdir>`, git loads that config, and a key such as `core.fsmonitor` runs code as the app user. `core.hooksPath=/dev/null` does not cover this.
*   **Fix:** run every git command that touches a workdir as the project OS user, reads included. The app user uses the returned tree hash only against `repo.git` with `--git-dir`, never with a work tree under `work/`. Remove the `safe.directory` exception and state the rule in section 8.

## Major

### M1. Source adapters are forge code inside the engine

*   **Where:** section 7; `src/sources/*.ts`.
*   **Problem:** GitHub, GitLab and Jira ticket reading is TypeScript in the engine, against G3 and D13. A new tracker (Bitbucket, Linear) would need engine code.
*   **Fix:** define a source as data, like a command node, with four command templates (list, read, comment, replies), and ship `github-issues.json` and others as library data. Or state the exception in Goals and Alternatives.

### M2. `safeStorage` and `run/credentials.json` serve speculative credentials

*   **Where:** 3.4; Fixed choices; `src/main/safe-storage.ts`; `src/sources/jira.ts`; Stack.
*   **Problem:** the only examples are a GitHub App key (unused in the design) and a Jira token. The cost is a decrypt service in the main process, a message protocol, a file and a Linux warning path. The Atlassian MCP server or `acli` keep their own Jira login, matching D27.
*   **Fix:** drop `safeStorage` and `credentials.json`; reach Jira through a tool that keeps its own login.

### M3. Agent-node `services` is specified but never designed

*   **Where:** 3.1 (`services`, for example `jira.read`).
*   **Problem:** it implies a tool proxy per agent run, with credentials and authorisation. No section designs it and no file implements it.
*   **Fix:** remove the field; the ticket reaches agents as an artifact and write-back is a node.

### M4. Subtasks repeat stacked jobs inside a job

*   **Where:** 3.2 (`perSubtask`, `subtask-merge`), 4.5, `src/workdir/subtasks.ts`.
*   **Problem:** stacked jobs already split work. Subtasks add per-subtask branches and worktrees, same-subtask edges, implicit joins, a back edge that switches workdir, merge conflict routing and subtask ids. No goal requires parallelism inside one job; it is the most complex part of the graph rules.
*   **Fix:** remove `perSubtask` and `subtask-merge`; use stacked or sibling jobs. Keep the `work/<job-id>/` layout.

### M5. `telemetry.db`, spans and `TRACEPARENT` have no consumer

*   **Where:** sections 2, 5, 9; Alternatives; `telemetry-db.ts`, `spans.ts`.
*   **Problem:** G13 is met by `pecore.db` (`node_runs`, `attempts` with log path) and raw logs. A second database and trace propagation have no goal behind them.
*   **Fix:** drop them; add `log_path` to `attempts`. Revisit with a real consumer such as an OTLP exporter.

### M6. Delivery logic as one-line shell strings in JSON

*   **Where:** 3.1 `github-pr` example.
*   **Problem:** the main example is an escaped `if/else` shell program in one JSON string. This hurts review, the `runsAs: engine` confirmation and AI editing.
*   **Fix:** let `command` run a script stored next to the node (`nodes/<instance>.sh`), as prompts use `.md`. Include the script in the confirmation hash.

### M7. A completed job re-enters `running` without a workdir

*   **Where:** 4.1, 4.5, G4, 3.2 `git-rebase`.
*   **Problem:** completion removes worktrees, but a base change sends a completed job back to `running` and runs `git-rebase` in the workdir. Nothing recreates it.
*   **Fix:** in 4.5: re-entering a job whose worktree was removed recreates it from `factory/<job-id>` (`src/workdir/worktrees.ts`).

## Nit

*   **N1.** `approver` and `risk` exist for the deferred auto-merge (D2). Consider removing `approver` from `feature.json` and keeping only the template.
*   **N2.** `optional` nodes chosen by `spec` are a second routing channel next to outcomes. Consider dropping `optional`.
*   **N3.** Section 5 cites "levels L0 to L2 of v0.5 §10", a document this design replaces. Define them inline or drop the reference.
*   **N4.** Notification sounds and night mode are UI detail. Auto-update with dmg on macOS needs Developer ID signing and notarisation, not mentioned.
*   **N5.** "Path can be moved in settings" conflicts with `PECORE_HOME` being the git repo that tracks each project's definitions.

## Altitude

FeatureRange altitude is suitable, except the shell-heavy example (M6) and the `rebase --onto` mechanics in 3.2, which belong in the `git-rebase` template docs. The git hardening in section 8 is justified by security. The DetailedRange file plan fits its range.
