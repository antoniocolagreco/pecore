# Stage 6: Comprehension Test Report

*   **Target:** `docs/design.md` (lines 1-813). FeatureRange 1-594, DetailedRange 595-813.
*   **Reviewer:** egm-comprehension, no document standard.

### What this proposes

PeCore is a single-user desktop app (Electron + React, Linux and macOS). It turns an order, given in chat or as a ticket, into one or more jobs. Each job runs a recipe on one git worktree. A recipe is a JSON graph of three kinds of node:

*   `agent` nodes run vendor CLI harnesses (`claude -p`, `codex exec`, ...) with the user's own subscriptions, as a per-project OS user.
*   `command` nodes do deterministic checks, plus commit, rebase, push and PR/MR delivery.
*   `human` nodes are approval points.

Language and forge support are both node definitions, so the engine has neither built in. Nodes and recipes are templates in a global library, copied without any link into a project.

The engine is a TypeScript child process. It schedules parallel jobs through in-memory limit pools, parks jobs in typed waiting states on quota, rate or budget limits instead of failing them, ties check results to a git tree hash of the workdir, writes events to one SQLite file per project, runs a probe before any external action so a crash cannot cause a double delivery, and supports stacked jobs that start from a parent job's last commit.

An LLM orchestrator works with the engine only through a restricted MCP server. It turns orders into jobs and writes templates. The Detailed Implementation lays out a pnpm monorepo with four packages (schemas, engine, app, cli), the shipped templates and harness manifests, and a six-phase build order.

### How the existing system works, per this document

No code exists yet; the repository holds only `docs/`. The design replaces an earlier v0.5 brainstorm, written in Italian, which had an always-on daemon, JSONC config, an encrypted secrets file, agents in containers behind a token proxy, and separate event and telemetry databases. A review brief changed those through decisions D1-D27. The design places PeCore against "cockpit" tools, where the user steers each agent, and single-vendor issue-to-PR services that run on the vendor's infrastructure.

## Findings

### Major

1.  **Unrouted failure outcomes end the job as `completed`** (4.2 "No edge", 4.1, 4.4 `stale`, `github-pr` example, G1). `github-pr: failed` and `commit: stale` have no edge, so a job can be "completed" without delivering. Fix: mark failure outcomes in `outcomes`, or require an edge for every outcome including `stale` and `skipped`; fix the example recipe.
2.  **No rule says which nodes are "external"** (4.8, G12, 3.1 `probe`). Fix: name the field or rule, and say whether the validator requires a `probe` on them.
3.  **The `git-push` probe blocks the push after a rebase** (3.2, `git-push` template, 4.8). If the probe only checks that the remote branch exists, rebased commits are never pushed. Fix: the probe compares the remote head with the local job head; the push uses `--force-with-lease`.
4.  **Agents cannot read their input artifacts** (sections 5 and 8, `{inputs.<type>.path}`). Artifacts are unreadable by the project user, and only the prompt and knowledge are copied to `.pecore/`. Fix: copy inputs to `.pecore/inputs/` and resolve the placeholder there for agent nodes.
5.  **What raises `job.base_changed` is not listed** (4.2, 4.6, G9). Fix: list the events, and say whether remote changes and merges on the forge are detected.
6.  **Ticket intake is not described** (section 7, `src/sources/poll.ts`, CUJ 1). Fix: add an intake subsection: poll interval, what the orchestrator does with a new ticket (start or ask), purpose of `replies`.
7.  **The orchestrator's OS user is not described** (section 6). Fix: say how it and its harness login are created at first run, and its sudo rule.
8.  **Job services lifecycle is incomplete** (G8, 3.5, G15, Fixed choices). Missing: start trigger, connection details for nodes, port isolation between jobs, which user runs the runtime; containers of failed or stopped jobs keep running until archive. Fix: add a lifecycle paragraph; stop services on every final state.
9.  **Repo creation: G8 says PeCore does it, the plan says a node does** (G8, section 2, CUJ 2). No shipped recipe contains a create-repo node. Fix: reword G8 and say which recipe or job includes the node.
10. **The knowledge base is never defined** (G8, CUJ 7, 3.1, section 2). Fix: define its content, who writes it, how agents get it.
11. **The design overrides decisions without saying so** (header, D18, D25, D27). Fix: mark each "(supersedes Dn: ...)" or update the brief.
12. **`pecore init` vs a CLI that needs the open app** (G14, `packages/cli`). Fix: say how `init` runs.

### Nit

13. The Problem attributes the issue-to-PR tools to Appendix A, which does not list them.
14. `stdoutLastLine` and `"project.account"` are used in the example but not defined in 3.1.
15. No node reads the `risk` artifact; say who consumes it.
16. `tests_disputed` and `spec:rejected` are never explained.
17. "Orchestrator" is used from the Overview but defined only in section 6.
18. Leftovers from subtasks: "at least one waits" in 4.1, plural "worktrees" in 4.5; `parent_job` is a node-run waiting reason but `queued` is a job state.
19. Alternatives says a new harness needs only a manifest; section 5 says some need a parser.
20. Not stated whether `sudo` is used when the project runs as the app user (also the only option before phase 4).
21. The node list of `library/recipes/bugfix.json` is undefined.
