# Stage 7: Critic Review Report

*   **Target:** `docs/design.md`, FeatureRange lines 1-611.
*   **Reviewers:** egm-design (feature-spec-standard), egm-structural (feature-spec-standard), egm-style. All three completed.
*   **Totals after deduplication:** 3 Blockers, 19 Majors, Nits listed at the end.

## Blockers

| Id | Reviewer | Finding | Proposed fix |
|---|---|---|---|
| design-1-B1 | design | The engine, as the app user, copies files into `.pecore/`, reads `outputRules.file` and deletes `scratchPaths` inside the agent's workdir. A symlink such as `out.json -> ~/.config/gh/hosts.yml` leaks forge tokens into artifacts; a symlinked `.pecore/inputs` lets the engine overwrite app-user files. | Every file read, write or delete under `work/` runs as the project user through a helper started with `sudo -u` that streams bytes; test with planted symlinks. |
| design-1-B2 | design | Recipe `params` overrides change the arguments of confirmed `runsAs: engine` nodes without a new confirmation. The orchestrator (reading untrusted tickets) can rewrite recipes with `write_instance`, removing `human` or `requires`. | Hash resolved params into the confirmation, or forbid param overrides on engine nodes; recipe changes by the orchestrator that touch engine or human nodes need user confirmation. |
| structural-1-B1 + design-1-M11 | structural, design | No Risks & Limits section; no scalability limits (disk per worktree, parallel jobs per machine, polling, db and log growth). | Add `## Risks & Limits` with a table (risk, category, impact, mitigation, section) and supported scale. |

## Majors

| Id | Reviewer | Finding | Proposed fix |
|---|---|---|---|
| design-1-M1 | design | Jobs in one project share the OS user and `repo.git`; an agent in job A can change job B's worktree or refs between check and push. | Recompute content state before `requires` and commit; commit checks tree equals approved state; push the exact SHA from the `commit` artifact. |
| design-1-M2 | design | Ignored files (`node_modules/`, caches, `.env`) are outside the content state, so checks can pass on a tampered workdir. | State the limit; run final checks on a clean checkout of the commit, or hash declared ignored paths. |
| design-1-M3 | design | `sudo` resets the environment (`PECORE_*` lost), the app user cannot signal project-user processes, daemonized children escape, a crashed app leaves orphans. | Specify the sudoers rule (`env` allowlist, `-H`); kill with `sudo -u <user> kill -- -<pgid>`; sweep leftover processes at start. |
| design-1-M4 | design | Harnesses keep one login per home dir: two accounts of one harness under one OS user cannot coexist; nothing checks the logged-in identity; macOS Keychain under `sudo -u` unverified. | Per-account config dir from the manifest (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`); identity check after login; macOS spike in Open Questions. |
| design-1-M5 | design | No manifest rule classifies quota, rate limit and auth errors or reads reset times; G7 depends on it. | Error-classification rules in the manifest; test per built-in manifest. |
| design-1-M6 | design | Push probe after rebase. | Already fixed in the `git-push` template (DetailedRange); restate the rule in 3.2. |
| design-1-M7 | design | Interruption during rebase, stash or commit leaves git state inconsistent. | Record HEAD and branch SHA per node run; on interruption abort rebase, reset branch, handle stash, then restore content state. |
| design-1-M8 | design | Parent lifecycle: child waits forever if parent fails or stops; deleting a parent closes branches children target; archived parents and merge polling unspecified; CUJ 2 says "ends". | Define propagation; forbid deleting a parent with live children; specify polling for archived jobs; fix CUJ 2. |
| design-1-M9 | design | Every parent change re-runs reviews and human approvals on all descendants. | Debounce base changes; let recipes skip review and human nodes after a clean rebase with an unchanged own diff; cost in Risks. |
| design-1-M10 | design | Service containers survive app close; `down -v` on pause wipes volumes. | Stop `pecore-*` compose projects on `before-quit`; document data loss on pause. |
| design-1-M12 | design | `PROBE_ERROR` after a short forge outage and `AUTH_ERROR` end long jobs; no resume from the failed node. | Make them waiting reasons (`network`, `auth`); add "resume from failed node". |
| design-1-M13 | design | Export with history can contain tokens printed in logs; imported project-user nodes and prompts run unconfirmed; intake trusts anyone who can set the label. | Exclude logs by default or scan; review all imported nodes; author allowlist for automatic intake. |
| structural-1-M1 | structural | Some alternatives give no concrete reason (reduced v1, Windows, JSONC, workdirs as nodes). | Add the cost each one avoids. |
| structural-1-M2 + style-1-N1 | structural, style | D-, B-, M- ids and v0.5 Q-numbers are not defined or linked. | Link the files; one line explaining the ids; a short decisions table. |
| structural-1-M3 + style-1-N2 | structural, style | Changes to brief decisions sit in one long header bullet. | Move them to a `Changes from the Concepts Brief` table. |
| style-1-M1 + design-1-N10 | style, design | Absolute claims contradicted elsewhere: "closing the app stops everything", "no terminal", "everything on the user's machine", "kill at once", "nothing leaves the machine". | Rewrite with the exact scope (prerequisites, SIGTERM then SIGKILL, model calls and deliveries leave the machine). |
| style-1-M2 | style | "Any toolchain/forge is supported" stated as present. | "Supported by adding nodes". |
| style-1-M3 | style | G12 "no job is lost" is not measurable. | Rewrite G12 with the measurable rule. |
| style-1-M4 + design-1-N13 | style, design | Competitor claims stated as fact though not re-checked; OpenHands supports many providers. | Qualify as reported; fix OpenHands. |
| style-1-M5 | style | "workdir/worktree/work tree", "base" (commit vs branch), "app user/engine", "forge", "harness" used loosely or undefined. | Define once; "base commit" vs "base branch". |
| style-1-M6 | style | "Atomic projects" clashes with transactional atomic. | "Self-contained projects". |
| style-1-M7 + structural-1-N9 | style, structural | CUJ 2 repo creation in Then contradicts Given; CUJ 4 says `commit` instead of `git-commit`. | Move repo creation into Given; use `git-commit`. |

## Nits

*   **design:**
    *   no arrows into `stopped` from `queued`, `paused` or `waiting`;
    *   whether a waiting job keeps its pool unit;
    *   a base change during a pending human review;
    *   `--jq '.[0].url // empty'`;
    *   `cleanup` failure semantics;
    *   `pecore://` `$schema` does not resolve in editors;
    *   "a node before it" in a cyclic graph;
    *   budget unit per account type;
    *   app-user projects lose all section 8 guarantees;
    *   "Gemini CLI" vs Antigravity, `agy -p` and `pi -p` unverified.
*   **structural:**
    *   rename "The Problem" and "Technical Plan (Architecture)";
    *   Open Questions placement and owners;
    *   inconsistent separators;
    *   four cross-reference styles;
    *   mixed status words in Alternatives;
    *   split a two-item Non-Goal;
    *   tables for per-kind fields;
    *   split 3.2 rules from example notes;
    *   repeated one-workdir rule.
*   **style:**
    *   awkward clause in the Overview;
    *   "typed" reason undefined;
    *   subjective wording ("readable message", "long work", "large amount of work", "most complex");
    *   anthropomorphic verbs;
    *   "Auto-merge returns";
    *   repeated parallel rule;
    *   trailing condition in section 8;
    *   "can never become shell code" needs quoted variables;
    *   long semicolon chains in CUJ 1 and G17;
    *   "all three files" ambiguous;
    *   "night mode".
