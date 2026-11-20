# PeCore UI

*   **Author:** Antonio Colagreco
*   **Status:** Approved (EGM stages 5-8 applied; stage 9 not applicable; reports in [reviews/ui/](reviews/ui/)). The `packages/app` table of design.md matches the Screens table below.
*   **Date:** 2026-11-18
*   **Related:** [design.md](design.md), [concepts-brief.md](concepts-brief.md)
*   **Decision history:** [decisions.md](decisions.md). This document always describes the current state; every decision there is applied here in the same change.

## Problem Statement

PeCore runs many jobs at once, each through a recipe graph of agents, checks, reviews and deliveries (design.md Overview). The user leaves it working and comes back. When they come back they need two answers at once: what is waiting for them, and what was delivered. Without a UI built for that, the user digs through logs and graphs to find the one review that blocks five jobs, and cannot tell a delivered PR from a rejected spec.

## Goals

*   **Attention first.** From any screen, the user sees how many items wait for them and reaches one in one click. Nothing that needs the user is hidden by a filter.
*   **Results are clear.** A finished job shows its outcome, what changed, which checks ran and where the delivery is, from recorded data only (UI11).
*   **Diagnosis in two clicks** (design.md G13): from Factory to the live log of a running node, and from a failed job to the failing node run.
*   **Everything in the GUI** (design.md G16): every function of design.md has a screen; no step needs a file editor.
*   **Safe confirmations** (design.md section 8): a confirmation always approves exactly what the user saw.
*   **Minimal** (decision 35): nothing on screen that the user does not need to act or decide.
*   **Small screens** (decision 33): everything works in a 1024×720 window.
*   **The user controls what leaves the app** (decision 39): outside a recipe, nothing is posted to an outside service without the user's approval or order.

## Non-Goals

*   Translation: the UI is in English only.
*   Invented figures: no progress percentages, no remaining subscription quota unless the connector reports it, no LLM-written summaries (UI6, UI11).
*   A graph of stacked jobs: stacks are a tree in the lists (UI9).
*   Project language detection: PeCore does not know a project's language.
*   Actions on the forge from delete: deleting a job or a project never touches the remote (design.md 4.8).

## Terms

*   **Factory:** the home screen, a summary dashboard.
*   **Notifications:** the screen that lists the items to decide (open `human_queue` rows, except `agent-question` items, answered in the chat) and the notification log (decision 45). Its counter counts the items to decide plus the notifications not seen yet. In design.md, the kinds `engine-node`, `source-node`, `recipe-change`, `import`, `ticket` and `services` are also called the confirmation queue.
*   **Engine:** the background process that runs jobs (design.md section 1). **Engine node:** a node with `runsAs: engine`. **Engine state:** a job or node run state of design.md 4.1 and 4.3.
*   **Normal mode and protected mode:** design.md's project user (section 8). In normal mode, the default, agents and the orchestrator run as the user, with the user's own harness logins, like Claude Code or Codex run by hand. In protected mode they run as `pecore-agent`, which cannot read the user's files and logins; it needs one login per harness account. The mode is global, not per project.
*   **Check node:** a recipe node named in some node's `requires` (design.md 4.4).
*   **Back edge:** an edge to a node that already ran in the job, for example `review` to `code`.
*   **Home check:** the start-up check of `PECORE_HOME` permissions (design.md section 8).
*   **Prototype:** [pecore_concept_offline.html](pecore_concept_offline.html).
*   **Citations:** inventory ids start with `I` (`IA1`, `ID3`). The Source column cites design.md as a section number (4.3), a goal (G17), a CUJ (CUJ 6) or a heading in quotes ("Project creation").

## Method

1.  List every element the user must see or use, taken from design.md.
2.  The author approves, removes or adds elements.
3.  Group the elements by how often they are used and which ones are used together.
4.  Only then decide the layout.

## Inventory

### A. Global

| Id | Element | Source |
|---|---|---|
| IA1 | Global pause and play | G17 |
| IA2 | Notifications counter | 4.3, 8 |
| IA3 | Notifications: job finished, needs the user, login expired, parent failed, auto-setup changes, what the Orchestrator did on a ticket (jobs created, question waiting for approval). Assistant replies only as a system notification (decisions 25, 27, 44) | 6, 7, 9 |
| IA4 | Withdrawn: engine status line (decision 35); only the disconnected banner stays | 1, "Fixed implementation choices" |
| IA5 | Withdrawn: project filter (decision 30) | 3.5 |
| IA6 | Tray icon | "Engine and main process messages" |
| IA7 | Command palette | added by this document |

### B. Orchestrator chat

| Id | Element | Source |
|---|---|---|
| IB1 | Withdrawn: conversation list; there is one chat (decision 36) | 6 |
| IB2 | Messages, with attachments (text, links, images) | G1, 6 |
| IB3 | Input field with attachment upload | G1 |
| IB4 | What the orchestrator did (from `chats.db` `actions`), under its reply: a card for each action that changes something, one line for reads (decision 28) | 6, "Data model" |
| IB7 | Live reply while it is written, working indicator, compaction (decisions 20, 23, 24) | added by decisions.md |
| IB5 | Unread marker | 6, 7 |
| IB6 | Answers to agent questions (`agent-question` items) | 6 |
| IB8 | Automatic compaction at two token thresholds (decision 37) | added by decisions.md |
| IB9 | Withdrawn: Orchestrator reports in the chat; they are notifications (decision 44) | added by decisions.md |

### C. Jobs

| Id | Element | Source |
|---|---|---|
| IC1 | Job list: title, project, state, waiting reason, current node, parent | 4.1, 4.3, G13 |
| IC2 | Filters: state label, archived, text | G17 |
| IC3 | Per-job controls: stop, pause, play, resume, realign, archive, delete | G17, 4.2 |
| IC4 | Stacked jobs as a tree, `parent_failed` | 4.6 |
| IC5 | Job graph: nodes with state, round, waiting reason, duration, tokens, cost | 9 |
| IC6 | Node run detail: attempts, artifacts, harness log (streamed) | 9, G13 |
| IC7 | Artifact viewer: spec, diff, findings, risk, check log, delivery link | 3.3 |
| IC8 | "Why is it waiting" text (same as `pecore job why`) | 9 |
| IC9 | Base change notice | 4.2 |
| IC10 | Withdrawn: New job form; jobs start from the orchestrator chat (decision 31) | "Local API", "Job creation" |

### D. items to decide

| Id | Element | `human_queue.kind` | Source |
|---|---|---|---|
| ID1 | Human review | `human-node` | 3.1 |
| ID2 | Confirmation of an engine or `source` node | `engine-node`, `source-node` | 8 |
| ID3 | Confirmation of a recipe change by the orchestrator | `recipe-change` | 6, 8 |
| ID4 | Confirmation of an imported project | `import` | 8 |
| ID5 | Confirmation of a new compose file version | `services` | 4.9 |
| ID6 | Untrusted ticket | `ticket` | 7 |
| ID7 | Round limit reached | `round-limit` | 4.2 |
| ID8 | Withdrawn: budget reached; projects have no budgets (decision 71) | | 4.7 |
| ID9 | Request to post outside the app (a question or comment on a ticket that no recipe prescribes) | `outbound` | decision 39 |

### E. Recipes and nodes

| Id | Element | Source |
|---|---|---|
| IE1 | Recipe graph editor: add and connect nodes on a grid, edges with outcomes, recipe fields | G16, 3.2 |
| IE2 | Validation errors shown on the graph | G5 |
| IE3 | Node editor: fields by kind, prompt (Markdown), script (shell) | 3.1 |
| IE4 | Library: templates of nodes and recipes, instantiate into a project | G5 |
| IE5 | "Ask the AI" from an editor | G5 |

### F. Projects

| Id | Element | Source |
|---|---|---|
| IF1 | Project list | 3.5 |
| IF2 | New project wizard | CUJ 6, "Project creation" |
| IF3 | Project settings: recipes, default recipe, services, ticket source, polling interval, trusted users | 3.5, 7 |
| IF4 | Knowledge base editor (Markdown) | 2 |
| IF5 | Export, and import as a new project | CUJ 7, 8 |
| IF6 | Protected mode: on and off, harness logins of `pecore-agent` | 5, 8 |
| IF7 | Project delete | 4.8 |

### G. Settings and usage

| Id | Element | Source |
|---|---|---|
| IG1 | Accounts: AI tools (found by themselves), Git hosting (public services and private Git servers), services | 3.4 |
| IG2 | Withdrawn: profiles and tiers; models are chosen on each node and for the orchestrator (decisions 5, 6) | 3.4 |
| IG3 | Global limits, services runtime, disk threshold, merge check interval | 4.7, 4.9, "Risks & Limits" |
| IG4 | Withdrawn: the Usage page (decision 64) | 4.7 |
| IG5 | First run | G14 |
| IG6 | Assistant and Orchestrator, each: provider, model, effort, automatic and maximum compaction thresholds (decisions 7, 37, 38, 43) | 6 |
| IG7 | Auto-update | "Fixed implementation choices" |
| IG8 | Withdrawn: quiet hours are left to the operating system (decision 53) | 9 |
| IG9 | Appearance: theme, reduced motion | UI4, UI6 |

## Screens

| Screen | Placement | Inventory |
|---|---|---|
| Factory | centre | IA2, IC1 |
| Jobs | centre | IC1-IC4 |
| Job view | detail page | IC3-IC9 |
| Notifications | centre | ID1-ID9 |
| Assistant chat | right panel, on every screen | IB2-IB8 |
| Projects, project page, wizards | centre, detail page, full page | IF1-IF7 |
| Recipe editor, node editor | detail page | IE1-IE3, IE5 |
| Library | centre | IE4 |
| Settings | centre | IG1, IG3, IG6-IG9 |
| First run | full screen | IG5 |

## Proposed Design

The prototype is normative only for: the gradients, Notifications as a list plus a detail pane, the node inspector as key/value rows, the engine status at the bottom of the navigation, the first run as a step checklist. Nothing else in it is normative.

### Navigation (left)

*   Window: menu on the left, the page in the centre, the Assistant chat on the right (decision 32). The chat takes 30% of the width, between 300 and 380 px.
*   The menu collapses and expands with a button at the top left (decision 34). The choice is remembered; the first time, the menu starts collapsed below 1280 px of width. Collapsed, it is a column of icons, each showing its name on pointing (decision 55).
*   The chat panel's width changes by dragging its left edge or with the arrow keys on it (decision 56).
*   One list, no group titles (decision 14): Notifications (counter, IA2), Factory, Jobs, Projects, Library, Settings.
*   Under the list, the open page's own sub-navigation (decision 13): Settings sections.
*   Note: a project's recipes, nodes and settings are reached through Projects; the node editor and the job view are detail pages, not menu items.
*   Page content is centred, with a maximum width (decision 15).

### Top bar

*   Command palette button, global pause and play (IA1). No notification bell: notifications are a page of the menu (decision 45).
*   While the global pause is on, a banner says so, with Play.
*   A system notification is shown only when the PeCore window is not focused (decision 25).

### Tray (IA6)

*   Icon with the number of running jobs and items to decide; menu with "Open PeCore" and "Quit". Closing the window keeps the app and its jobs running here (UI15).

### Command palette (IA7)

*   Cmd+K or Ctrl+K. Search jobs, projects, recipes, nodes and templates by name; run the controls of the selected job; open any screen.

### Factory

*   Counters, each opening a filtered view: items to decide (opens Notifications; global), Needs you, Failed, Working, Waiting (open Jobs filtered by that label). No token or cost counters (decision 64).
*   After a restart with jobs paused by the quit: "Play interrupted jobs" (UI15).
*   Rows of jobs not in a final state, compact, so 15 or more rows fit in a 1080 px tall window: project, title, current node, state, waiting reason with time ("Quota until 15:40"). Stacked jobs indented under their parent. Hover actions follow the controls table.
*   A Needs you row opens its target (see "Job states shown").

### Jobs

*   Every job. Filters (IC2): text search on title, project, state label, archived. "Jobs of this project" on a project page opens Jobs with that project selected.
*   Columns: title, project, state, current node or final outcome, waiting reason, duration (from creation to end or to now, waits included), updated.
*   Stacked jobs as a collapsible tree.
*   Row actions on hover, following the controls table.

### Job view

*   Header: title, project, branch, state label, "why is it waiting" line (IC8), controls (IC3). Notice when the base changed (IC9).
*   Tabs:
    *   Graph: the recipe graph at the positions saved in the recipe's `layout`, with node run states. Back edges are curved arrows with the round count on the target node. The running node pulses. Nodes with no run yet are Pending.
    *   History: node runs in order (`node_runs`, `attempts`): recipe node id, attempt, outcome, duration, failure reason; for example "test · round 1 · failed · 0m 42s".
*   Detail panel for the selected node run; selecting a graph node shows its latest run and a list of earlier ones. Duration, attempts, tokens, cost, artifacts (IC7), and the log.
*   Log: the normalised events of the attempt (text, tool calls, results), streamed while it runs; a "Raw" toggle shows the JSONL lines. Only the open log is streamed (design.md "Local API"). A log removed by retention shows "Log removed".
*   Artifact viewer (IC7): spec and findings as rendered Markdown; diff as a unified view like a code review on GitHub (one block per file with added and removed line counts, hunk bands, old and new line numbers, red and green bands for removed and added lines, the changed part of a line marked), risky hunks first with their reason; check log as plain text with the failing lines highlighted by the node's output rules; risk as a list; delivery link as a link.
*   Result view, for a job in a final state, above the tabs:
    *   state label and final outcome;
    *   files changed (from the `diff` artifact);
    *   check nodes with their last outcome; no test counts;
    *   open findings (from the `findings` artifact);
    *   delivery link; "Merged" only when `merged_at` is set (design.md Phase 4 decision 10);
    *   no summary text unless an artifact provides it.

### Job controls

| Control | Enabled in | Effect, shown as tooltip |
|---|---|---|
| Pause | running, waiting | Finishes the running node, then holds. No work is lost. (Global pause also keeps queued jobs from starting.) |
| Play | paused | Continues from the next node. |
| Stop | queued, running, waiting, paused | Kills the running node now; the job ends Stopped. No confirmation: Resume restarts it. |
| Resume | failed, stopped | Restarts the failed or stopped node from scratch, in the same workdir. |
| Realign | queued, succeeded, not_delivered, stopped, failed (design.md Phase 4 decision 15); a started job also needs `onBaseChanged` in its recipe | Moves the job onto the current head of its target branch, or onto another target branch chosen here, which the PR then targets too. A started job re-runs the recipe's rebase path. |
| Check merge | a job with a delivery not yet merged | Asks the forge now whether the PR is merged. Opening the job view does the same once. |
| Archive | final states | Hides the job from default lists. |
| Delete | final states, no children outside a final state | Asks for confirmation, listing what is removed: workdir, local branch, artifacts, logs, history. Nothing on the forge is touched. |

### Notifications

*   One list, all projects (decision 45). First the items to decide, oldest first, each marked with a dot: kind label ("Human review", "Engine node", ...), project, the job when the item has one, age. Then the notification log (`GET /notifications`), newest first: title, text, age; a row opens its job or item to decide, and its trash button deletes it (decision 58). Opening the page marks the notifications seen.
*   The detail pane appears only when an item to decide is open.
*   Empty: "Nothing new".
*   Every detail renders the item's `subject` snapshot, never a file read at decision time, and shows its sha256. The decision is sent with that hash. Items never change: a definition edited while its item is open cancels the item and creates a new one (design.md `confirm.ts`). If `queue.updated` reports the open item resolved or cancelled (for example a review cancelled by a base change), the detail locks with a banner and a button that opens the new item, if any.
*   Inline confirmations (UI17: wizard, import, node editor, Library) use the same component on the same queue item, with the same snapshot and hash.
*   Detail by kind:
    *   ID1: the diff in the unified view of the artifact viewer, risky hunks first, then findings and spec, check logs collapsed, one button per node outcome, a note field when the node's `answer` setting allows one.
    *   ID2, engine node: `command` or `script`, `probe`, `probeRules`, `mergedCheck`, `credentials`, `params`. Source node: its four commands (`list`, `read`, `comment`, `replies`) with their scripts and `outputRules`, `credentials`, `params`. For a changed node, a diff against the last confirmed version.
    *   ID3: diff on the recipe graph (UI10).
    *   ID4: every node, script and prompt of the imported project, engine and source nodes first.
    *   ID5: compose file diff against the confirmed version.
    *   ID6: ticket text, author, start or discard.
    *   ID7: which cap was hit (the edge's `maxRounds` or the job's `maxNodeRuns`) and the runs used; input "allow N more" (default: the cap's value), or fail.
    *   ID8: cost or tokens used and the limit reached (per job, or per project per day); input for the new limit, saved to `project.json` (one commit; the label says it applies to future jobs too), or stop. One item per limit: every job blocked by the same limit waits on it.
    *   ID9, "Comment to post": the project and ticket, and the exact text that will be posted, asked by the Orchestrator. Post posts exactly that text; Reject posts nothing (decision 39). The ticket stays waiting until the user acts in the chat.

### Assistant chat (right panel)

*   One chat for the whole app, always on the right of every screen (decisions 32, 36). No conversation list, no page of its own. Its header has two icon buttons: Compact, and Clear, which after a confirmation deletes the conversation and starts a new Assistant session (decision 57).
*   The user talks only to the Assistant. The Orchestrator, which works in the background on new issues of linked projects, never chats and never writes in this chat: what it does arrives as a notification, for example "Shop, ticket 42: The Orchestrator created the job Fix login." (decisions 38, 44).
*   The user's messages sit in a bubble that keeps the accent colour at the bottom-right corner and fades towards the top-left to a lighter shade in light themes, a darker one in dark themes (`--bubble-user`); the Assistant's replies have no bubble (decision 59).
*   The reply appears while it is written (decision 20). Until it starts, animated dots under the user's message show the Assistant is working (decision 23).
*   After sending, the cursor stays in the message box (decision 22).
*   Compaction (decision 24): the Compact button, or `/compact` typed as a message, sends the harness's own compaction command to the chat's session. The chat shows a divider ("Compacting the conversation…", then "Conversation compacted"), no reply.
*   Automatic compaction (decision 37): above the maximum threshold (default 256,000 tokens) the chat compacts at once; above the automatic threshold (default 128,000) it compacts after 5 minutes without use. Both thresholds are in Settings > Assistant; the Orchestrator's sessions have their own pair in Settings > Orchestrator (decision 43). The size comes from what the harness reports after each reply.
*   An order the user gives in the chat is authorised as given (decision 39): if the user asks to comment on an issue, the Assistant posts it.
*   "Ask the AI" (IE5) puts the cursor in the chat with the current screen's object as context.
*   Context chip: one at a time, a reference with its scope (for example "Job: Fix login timeout", "Recipe feature (project progetto-1)", "Template recipe feature"). It shows the object of the current screen and changes on navigation; pinning keeps it; removing it sends the next message with no context.
*   What the Assistant did (IB4) appears under its reply, never under the user's message (decision 28). Actions that change something (create jobs, answer a job's question, add a node or recipe to a project, comment on a ticket) get a card that links to the job, definition or item to decide. Reads (projects, recipes, ticket, ticket replies, job status, job output, library templates, definition check) become one grey line: "Read: projects, job status".
*   Agent questions (IB6) appear in the conversation with an answer field.
*   A system notification for a reply or a report is shown only when the PeCore window is not focused; they never go to the notification list (decisions 25, 27).

### Projects

*   List: name, repo (or "local only"), base branch, jobs that need the user, failed jobs, warning when a login expired.
*   Buttons: "New project", "Import project".
*   Project page, configuration only, in sections:
    *   General: name, base branch, default recipe (editable); id, repo, forge account (read-only after creation).
    *   Recipes (recipe editor), Nodes (node editor), Knowledge (IF4), Services, Ticket source (`label`, `pollSec`, trusted users), Export.
    *   Danger zone: Delete project (IF7).
*   A link "Jobs of this project" opens Jobs with this project selected.

### New project wizard (full page)

Pages: Inputs, Create, Confirm. Create runs the tasks of design.md "Project creation" in order; the project exists when Create ends.

1.  **Inputs:** name, repo (existing URL, a new repo to create with a chosen repo creation node, or local only), forge account, base branch, starting recipes (the shipped ones, with delivery nodes for the project's forge; each can be unchecked). The id comes from the name (decision 70).
2.  **Create:** the tasks of "Project creation" (validation, project directory, clone or repo creation, `repo.git` setup and home check, access for `pecore-agent` in protected mode, commit), each with its state. The creation request approves the shipped GitHub or GitLab repo setup node. Custom and modified nodes ask for confirmation inside the task (UI17). A failed task undoes the tasks before it, says why, and returns to Inputs with the values kept. A repo created on the forge is never deleted by the undo: the page lists it as left on the forge.
3.  **Confirm:** the engine nodes of the starting recipes and the project's `source` node, if any, on one screen, so the first job does not wait with reason `confirmation`. Can be skipped: the items stay in Notifications.
4.  No logins page: logins belong to the user, not to the project (Settings > Accounts).

Cancel on Inputs discards the inputs; Cancel during Create undoes the tasks done; Cancel on Confirm leaves the project created.

### Import project (full page)

*   Pages: archive (choose the `.tar.zst`), accounts (map each account reference to a local account), Create (the "Project creation" tasks with the archive's definitions), Confirm (ID4: every node, script and prompt).
*   No node from the archive runs before it is confirmed: if Create needs the archive's repo creation node (no existing remote), its confirmation is shown inside that task (UI17), as in the wizard.

### Export (dialog)

*   Option: include job history. When history is included, the gitleaks scan runs first; its matches are listed, and the user confirms or cancels the export (design.md section 8).

### Delete project (dialog)

*   Lists what is removed (design.md 4.8): project directory, workdirs, artifacts, logs, database, definitions, service containers. Says that nothing on the forge is touched.
*   Disabled while a job of the project is running, with a link to stop them.

### Recipe editor

*   Two modes: an instance (from the project page) or a template (from the Library).
*   React Flow graph on a grid. Nodes are added from a palette (the project's node instances, or node templates in template mode), placed on the grid and connected by dragging from an outcome to a node. Positions are saved in the recipe's `layout`; a recipe with no `layout` (for example written by the orchestrator) is laid out automatically when opened.
*   Validation errors on the node or edge that causes them (IE2).
*   Inspector for a node: kind, outcomes, `requires`, `optional`, `skipWhenUnchanged`, `maxRounds` of its outgoing edges, "Edit node", "Ask the AI".
*   Inspector for the recipe: `start`, `onBaseChanged`, `maxNodeRuns`, `successOutcomes`.

### Node editor

*   Opened from a recipe, the project's Nodes section or the Library; the same editor for templates and instances.
*   Form with the fields of the node's kind (agent, command, human, source); prompt in Markdown and script in shell with CodeMirror; a JSON tab for the whole file.
*   Validation errors next to the field. Save is disabled while the draft is invalid. The draft lives in memory until saved or discarded; leaving the page with an unsaved draft asks first.
*   No autosave: every save is one commit in `PECORE_HOME`, or in the project's own repository for a project outside it.
*   Saving an engine or source node instance opens its confirmation inside the editor (UI17). Saving a template needs no confirmation; each instance made from it is confirmed when it is created.
*   When live jobs use the node instance being edited, the editor says so: they will use the new version at their next run of that node.

### Library

*   Node templates (filterable by kind) and recipe templates.
*   "Instantiate into project": instantiating a recipe template also instantiates the node templates it uses (design.md `src/definitions/instantiate.ts`); a name that already exists in the project is kept and listed. Engine and source nodes created this way show their confirmation in place (UI17).
*   Clicking a row opens the template in the node or recipe editor.

### Settings

*   Sections: Accounts (IG1), Protected mode (IF6), Assistant and Orchestrator (IG6), Limits and disk threshold, Services runtime, Merge check interval (IG3), Updates (IG7), Appearance (IG9). No Models section (decision 6) and no Notifications section (decision 53).
*   The section list is in the main sidebar (decision 13). Sections adapt to the window width, and each has a one-line description under its title (decisions 2, 16).
*   No text or JSON editing and no user-typed IDs; raw validation errors are never shown (decisions 1, 3).
*   Every change saves by itself, a moment after the last keystroke and at once when the page is left; there is no Save or Discard button (decision 49). A value that is not valid is not saved and the problem shows at the bottom of the page.
*   Accounts has two lists:
    *   AI tools: every installed harness appears by itself (decision 4). A row shows the tool, the account, its state, a Check button that looks clickable, and Log in only when needed (decision 8). A working account shows "Logged in", OpenCode and a private Git server included (decision 51). OpenCode is logged in when it lists at least one model; with none, the row says to set up a model provider in OpenCode (decision 12).
    *   Git hosting: an "Add account" button for a public service or the user's own server (decisions 9, 11). Texts never name a hosting service. Forge tool logins (`gh`, `glab`) run in the GUI like harness logins: the device code or URL is shown, then the account is rechecked (design.md `accounts/login.ts`). A private Git server account uses the user's own Git credentials and has no Log in button.
*   Assistant: Provider, Model and Effort selects, filled from what the harness reports (decision 7), and the automatic and maximum compaction thresholds in tokens (default 128,000 and 256,000, decision 37).
*   Orchestrator: Provider, Model and Effort selects, by default "Same as the Assistant" (decision 38), and its own pair of compaction thresholds with the same defaults (decision 43).
*   In both pickers Effort is locked until a model is chosen (decision 48) and lists only the levels that model offers, Default alone when it offers none; choosing another model resets it to Default (decision 52). The model list is read once when the app starts, and each model's levels the first time they are needed; a small refresh button next to Model reads both again (decision 50).
*   Protected mode (IF6): one switch with a short explanation (agents cannot read your files and logins; one login per harness account for `pecore-agent`; agents can read all `pecore-agent` logins). Turning it on opens the admin prompt; if it cannot (no polkit agent), the page shows the exact script with a Copy button and "I ran it, recheck". Then the page lists each model account with a Login button for `pecore-agent`, showing the URL or code. Turning it off asks whether to also remove `pecore-agent`.
*   "Recheck prerequisites", with a link to the setting each failed check points to.

### Zero-config start (replaces the first run checklist)

Goal: minimum friction. The user opens PeCore and it works, with no setting to fill and no file to edit.

*   No location window: `PECORE_HOME` is `~/.pecore` unless a location is already stored. Moving it from Settings is a later feature.
*   No first run screen and no `firstRunDone`. The app opens on Factory, with the Assistant chat on the right and the cursor in its message box.
*   At every engine start, auto-setup runs (design.md "Auto-setup"). It finds the installed harnesses, adds an account for each one the user is logged in to, creates profiles from the models each harness reports, fills the tiers and sets the orchestrator profile. Profiles and tiers are internal and never shown (decision 5). It only adds what is missing and never changes what the user set.
*   When no harness is installed and logged in, a banner on every page says so, with the install link of each supported harness and a Log in button for the installed ones. Nothing is disabled that can work without it.
*   git stays required, because `PECORE_HOME` is a git repository: without it the app shows an error with the install instruction. Other missing prerequisites (Compose, gitleaks, gh, glab) are warnings on the feature that needs them, as in "Missing configuration and warnings" below, never a blocking step.

## Cross-cutting behaviour

### Empty, loading and disconnected states

*   Empty lists say what fills them, with the action: "No projects: New project", "Notifications: Nothing new".
*   Loading: lists keep their layout with placeholder rows; no spinners over the whole screen. A field whose options are loading shows a spinner and a "Reading…" text and never looks disabled (decision 19).

### Controls

*   A select and a combobox look the same: same arrow, no clear button. A focused field shows one focus ring (decision 19).
*   Engine or WebSocket disconnected: a banner "Disconnected, reconnecting", every control disabled, data marked stale. On reconnect the GUI refetches every open view.

### Missing configuration and warnings

*   A function whose requirements are missing is disabled, with a message that says what is missing and a link to where it is set ("No forge account: add one in Settings > Accounts").
*   A missing or expired login is a notification and a warning on the project or account, never a blocking dialog.
*   Home check failure: a warning on the engine status with "Fix permissions".
*   Identity mismatch (design.md 3.4): a warning on the account; jobs that use it wait with reason `auth` until the user logs in with the right account and presses "Recheck login".

### Concurrent edits

*   Editors load each file with its hash and save with it (design.md "Local API"). When `definition.changed` reports a change to an open file (for example by the orchestrator), the editor shows "Changed elsewhere: reload, compare, keep mine". Keep mine saves over the new version only after the compare view.

### Updates

*   Live updates are batched; long lists and logs are virtualised (UI7b).

## Job states shown

| Label | Engine state | Color |
|---|---|---|
| Working | `running` | `status-running`, with pulse |
| Needs you | `waiting` with reason `human`, `confirmation`, `round_limit` or `auth`; `queued` with reason `parent_failed` | `status-warning` |
| Waiting | `waiting` for any other reason (`concurrency`, `quota`, `rate_limit`, `services`, `network`, `disk`); reason and, when known, time shown ("Quota until 15:40") | `status-warning` |
| Queued | `queued` with reason `parent_job`, `concurrency` or `disk` | `status-warning` |
| Paused | `paused`; "Paused (app quit)" or "Paused by you" | `status-inactive` |
| Success | `succeeded` | `status-success` |
| Not delivered | `not_delivered`; outcome shown ("Spec rejected") | `status-inactive` |
| Failed | `failed`; failure reason shown | `status-failed` |
| Stopped | `stopped` | `status-inactive` |

Clicking a job labelled Needs you opens:

*   `human`, `confirmation`, `round_limit`: the item to decide recorded on the node run (`queue_item_id`); an `agent-question` opens its conversation.
*   `auth`: the account recorded on the node run; a harness login opens Settings > Accounts (in protected mode, Settings > Protected mode), a tool login opens Settings > Accounts.
*   `parent_failed`: the parent job.

The Notifications counter counts items to decide, not jobs: several jobs can wait on one item.

## Node run states shown

Rows are checked from the top; the first match wins.

| Label | Engine state | Color |
|---|---|---|
| Pending | `pending`, or no run yet | `status-inactive` |
| Working | `running` | `status-running`, with pulse |
| Needs you / Waiting | `waiting`, same split as job states | `status-warning` |
| Failed | `failed` (reason shown) | `status-failed` |
| Interrupted | `interrupted` | `status-inactive` |
| Skipped | `skipped` | `status-inactive` |
| the outcome | `completed`, outcome in the node's `failOutcomes` or `stale` | `status-failed` (also when an edge routes it back) |
| the outcome | `completed`, `<node>:<outcome>` in `successOutcomes` | `status-success` |
| the outcome | `completed`, outcome with no edge (the job ended Not delivered) | `status-inactive` |
| the outcome | `completed`, any other outcome (`passed`, `changes`, `conflict`) | no status color |

Color is never the only signal: every state also has an icon and its label.

## Color tokens

| Token | Use |
|---|---|
| `bg`, `bg-gradient-1`, `bg-gradient-2` | page background (dark green in the default theme) |
| `surface`, `surface-raised`, `border` | panels, cards |
| `text`, `text-muted` | text; contrast at least 4.5:1 on `bg`, `surface` and `surface-raised` |
| `accent` | focus, links, highlighted text |
| `accent-fill`, `on-accent` | solid fills (primary buttons, chat bubbles, selected items) and the text on them; same as `accent` unless the theme needs a darker fill for readable text (decision 61) |
| `status-running` | light blue: running |
| `status-success` | green: success, success outcomes |
| `status-failed` | red: failed, fail outcomes, validation errors |
| `status-warning` | yellow: needs you, waiting, queued, items to decide |
| `status-inactive` | grey: paused, stopped, not delivered, pending, skipped, disabled controls |

Status tokens need at least 3:1 contrast against `surface` in every theme.

## Size tokens

Every size lives in `ds/tokens.css`; components use only these variables, never a written number for text, control, row or icon size (decision 54). The scale follows Claude web for readability.

| Token | Value | Use |
|---|---|---|
| `--text-size-xs`, `-sm`, base `--text-size`, `-md`, `-lg`, `-xl` | 12, 13, 14, 15, 17, 24 px | captions and badges, secondary text, body, chat messages and emphasis, section and dialog titles, page titles |
| `--line-height` | 1.5 | body text |
| `--control-h-lg`, `--control-h`, `--control-h-sm` | 42, 36, 30 px | buttons, fields, selects |
| `--row-h-lg`, `--row-h`, `--row-h-sm` | 44, 34, 30 px | table rows, menu and list rows, popup and menu items |
| `--mini-h`, `--tag-h` | 24, 22 px | small buttons inside fields and chips; badges, counters, key hints |
| `--icon-button-size`, `-sm` | 32, 28 px | buttons with only an icon |
| `--icon-size`, `-sm`, `-xs` | 20, 16, 12 px | icon `size="md"` (icon buttons, menu), default `sm` (next to text), `xs` (arrows and crosses inside fields) |
| `--icon-stroke`, `-bold` | 1.5, 2 px | icon line width at every icon size |

## Decisions

| # | Decision |
|---|---|
| UI1 | Withdrawn; ids are not reused. |
| UI2 | Factory is a summary dashboard; every function has its own page with the full detail. |
| UI2b | Withdrawn: the Assistant chat is always on the right of every screen, with no page of its own (decisions 32, 36). |
| UI3 | Dark green base and translucent panels, as in the prototype. |
| UI4 | Themes: every color is a CSS variable. Settings > Appearance has a mode (System, Light, Dark) and one theme; the mode picks the theme's light or dark version, and System follows the operating system (decision 67). Shipped: Default, Autumn, Spring, Summer, Winter and Monochrome (decision 66), each in a light and a dark version, as variable blocks in `ds/tokens.css`; Summer is a summer version of Everforest (decision 65). The user can add a theme as a JSON file of tokens in `PECORE_HOME/themes/`, validated by a JSON Schema; missing tokens fall back to the default theme; values must be colors; the file applies only in the mode that matches its background. |
| UI5 | No images. The background is a fixed gradient of `bg-gradient-1` and `bg-gradient-2`, with no animation. |
| UI6 | Animation only on running state (pulse); off with `prefers-reduced-motion` or Settings > Appearance > Reduced motion. No progress percentages: an agent node shows state, duration, round and attempts. |
| UI7 | Components: Base UI (unstyled, behaviour and accessibility); styles: CSS Modules with the theme's CSS variables. |
| UI7b | Libraries: React Flow (recipe graphs), CodeMirror 6 (editors), `@tanstack/react-virtual` (long lists and logs), `cmdk` (command palette). |
| UI8 | The job list has no model or harness columns; those are details of a node run. |
| UI9 | Stacked jobs are a tree of indented rows in the job lists. Graphs show recipes only. |
| UI10 | A recipe change proposed by the orchestrator is shown as a diff on the graph before the user confirms it (ID3). |
| UI11 | Every value shown comes from engine state, an artifact, a persisted definition, or a deterministic computation on these. A value with no source is shown as missing; the UI never asks an LLM to fill it. |
| UI12 | Factory shows only what needs the user and the state of unfinished work. Every other function is one navigation click away. |
| UI13 | Withdrawn: there is no global project filter (decisions.md 30). Jobs has a project filter of its own. |
| UI14 | The mini chat sends references, never content (design.md section 6). |
| UI15a | Closing the window keeps jobs running in the tray. |
| UI15b | Quit asks for confirmation and shows how many jobs it interrupts. |
| UI15c | After a restart, Factory shows "Play interrupted jobs" for jobs paused with reason `quit`. |
| UI15d | Every job control has a tooltip that says what it does (Job controls table). |
| UI16 | Status colors keep fixed meanings in every theme: green success, red failure, yellow warning, grey inactive, light blue running. A theme may change their shades. All other colors, the accent included, are free for the theme. |
| UI17 | A confirmation that blocks a flow the user is in (wizard, editor, Library instantiation) is shown inside that flow, as well as in Notifications. |
| UI18 | A decision on an item to decide approves the snapshot the user saw, identified by its hash; a changed item cannot be approved. |
| UI19 | Delete of a job or project is local only and asks for confirmation; Stop needs none. |

## Alternatives Considered

| Option | Status | Reason | What is lost |
|---|---|---|---|
| Chat as the home screen | Rejected (author) | The home must show what needs the user; the chat is reached from every screen through the mini chat | A chat-first flow |
| Chat only on its own page (UI2b) | Rejected (author) | Asking about the open job or recipe needs the chat next to it | Simpler layout |
| shadcn/ui and Tailwind (UI7) | Rejected (author) | shadcn copies styled components into the code base and Tailwind replaces CSS variables with utility classes; the author wants themes as CSS variable tokens and plain CSS Modules | Ready-made styled components |
| A separate graph of stacked jobs (UI9) | Rejected (author) | A job has at most one parent, so stacks are trees; indented rows show them without a second graph view | A visual map of large stacks |
| Recipe change as a text diff (UI10) | Rejected | A graph change is hard to read as JSON | Nothing |
| Automatic layout only for recipes | Rejected (author) | Nodes are placed and connected by hand; positions must stay where the user put them | Nothing in the engine: `layout` is ignored by it |
| Notifications only for confirmations (UI17) | Rejected | The wizard and editors would stop on an item the user must find elsewhere | Nothing |
| Tool logins (`gh`, `glab`) run by the user in a terminal | Rejected | design.md G16 allows only one terminal step (manual creation of the protected user) | Nothing |
| Delete runs a cleanup on the forge | Rejected (author) | Delete must not act on remote resources | Remote branches and PRs stay until closed on the forge |
| Progress percentages for agent nodes (UI6) | Rejected | No harness reports progress; a percentage would be invented | A progress bar |

## Risks & Limits

| Risk | Impact | Mitigation | Where |
|---|---|---|---|
| A prompt-injected orchestrator changes a node while its confirmation is open | an unseen command runs as the app user | snapshot and hash on every Notifications decision | UI18, Notifications |
| Untrusted text (tickets, agent output, logs) rendered in the GUI | script injection in the renderer | Markdown rendered without raw HTML; logs as text; no `dangerouslySetInnerHTML` | Job view, Notifications |
| Engine crash or WebSocket drop | stale states look live | disconnected banner, controls disabled, refetch on reconnect | Cross-cutting behaviour |
| Many running agents streaming logs | renderer overload | log streaming only for the open attempt; updates once per frame; virtual lists | Job view, Updates |
| Very large diffs (thousands of lines) | slow diff view | files rendered 30 at a time, each collapsible, risky hunks first | Notifications ID1, artifact viewer |
| Editor and orchestrator write the same file | one change silently lost | save with the file hash; changed-elsewhere banner | Concurrent edits |
| User theme file with bad values | unreadable UI | schema validation, fallback tokens, contrast rules | UI4, Color tokens |
| Normal mode: agents run as the app user | agents read the user's files and logins | Settings shows the mode and offers protected mode in one step | Settings |

### Limits

*   One window, one user, one machine (design.md "Risks & Limits").
*   English only.
*   "Merged" is shown only for succeeded jobs with children (design.md 4.6).
*   Recipe positions are kept only in the recipe file; a recipe written without `layout` is laid out automatically once.
