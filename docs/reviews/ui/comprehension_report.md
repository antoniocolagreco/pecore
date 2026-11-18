# Stage 6: Comprehension Report

*   **Target:** `docs/ui-design.md`, whole file. Context: `docs/design.md`.
*   **Reviewer:** egm-comprehension, no document standard.
*   **Verdict:** 0 Blockers, 10 Majors, 10 Nits. Every screen can be paraphrased.

## What this proposes

PeCore's desktop UI: a left navigation (Factory, Orchestrator, Jobs, Inbox, Projects, Usage, Library, Settings) and a top bar (project filter, global pause/play, notifications, New job). Factory is the home dashboard: counters and compact rows for jobs not yet ended. Each job has a page with a header and controls, Graph and History tabs, a detail panel for the selected node and a result summary once the job ends. The Inbox puts every item that waits on the user in one list with a detail pane. Graph and form editors for recipes and nodes (templates and instances), a configuration-only project page, a New project wizard, a full-screen first run, Settings and Usage. An orchestrator chat has its own page and a collapsible mini chat that sends the open object as a reference chip. Job and node-run states map to fixed labels and colors. Everything shown comes from engine state, artifacts or definitions, never from an LLM (UI11). Themable dark-green look on CSS variables, Base UI, React Flow and CodeMirror.

## How the existing system works, per this document

An engine runs jobs along recipe graphs of nodes; outcomes are routed by edges. Jobs move through queued, running, waiting, paused and final states. Waits that need the user become items in a queue the UI calls the Inbox. `runsAs: engine` and `source` nodes and orchestrator recipe changes need confirmation. Projects own node and recipe instances copied from library templates. Closing the window keeps the app in the tray; Quit pauses jobs with reason `quit`, and the user plays them after a restart.

## Major

| # | Location | Problem | Fix |
|---|---|---|---|
| 1 | Inventory ids | G1-G7 clash with design.md goals G1-G17; D1-D8 with concepts brief decisions; B1-B5 with brief findings | Prefix inventory ids, or cite goals as "design.md G5" |
| 2 | A2, Inbox, UI13 | Inbox never defined as `human_queue`; D1-D8 not mapped to its `kind` values | One sentence plus a mapping table |
| 3 | UI15 vs design.md | "Play interrupted jobs" here, "Resume interrupted jobs" in design.md | Keep "Play", fix design.md |
| 4 | Recipe editor inspector | "Template of origin": instances keep no reference to templates | Remove the field |
| 5 | New project wizard | Step order differs from design.md "Project creation" (repo creation runs after OS user and directory); failure rolls back, not "stays open"; no id/name step; no harness login step; "starting recipes" undefined | Follow design.md's order; state when the project exists and what cancel and failure do; add id and login steps |
| 6 | Job states | D5 (compose confirmation) has no stated waiting reason; `auth` for a forge login cannot be fixed in the project's harness logins | State D5's reason and add it to Needs you; split `auth` by login type |
| 7 | Node run states | Outcomes not in `failOutcomes` are green, including `stale`, `human:reject`, `spec:rejected`, `review:changes`, `rebase:conflict` | `stale` red; color for unrouted non-success, non-failure outcomes |
| 8 | UI14, mini chat | Chip behavior on navigation and pinning unclear; which conversation is used | Example sequence and a rule |
| 9 | First run | Triggered by missing `PECORE_HOME`, which its own step 2 creates; quitting midway leaves a half-configured app | Trigger on a "first run completed" marker |
| 10 | C11, New job | No title field or rule | Add it, or state the rule |

## Nit

| # | Problem |
|---|---|
| 11 | UI1 missing from the Decisions table |
| 12 | Undefined terms: "EGM review", "Stage 5", "Factory" before its section, "the reference mock" in UI3, "home check", "engine node" |
| 13 | UI16 sentence on theme colors hard to parse; say themes may change status hues but not their meaning |
| 14 | `disk` listed as a queued reason; design.md 4.3 has it as a node-run waiting reason |
| 15 | "Merged" rarely appears; say so |
| 16 | Inbox: "hash" in D2 detail only; D4 and D6 have no job; D1 note depends on the node's `answer` field |
| 17 | Jobs page filter vs global project filter; Inbox filter |
| 18 | Recipe editor: no way to set `start`; where dragged nodes come from; what instantiating a recipe template does to its nodes |
| 19 | Node editor: confirmation for engine templates; saving invalid files; projects outside `PECORE_HOME` |
| 20 | Small ambiguities: "one graph view", "duration", History node labels, detail panel for a whole node, what each counter opens, notification list size, location of theme files |
