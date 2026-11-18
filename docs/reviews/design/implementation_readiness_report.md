# Stage 9: Implementation Readiness Report

*   **Target:** `docs/design.md`, DetailedRange lines 714-936; lines 1-713 as specification.
*   **Reviewers:** egm-implementation-readiness and egm-codebase-details (implementation-readiness-standard), egm-style. All three completed.
*   **Verdict:** not ready. The file map is broad, but core contracts are left to the implementer, and several commands do not work as written.

## Blockers

| Id | Reviewer | Finding | Fix |
|---|---|---|---|
| ir-B1 | readiness | Event types and DB schema not defined (`events.ts` ends with "...", tables have no columns) | Add a Data model subsection: every event with payload and the view rows it changes; DDL per table |
| ir-B2 | readiness | Harness manifest format not specified (event mapping syntax, error rule patterns, reset time format, command placeholders, token extraction) | Full manifest schema, normalised event list, one complete Claude Code manifest |
| ir-B3 + cd-B1 | readiness, codebase | The compose file comes from the agent-editable repo and runs as the app user: a bind mount of the app user's home, `privileged` or `build:` reaches forge logins | Read it from the base commit with `git show`, confirm its hash in the confirmation queue, run with `-f <copy>` and an empty project dir, reject host bind mounts, `privileged`, `build:`, host network or pid |

## Major

| Id | Reviewer | Finding | Fix |
|---|---|---|---|
| ir-M1 | readiness | Local API, WebSocket and MCP contract undefined; port, token creator, MCP transport | API table, WS message union, `run/api.json` with port and token, MCP transport and auth |
| ir-M2 | readiness | No file creates jobs | `src/jobs/create.ts` |
| ir-M3 | readiness | No file owns project creation; running `createRepo` outside a job undefined | `src/projects/create.ts` with ordered steps and rollback |
| ir-M4 | readiness | Spec items with no file: `skipWhenUnchanged`, `diff` artifact, agent `resume`, runtime schema writing, first-run copy of library, manifest location in `PECORE_HOME`, `git init` of `PECORE_HOME`, prerequisite checks, home check at start, round limit and budget answers | Add owners |
| ir-M5 | readiness | Recipe instantiation: cascade to node templates, name conflicts, default project contents | Specify in `instantiate.ts` |
| ir-M6 | readiness | Build order has backward dependencies and files in no phase | Every file gets a phase and a test gate |
| ir-M7 | readiness | Test plan misses goal verifications (G2, G3, G6, G9, G13) and security tests; no fake forge; fixture paths | Test table |
| ir-M8 + cd-M11 | both | Shutdown order and engine-to-main messages undefined; `before-quit` cannot await | `parentPort` protocol, `preventDefault` once, engine kills groups, then compose down, then `app.exit()` |
| ir-M9 | readiness | Libraries and formats not chosen (MCP, zstd, archive, gitleaks, WS plugin, ULID, updater feed, signing) | Fixed choices |
| ir-M10 | readiness | Shipped templates under-specified: no `{ticket.id}` for recipe nodes, GitLab commands, jira tool, markdown-folder comments, URL parsing, bundling of `library/` | Specify |
| ir-M11 | readiness | Orchestrator session lifecycle, attachments, MCP config per harness, `answer_question` | Specify; manifest field for MCP config |
| ir-M12 | readiness | Open questions block phases 3, 4, 6 | Spike task per question, fallback |
| cd-M1 | codebase | sudo 1.9.14+ uses a pty by default, so the recorded pgid is wrong | `Defaults>pecore-<p> !use_pty`; record the child's pgid |
| cd-M2 | codebase | `visudo -c` does not check a candidate file; mode, owner and file name rules missing | `visudo -c -f <tmp>`, `install -m 0440`, project id regex |
| cd-M3 | codebase | Group and user commands missing; new group membership not active in the running session; `sysadminctl` needs a password and creates a visible user | Exact commands per OS; never rely on the app's own new membership |
| cd-M4 | codebase | Read-only `repo.git/` breaks `packed-refs.lock` and `gc` | `gc.auto 0`, `maintenance.auto false`, branch deletion as app user |
| cd-M5 | codebase | Bare clone has no remote-tracking refs; plain `--force-with-lease` fails; git ignores `GH_TOKEN` | Explicit refspecs, `--force-with-lease=<ref>:<sha>`, credential helper per forge |
| cd-M6 | codebase | `git-push` probe reports `done` whenever the branch exists | Probe script comparing SHAs |
| cd-M7 | codebase | `mergedCheck` example reports every PR as merged | `select(.state=="MERGED")` |
| cd-M8 | codebase | `glab` keeps one token per host; no GitLab commands given | `GITLAB_TOKEN` per host, one account per host, named commands |
| cd-M9 | codebase | Apple `container` has no compose; Podman compose provider differs | Runtime-to-command map; drop Apple `container`; require Compose v2 |
| cd-M10 | codebase | Uppercase ULIDs invalid as compose names; `"5432"` binds 0.0.0.0; no wildcard down | Lowercase ids; require `127.0.0.1::port`; sweep with `compose ls` |
| cd-M12 | codebase | Vitest on system Node cannot load the Electron build of `better-sqlite3` | Run tests under Electron's Node; `node-linker=hoisted` |
| cd-M13 | codebase | Root cannot read the AppImage mount; temp scripts can be tampered | Pass the script text inline to `pkexec /bin/sh -c` and `osascript` |
| cd-M14 | codebase | Harnesses cannot edit files non-interactively without permission flags (`claude -p` permission mode, `codex exec --sandbox workspace-write`, `copilot --allow-all-tools`, opencode config) | Manifest field for permission args; **author decision** on the permission level |
| cd-M15 | codebase | `agy -p` (Antigravity non-interactive mode) could not be confirmed | Open question; fallback `gemini -p` |
| cd-M16 | codebase | macOS auto-update needs the `zip` target, signing and notarization | Add to release |
| style-M1..M6 | style | "readable message", "clear message", slots vs units, merge interval fixed vs setting, "the product is the sum", unclear "otherwise", "AI help" | Rewrites |

## Nits

*   **codebase:**
    *   stash with `--include-untracked`;
    *   empty commit in a bare repo through `commit-tree`;
    *   exact ACL syntax (macOS `search`);
    *   `sudo -n` on kill;
    *   gh version 2.40 or later;
    *   Vitest 4 `test.projects`;
    *   `--git-dir` for `worktree add`;
    *   `patch-id --stable`;
    *   zstd source;
    *   `parentPort`.
*   **readiness:**
    *   fake harness outside `src/`;
    *   CLI commands;
    *   stale lock;
    *   `settings.json` fields;
    *   artifact JSON shapes;
    *   `network` detection for commands;
    *   UI gate before phase 5;
    *   `docs/design.md` exists.
*   **style:**
    *   thresholds;
    *   overloaded cells;
    *   verbs;
    *   history scope in export;
    *   cross-reference style;
    *   column header;
    *   row grammar;
    *   jargon;
    *   test qualifier;
    *   grouping of source nodes.
