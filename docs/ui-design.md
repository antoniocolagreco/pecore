# <PE/CORE> UI

*   **Author:** Antonio Colagreco
*   **Status:** Approved (EGM stages 5-8 applied; stage 9 not applicable; reports in [reviews/ui/](reviews/ui/)). The `packages/app` table of design.md matches the Screens table below.
*   **Date:** 2026-11-18
*   **Related:** [Product and engineering design](design.md), [concepts brief](archive/concepts-brief.md), [repository workflow](repository-workflow.md)
*   **Maintenance:** Update these screen details and the [product interface](design.md#product-interface) together.

## Problem Statement

<PE/CORE> runs many jobs at once, each through a recipe graph of agents, checks, reviews and deliveries (design.md Overview). The user leaves it working and comes back. When they come back they need two answers at once: what is waiting for them, and what was delivered. Without a UI built for that, the user digs through logs and graphs to find the one review that blocks five jobs, and cannot tell a delivered PR from a rejected spec.

## Goals

*   **Attention first.** From any screen, the user sees how many items wait for them and reaches one in one click. Nothing that needs the user is hidden by a filter.
*   **Results are clear.** A finished job shows its outcome, what changed, which checks ran and where the delivery is, from recorded data only (UI11).
*   **Diagnosis in two clicks** (design.md G13): from Factory to the live log of a running node, and from a failed job to the failing node run.
*   **Everything in the GUI** (design.md G16): every function of design.md has a screen; no step needs a file editor.
*   **Safe confirmations** (design.md section 8): a confirmation always approves exactly what the user saw.
*   **Minimal**: nothing on screen that the user does not need to act or decide.
*   **Small screens**: everything works in a 1024×720 window.
*   **The user controls what leaves the app**: outside a recipe, nothing is posted to an outside service without the user's approval or order.

## Non-Goals

*   Translation: the UI is in English only.
*   Invented figures: no progress percentages, no remaining subscription quota unless the connector reports it, no LLM-written summaries (UI6, UI11).
*   A graph of stacked jobs: stacks are a tree in the lists (UI9).
*   Project language detection: <PE/CORE> does not know a project's language.
*   Actions on the forge from delete: deleting a job or a project never touches the remote (design.md 4.8).

## Terms

*   **Factory:** the home screen, a summary dashboard.
*   **Notifications:** the screen that lists the items to decide (open `human_queue` rows, except `agent-question` items, answered in the chat) and the notification log. Its counter counts the items to decide plus the notifications not seen yet.
*   **Engine:** the background process that runs jobs (design.md section 1). **Engine state:** a job or node run state of design.md 4.1 and 4.3.
*   **Normal mode and protected mode:** design.md's project user (section 8). In normal mode, the default, agents, the Assistant and the Project Managers run as the user, with the user's own harness logins, like Claude Code, Codex or pi run by hand. In protected mode they run as `pecore-agent`, which cannot read the user's files and logins; it needs one login per harness account. The mode is global, not per project.
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
| IA3 | Notifications: job finished, needs the user, login expired, parent failed, auto-setup changes, what the Project Manager did on a ticket (jobs created, question waiting for approval). Assistant replies only as a system notification | 6, 7, 9 |
| IA4 | Withdrawn: engine status line; only the disconnected banner stays | 1, "Fixed implementation choices" |
| IA5 | Withdrawn: global project filter | [Shell and navigation](design.md#shell-and-navigation) |
| IA6 | Tray icon | "Engine and main process messages" |
| IA7 | Command palette | added by this document |

### B. Assistant chat

| Id | Element | Source |
|---|---|---|
| IB1 | Withdrawn: conversation list; there is one chat | 6 |
| IB2 | Messages, with attachments (text, links, images) | G1, 6 |
| IB3 | Input field with attachment upload | G1 |
| IB4 | Assistant actions under the reply. One card per change and one shared line for reads. | 6, "Data model" |
| IB7 | Live reply while it is written, working indicator, compaction | 6 |
| IB5 | Unread marker | 6, 7 |
| IB6 | Answers to agent questions (`agent-question` items) | 6 |
| IB8 | Automatic compaction at two token thresholds | 6 |
| IB9 | Project Manager chat inside each project and on each job page, with the tickets it handled, the orders passed on by the Assistant and its agents' questions | 6 |

### C. Jobs

| Id | Element | Source |
|---|---|---|
| IC1 | Job list: title, project, state, waiting reason, current node, parent | 4.1, 4.3, G13 |
| IC2 | Filters: state label, archived, text | G17 |
| IC3 | Per-job controls: stop, pause, play, resume, realign, archive, delete | G17, 4.2 |
| IC4 | Stacked jobs as a tree, `parent_failed` | 4.6 |
| IC5 | Job graph: nodes with state, round, waiting reason, duration, tokens, cost | 9 |
| IC6 | Node run detail: attempts, artifacts, harness log (streamed) | 9, G13 |
| IC7 | Artifact viewer: BDD spec, diff, code review, code analysis, commit SHA, pull request, feedback, execution log | 3.3 |
| IC8 | "Why is it waiting" text (same as `pecore job why`) | 9 |
| IC9 | Base change notice | 4.2 |
| IC10 | New job form on the project page with title, instructions and recipe. Jobs can also start from chat. | [Job creation](design.md#job-creation) |

### D. items to decide

| Id | Element | `human_queue.kind` | Source |
|---|---|---|---|
| ID1 | Human review | `human-node` | 3.1 |
| ID7 | Round limit reached | `round-limit` | 4.2 |
| ID8 | Withdrawn: budget reached; projects have no budgets | | 4.7 |

### E. Recipes and nodes

| Id | Element | Source |
|---|---|---|
| IE1 | Recipe graph editor: add and connect nodes on a grid, edges with outcomes, recipe fields | G16, 3.2 |
| IE2 | Validation errors shown on the graph | G5 |
| IE3 | Node editor: fields by kind, prompt (Markdown), script (shell) | 3.1 |
| IE4 | Templates, the shared catalog of nodes and recipes | G5 |
| IE5 | "Ask the AI" from an editor | G5 |

### F. Projects

| Id | Element | Source |
|---|---|---|
| IF1 | Project list | 3.5 |
| IF2 | New project wizard | CUJ 6, "Project creation" |
| IF3 | Project settings: recipes, services, repository and folder | 3.5, 7 |
| IF4 | Knowledge base editor (Markdown) | 2 |
| IF5 | Export, and import as a new project | CUJ 7, 8 |
| IF6 | Protected mode: on and off, harness logins of `pecore-agent` | 5, 8 |
| IF7 | Project delete | 4.8 |

### G. Settings

| Id | Element | Source |
|---|---|---|
| IG1 | Accounts: AI tools (found by themselves), Git hosting (public services and private Git servers), trackers | 3.4 |
| IG2 | Agents lists reusable configurations for future use by recipe nodes. | 3.4, 6 |
| IG3 | Global limits, services runtime, disk threshold, merge check interval | 4.7, 4.9, "Risks & Limits" |
| IG4 | Withdrawn: the Usage page | 4.7 |
| IG5 | Setup status and next steps | G14 |
| IG6 | Agents has fixed Assistant and Default Agent cards with editable settings. The PM tab holds the project's agent card, identity and context. | 6 |
| IG7 | Auto-update | "Fixed implementation choices" |
| IG8 | Withdrawn: quiet hours are left to the operating system | 9 |
| IG9 | Appearance: theme, reduced motion | UI4, UI6 |

## Screens

| Screen | Placement | Inventory |
|---|---|---|
| Factory | centre | IA2, IC1 |
| Jobs | centre | IC1-IC4 |
| Job view | detail page | IC3-IC9 |
| Notifications | centre | ID1-ID9 |
| Assistant chat | right panel, on every screen; inside a project and on a job's page it shows the project's Project Manager | IB2-IB8 |
| Projects, project page, wizards | centre, detail page, full page | IF1-IF7 |
| Recipe editor, node editor | detail page | IE1-IE3, IE5 |
| Templates | centre | IE4 |
| Settings | centre | IG1, IG3, IG6-IG9 |
| Setup banner | above page content when no account works | IG5 |

## Proposed Design

The prototype shows the Notifications list and detail pane and the node inspector's key/value rows. This document defines the current UI.

### Navigation (left)

*   The expanded sidebar shows "<PE/CORE>" as the product name.
*   Window: menu on the left, the page in the centre, the Assistant chat on the right. By default the chat takes 35% of the width, between 340 and 520 px.
*   The menu starts collapsed. It collapses again when the window narrows below 1024 px. The button at the top left expands or collapses it at any width. Collapsed, it is a column of icons, each showing its name on pointing.
*   The chat panel's width changes by dragging its left edge or with the arrow keys on it.
*   One list, without group titles. Order: Factory, Projects, Jobs, Notifications (IA2), Templates, Agents, Settings, Showcase.
*   Under the list, the open page's own sub-navigation: Settings sections, Showcase sections.
*   Back and Forward restore the filters, search text, selected tab, expanded sections and scroll position of that visit. A new visit starts with the page defaults. For example, returning from a node editor restores the Node templates search and position in the list.
*   Use the mouse Back and Forward buttons, Alt+Left and Alt+Right, or Cmd+[ and Cmd+] on Mac. The existing Back links in editors also restore the list they return to.
*   Note: a project's recipes, nodes and settings are reached through Projects; the node editor and the job view are detail pages, not menu items.
*   Page width follows the content: pages with tables, lists or graphs (Factory, Jobs, Projects, Notifications, a project page, a job) use the full width; pages that are only a form or text to read (Settings, the wizards) are centred with a maximum width. Inside a full-width page, a form keeps its maximum width and stays aligned to the left with the tabs.

### Top bar

*   Command palette button, global pause and play (IA1). No notification bell: notifications are a page of the menu.
*   While the global pause is on, a banner says so, with Play.
*   A system notification is shown only when the <PE/CORE> window is not focused.

### Tray (IA6)

*   Icon with the number of running jobs and items to decide; menu with "Open <PE/CORE>" and "Quit". Closing the window keeps the app and its jobs running here (UI15).

### Command palette (IA7)

*   Cmd+K or Ctrl+K. Search jobs, projects, recipes, nodes and templates by name; run the controls of the selected job; open any screen.

### Factory

*   Counters, each opening a filtered view: items to decide (opens Notifications; global), Needs you, Failed, Working, Waiting (open Jobs filtered by that label). No token or cost counters.
*   After a restart with jobs paused by the quit: "Play interrupted jobs" (UI15).
*   Rows of jobs not in a final state, compact, so 15 or more rows fit in a 1080 px tall window: project, title, current node, state, waiting reason with time ("Quota until 15:40"). Stacked jobs indented under their parent. Hover actions follow the controls table.
*   A Needs you row opens its target (see "Job states shown").

### Jobs

*   Every job. Filters (IC2): text search on title, project, state label, archived. A project page shows the jobs of that project in its Jobs tab.
*   Columns: title, project, state, current node or final outcome, waiting reason, duration (from creation to end or to now, waits included), updated.
*   Stacked jobs as a collapsible tree.
*   Row actions on hover, following the controls table.

### Job view

*   Header: title, project, branch, state label, "why is it waiting" line (IC8), controls (IC3). Notice when the base changed (IC9).
*   Tabs:
    *   Graph: the recipe graph at the positions saved in the recipe's `layout`, with node run states. Each node is the Templates node card; its state, step name and round sit under it. Back edges are curved arrows with the round count on the target node. The running node pulses. Nodes with no run yet are Pending.
    *   History: node runs in order (`node_runs`, `attempts`): recipe node id, attempt, outcome, duration, failure reason; for example "test · round 1 · failure · 0m 42s".
*   The selected node shows its latest run and a list of earlier runs. The detail panel shows duration, attempts, tokens, cost, artifacts loaded from the project database (IC7), and the attempt log.
*   Log shows the attempt's messages from the project database. The default view displays text, tool calls and results, with live updates while the attempt runs. "Raw" shows the stored messages as JSON lines. Only the open log receives live updates. Logs stay until the job or project is deleted. Imported history that omitted logs shows "Log unavailable".
*   Artifact viewer (IC7) shows BDD scenarios, the Git diff with risky hunks first, code reviews with line or hunk comments, hunk analysis, commit SHAs, pull requests, feedback and execution logs.
*   Result view, for a job in a final state, above the tabs:
    *   state label and final outcome;
    *   files changed (from the `diff` artifact);
    *   check nodes with their last outcome; no test counts;
    *   the latest code review;
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

*   One list, all projects. First the items to decide, oldest first, each marked with a dot: kind label ("Human review", "Comment to post", ...), project, the job when the item has one, age. Then the notification log (`GET /notifications`), newest first: title, text, age; a row opens its job or item to decide, and its trash button deletes it. Opening the page marks the notifications seen.
*   The detail pane appears only when an item to decide is open.
*   Empty: "Nothing new".
*   Every detail renders the item's `subject` snapshot, never a file read at decision time, and shows its sha256. The decision is sent with that hash. If `queue.updated` reports the open item resolved or cancelled (for example a review cancelled by a base change), the detail locks with a banner and a button that opens the new item, if any.
*   Detail by kind:
    *   ID1: the title is the node's interface (Decision, Code review, Report review), and each interface has its own component, so new ones can be added. Code review shows the diff with risky hunks first. Choose a line to add a comment and repeat on other lines. Request changes sends all comments and the optional general note as one code review. Report review shows the selected outputs. Decision: the read outputs, if any. One button per node outcome. A note field when an outcome takes a note; its description names those outcomes.
    *   ID7 shows which edge reached its round limit. The user can allow one more round or end the job.
    *   ID9, "Comment to post": show the project, ticket and exact text proposed by the Project Manager. The ticket waits until the user chooses Post or Reject in Notifications.

### Assistant chat (right panel)

*   One chat panel, always on the right of every screen. No conversation list, no page of its own. It follows the page: inside a project (the project page and its sub-pages, the recipe and node editors of its files) and on a single job's page it shows that project's Project Manager; everywhere else, the Jobs list included, it shows the Assistant. Each chat keeps its own history. Switching page switches the conversation and discards text typed and not sent.
*   Replies are GitHub Markdown: tables, strikethrough and task lists render, and a table uses the design system's table (`TextTable`). Reports in the job view render the same way.
*   The chat header shows the Assistant's spark icon or the Project Manager's avatar beside the name. Compact frees context. Clear deletes the conversation after confirmation.
*   An empty chat shows a welcome message centered above the composer. The Project Manager's welcome names the project.
*   Each project gets the first free Project Manager name and colour from the 24 agent colours. Replies and reports in either chat use the Assistant's text style. The Project Manager has a coloured avatar with its initial and an author label such as "Aura - Project Manager". Reports in the Assistant's chat also show the project name.
*   The Project Manager uses project nodes to search and read tickets and to propose remote changes. Questions for the user stay in the app.
*   Send a ticket link, supporting web pages and files together in Project Manager chat. The Project Manager combines their relevant details into one job request and passes the original files it chooses. The job card links to that job.
*   The Assistant reads every project but does no project work. Asked for it, for example "add a job to Shop to fix the login", it passes the order to Shop's Project Manager and says so in one line, never "done". The order appears in the Project Manager's chat from "Assistant". When the Project Manager finishes, fails or is interrupted, its final reply appears in the Assistant's chat from "Aura - Project Manager" of Shop, without starting a new Assistant reply.
*   A failed message shows the provider's own error message under it, for example "You've hit your usage limit. ... try again at 6:23 PM.", never the raw error object.
*   A job agent's question also appears in the Project Manager's chat as "Agent question" with a link to the job. The Project Manager answers it when the project's knowledge, recipes or ticket already decide it; otherwise it says the user must decide, and the question waits in Notifications.
*   Messages from the other agent (an order from the Assistant, a Project Manager's report) longer than 280 characters are cut at the last word before that length and end with "…", followed by a "Show more" button; "Show less" shortens them again.
*   The user's messages sit in a bubble that keeps the accent colour at the bottom-right corner and fades towards the top-left to a lighter shade in light themes, a darker one in dark themes (`--bubble-user`); the Assistant's replies have no bubble.
*   The reply appears while it is written. Animated dots show the agent is still working: under the user's message until the reply starts, then under the text written so far, until the reply ends.
*   After sending, the cursor stays in the message box.
*   Files: the clip button, pasting into the message box (for example a screenshot just taken with Print Screen), or dropping files anywhere on the chat panel, which shows "Drop files to attach" while dragging. Any file type, up to 10 MB each. Each file shows above the message box in a 16:9 tile, 128 px wide, with a remove button in its corner: an image fits whole, never cropped; another file shows its name. The pasted text, if any, is not inserted. When the model cannot read images, an image is refused with the reason; other files still attach. A sent message keeps each image as the same 16:9 thumbnail, with its name and size as a tooltip, and lists other files by name and size.
*   Compaction: the Compact button, or `/compact` typed as a message, sends the harness's own compaction command to the chat's session. The chat shows a divider ("Compacting the conversation…", then "Conversation compacted"), no reply.
*   Chat compacts at the maximum threshold or after five idle minutes above the automatic threshold. The Assistant card sets Assistant thresholds. Each Project Manager uses the thresholds of its selected card.
*   A project node that makes a change shows a chat card with its inputs, account and target. Approve runs the action once. Reject dismisses it. Read-only nodes run directly.
*   The Assistant can change a project's name, base branch, services Compose path and Project Manager name and colour: a "Change project" card lists each change as "old → new" with Confirm and Reject, and nothing changes before Confirm. Sending a job or other frequent operations have no card. A deletion request shows the project and what will be removed in a card with Confirm and Reject. Confirm deletes <PE/CORE>'s data only, using the same operation as the project settings page.
*   "Ask the AI" (IE5) puts the cursor in the chat with the current screen's object as context.
*   Context chip: one at a time, a reference with its scope (for example "Job: Fix login timeout", "Recipe feature (project progetto-1)", "Template recipe feature"). It shows the object of the current screen and changes on navigation; pinning keeps it; removing it sends the next message with no context.
*   What the Assistant did (IB4) appears under its reply, never under the user's message. Actions that change something (create jobs, answer a job's question, add a node or recipe to a project, comment on a ticket) get a card that links to the job, definition or item to decide. A tool call the engine refuses (wrong input, a project outside the agent's reach) shows no card: the agent gets the error and retries, and when it cannot recover it explains the problem in its reply. When an agent offers choices it shows a form card instead of listing them: radio buttons for one answer, checkboxes for several, a text field for short values, and "Other" with its own field on every choice question; the recommended option carries a "Recommended" badge. Send stays disabled until every question has an answer; it posts the answers as the user's message. An answered form shows the answers; a form the user skipped by writing a message shows "Not answered". An order passed to a Project Manager gets a card with the Project Manager's avatar, "Order sent to Mara", the project name and a link "Open Mara's chat". Reads (projects, recipes, ticket, job status, job output, templates, definitions, definition check) become one grey line: "Read: projects, job status".
*   Agent questions (IB6) appear in the conversation with an answer field.
*   Replies to the user use the unread marker and a system notification when the window is not focused ("Assistant replied", "Shop: Project Manager replied").

### Projects

*   List: project name, assigned Project Manager's avatar and name, repo (or "local only"), base branch, jobs that need the user, failed jobs, warning when a login expired.
*   "New project" and "Import" appear next to each other. When there are no projects, both buttons appear in the empty state.
*   Like Templates and Settings, on the Projects list and on a project's page the sidebar shows a Projects section below the main items. Each entry shows the assigned Project Manager's avatar and the project name. The open project is highlighted.
*   The Jobs tab shows a "New job" button in the page header. It opens a dialog with Title, What to do and Recipe. Recipe is chosen by itself and locked when the project has one recipe; with none, the dialog says to add one in the Recipes tab. "Create job" creates it and closes the dialog; the job appears in the Jobs tab.
*   Project page, full width, in tabs:
    *   Jobs, the first tab and open by default: the project's jobs, in the same table as the Jobs page without the Project column.
    *   Settings and Recipes each use a panel aligned to the left. Knowledge uses the full width and height.
    *   Settings shows the fixed project ID and editable name, base branch, Project Manager, repository, folder and Compose file. The Project Manager's colour is chosen with the colour picker (the 24 agent colours, each named on hover, plus a custom colour from the system picker); a name or colour used by another project shows an error and blocks Save. Select an existing remote and its forge account, or choose "Local only" to disconnect it. Type a new path or use "Choose…" to move the checkout to an empty folder. The Compose path is relative to the project folder and can be picked there. Leave it empty for automatic detection.
    *   Knowledge is a file manager (IF4). On the left, the list of the project's Markdown files; New file (asks for the name; `.md` is added when missing) and Upload (several `.md` files at once; links to files that are not in the project are removed, keeping their text, and a dialog with only OK lists them by file). With no file open, the panel shows a blank sheet with the instructions centred on it. Select a file to show Rename and Delete file in the page toolbar. The confirmation lists the files whose links would break. Switching file with unsaved changes asks before discarding them. The Upload button and drag and drop both upload the selected Markdown files and open the first one. With unsaved edits, choose Save and open, Discard and open, or Cancel. The tab fills the window's height. When it is 640 px wide or less, the file list sits above the editor and scrolls after five rows. On the right, the selected file is shown as a plain sheet of paper with its file name centred above it, in the theme's control background colour with a soft shadow, with the app's normal font, wrapped lines, no rules, no line numbers and a 3 px cursor. CodeMirror gives Markdown highlighting, broken links underlined in red and formatting warnings in yellow while typing. Save is refused while a link points to a missing file; formatting warnings stay visible but do not block. All files are at the same level; a link to another file uses its bare name, for example `[naming](naming.md)`. The user can also ask the Project Manager or the Assistant to write or improve a file.
    *   Recipes shows the selected templates with links to their shared editors. Settings includes project variables that recipes can reference.
    *   Each tab's actions sit in the page header. Jobs has New job. Settings has Delete project (IF7), Export, Discard and Save. Variables has Discard and Save. Knowledge has New file, Upload and the open file's Rename, Delete file and Save. PM has Save.
*   No "Jobs of this project" button.

### New project wizard (full page)

Pages: Inputs and Create. Create runs the tasks of design.md "Project creation" in order; the project exists when Create ends.

1.  **Inputs:** name, repository, forge account, folder and base branch. The wizard assigns a unique Project Manager identity and uses the Default Agent card. The folder starts as the projects folder of Settings plus `<id>` and follows the name until edited. Add recipes after creation. Recipes that push or open a PR need a remote.
2.  **Create:** the tasks of "Project creation" (validation, project directory, clone or repo creation, `repo.git` setup and home check, access for `pecore-agent` in protected mode, commit), each with its state. A failed task undoes the tasks before it, says why, and returns to Inputs with the values kept. A repo created on the forge is never deleted by the undo: the page lists it as left on the forge.
3.  No logins page: logins belong to the user, not to the project (Settings > Accounts).

Cancel on Inputs discards the inputs; Cancel during Create undoes the tasks done.

### Import project (dialog)

*   "Choose archive…" and "Choose folder…" open native pickers for a local <PE/CORE> export or its extracted folder. The dialog shows a warning to review every script and prompt, findings, and which content the checks could review.
*   Map each required forge account to a local account. If only one fits, it is selected. A new project ID field appears only when the original is taken and starts with a free ID. "Import" imports the project and opens its page.
*   In chat, the Assistant shows the same warning, findings, coverage and account choices. "Confirm" imports and gives a link to the project. "Reject" dismisses the proposal. The Assistant can also review a shared project on its own.

### Export (dialog)

*   Export in project Settings offers "Include job history", then opens a native save dialog with `<project id>.tar.zst` in the system's downloads folder as the default. The history snapshot omits attempt logs. If the export finds possible secrets, the dialog lists them and offers "Export anyway". The dialog shows the saved path.
*   The Assistant accepts the same history option and saves to Downloads. It reports the path on success or shows each secret finding in a card with "Export anyway" and "Reject".

### Delete project (dialog)

*   Lists what is removed (design.md 4.8), including the project directory, workdirs, project database with its artifacts and logs, definitions and service containers. Remote branches and pull requests stay on the forge.
*   Disabled while a job of the project is running, with a link to stop them.

### Recipe editor

*   Edit a shared recipe in Templates. Duplicate opens a new copy with the same graph. In a project's Recipes tab, Add to project selects a template and Remove clears the selection.
*   Open a recipe from the project's Recipes tab and select an agent node to choose documents from that project's Knowledge. Save applies the selection to that project and step. The agent receives the selected and linked documents inline under their file names.
*   Drag nodes from the horizontal palette into the graph. Grab the palette and drag sideways to scroll. The field in its title bar filters names and tags. A node looks the same everywhere: the palette, the card dragged into the graph, the graph itself and the job graph use the Templates node card (large icon, two-line title, kind badge, kind-coloured left stripe). In the graph, the step name sits under the card when it differs from the template's. Start and End keep their green or red fill, border and centred label, in the card's size and rounded corners, with a left stripe in the same colour. Agent, Command and Human use distinct labels and colours in the palette, graph and inspector.
*   Hover over a card to reveal a drag handle on each side. Drag from a handle and drop anywhere on the destination card, including End. The router chooses both attachment points. They follow the relative positions of the cards and use another side if needed to avoid an obstacle.
*   The job page’s Request tab shows the full request and its attachments. Every node gets the request automatically.
*   Arrows update while a card moves. At 100% zoom parallel shafts aim for 27 px of visible gap away from their leads, with a minimum of 20 px in tight layouts and 10 px near a card. Ends enter and leave their cards on straight leads that aim for 34 px before the first bend. Arrowheads are 15 px wide and 18 px long. Crossings are allowed. A free facing side uses a centered port. Busy sides spread their ports apart. Release to snap to a free grid cell.
*   Labels sit on their own arrow or beside it. Their boxes avoid cards and other arrows and have at least 5 px of visible space between labels at 100% zoom. The stroke, arrowhead, labels and clearances scale with zoom.
*   Arrange places the flow from left to right with the base-change step below it. Success paths are green, failures red and other returns amber. The editor uses this arrangement when no positions are saved. Save records the card positions in `layout`.
*   Validation marks the node or edge at fault and uses the names shown on the cards. A missing input message names its source and identifies a base-change route when that is where the input is missing.
*   Start and End are always present and can be moved on the grid. Start uses the theme’s Success colour and End uses Fail. Start can connect from any side to the first step. Connect a step to any side of End and choose its outcome once. Success and Failure set the job result directly. For other outcomes, the dialog prefills a job result and lets the user change it.
*   Select an arrow and drag its destination handle to move it while keeping its outcome. When a named outcome moves to End, the dialog asks only for the job result. Drop the destination on empty canvas or press Delete or Backspace to remove the arrow.
*   For an agent step, Agent card selects Default Agent or another card from Agents. The step badge shows the selected card. Agent session offers Job, Node and New. Use template session clears the override.
*   Inspector for a node: read-only kind (and interface for a Human node), Reads from, `requires`, `skipWhenUnchanged` and `maxRounds` of its outgoing edges. Reads from is a multi-select of the recipe's steps with an info icon: the step receives their latest outputs; agents and people receive the job request and the job's changes. For a command it also lists the input types it takes, one read step each. Edit definition opens the shared node. Remove node removes the selected step, its arrows and references from the draft.
*   Clicking the empty canvas, Start or End shows Recipe settings in the inspector. Base-change step selects where a stopped or finished job restarts after a base change. Keep the current result clears that entry.
*   The recipe editor page does not scroll: the canvas and the inspector fill the height left under the palette, and the inspector scrolls inside its card under a fixed title.
*   Requires, Keep result after a clean rebase (`skipWhenUnchanged`) and Max rounds have an info icon that explains them. Max rounds starts at 0, which means no limit and shows "No limit" in the field; the arrows go down to 0.
*   Every field in the recipe inspector is as wide as the inspector, Max rounds included. The inspector takes 29% of the editor's width, at most 420 px.
*   Git Rebase appears in the graph as a Command node.
*   Add Wait for CI after the GitHub PR or GitLab merge request node. Connect `success` and `failure` in the graph.

### Node editor

*   Opened from a recipe or from Templates. New Node offers Agent, Command, Human and Repository. Repository shows an Account select and one shell script editor. A Human node has an Interface select: Decision, Code review or Report review.
*   Use Success and Failure for ordinary results. Add a named outcome when the recipe needs a distinct path, such as Changes requested. Decision outcomes can be literal answers.
*   Under the outcomes, Outputs has one row per outcome: a select of the seven node output types (Nothing by default). The engine generates Diff. No text under the field. The info icon of Outputs explains, for a user who knows nothing of the app, that a job is a chain of nodes, that each outcome can hand a result to later nodes, and that they receive it only through Reads from, with the Spec Writer as example. It then explains each type in a short paragraph: what it is, an example, who writes it and who uses it. The menus show only the names. The info icons of Required inputs and Optional inputs explain inputs with an example and show the same paragraphs. For a command, a row with an output also asks where to read it: Last line of the output, Field of JSON output or File in the workdir, and the name, field or path. For a Human node the rows are checkboxes, "<outcome>: the person can write a note".
*   Every select in the app opens its menu below the field, or above it when there is no room below, so the whole list is visible; it does not cover the field.
*   A command shows Required inputs and Optional inputs as chip groups of the eight artifact contracts. Selecting a type in one group removes it from the other. The help says the recipe selects each source and the script reads a JSON object on stdin, for example `jq '.spec'`. Agents get labelled inputs inline in their prompts. Human review loads them from the project database.
*   The node fields and its prompt or script are in one card. Node Context uses the Knowledge Markdown editor. The app manages the prompt name. Scripts use the code editor. Both save in the template catalog.
*   Agent templates use Default Agent and expose Agent session. Job is the default. Node gives the agent a session for repeated runs of the same step within the job. New starts a fresh session on each run. Both editors explain all three options in the info popover. Can edit files controls whether a node may change the job's files.
*   Creating and editing show the same fields. Description and Icon have no info popover. A command is one line written as in a terminal (`npx --no-install eslint .`, quotes around an argument with spaces); a command node shows Command or Script file, whichever it uses. Commands receive no Git hosting or tracker credentials from the app.
*   Validation errors next to the field. Save is disabled while the draft is invalid. The draft lives in memory until saved or discarded; leaving the page with an unsaved draft asks first.
*   In protected mode, a Repository node that needs review shows To approve. Approve opens the saved script and checks. Saving a node as the user authorizes the saved version. In normal mode the editor has no approval control.
*   Repository lists Git hosting accounts from Settings. Shipped Repository templates select Project account. Their repeat and merge checks run behind the scenes.
*   Agent nodes offer Tracker: None, Read, or Read and write. Selecting access shows Tracker account. Project account follows the choice in the project's Settings. Configured accounts are managed in Settings > Accounts. The Project Manager's chat asks the user to approve a tracker write.
*   Node cards and the node kind menu use Agent, Command, Human and Repository.
*   Save in the page header writes the changed node fields and prompt or script.
*   Saved changes affect new jobs. Existing jobs keep their saved definitions.

### Templates

*   Separate tabs for node templates and recipe templates.
*   Like Settings, the sidebar also shows a Templates section below the main items with Nodes and Recipes, which open the same tabs. The tabs stay for the collapsed menu.
*   Each tab explains what its templates do and has a New Node or New Recipe button that opens the editor.
*   Delete node and Delete recipe are in the template editor and ask for confirmation. Delete node is disabled while the node is in use. Its tooltip lists the references. Deleting a node preserves its saved prompt and script bodies.
*   Entries form a grid that adds columns as space allows. Each entry pairs a square card with its description. The card shows a large icon above a title such as Cargo Check. The title always has room for two lines, so the icon sits at the same height on every card; a one-line title is centred in that space. Node and recipe names are at most 24 characters, so the title fits. Hovering anywhere on the entry highlights it. Clicking it opens the editor. The page scrolls with the full grid.
*   An agent node's badge shows the name and colour of its agent card. It fits on one line, truncates long names with an ellipsis and shows the full name on hover.
*   Select tags from the node templates. Each selected tag appears in the filter and can be removed. Selecting `github` and `source control` shows templates with both tags.
*   The automatic icon uses `node-<name>.svg` or `recipe-<name>.svg` from the shared library, with a built-in default. The editor can select another icon from a grid that shows the icons themselves, with the name as a tooltip. The Assistant saves new SVGs under `templates/icons/`. It mentions icons only while creating or editing a node or recipe template, or when the user asks for one.

### Agents

*   Vertical cards in a responsive grid. The title reserves two lines and truncates longer names. Each card shows the harness badge, provider, model, effort and both context thresholds. Default Agent starts with the Agent badge colour. Assistant and new custom cards start white. Each card has its own colour setting in the editor.
*   You can create a card before connecting a provider. When no provider is available, Provider shows Unavailable and Provider, Model and Effort are disabled.
*   Delete agent is in the editor and uses the same style as Delete project.
*   Custom context in the agent and project manager editors shows ten lines and scrolls when the text is longer. Each agent's Markdown context saves in the global database.

### Settings

*   Sections: You, Accounts (IG1), Protected mode (IF6), Projects, Limits and disk threshold, Services runtime, Merge check interval (IG3), Updates (IG7), Appearance (IG9).
*   The section list is in the main sidebar. Sections adapt to the window width, and each has a one-line description under its title.
*   No text or JSON editing and no user-typed IDs; raw validation errors are never shown.
*   A valid change saves in the global database after the last keystroke or when the page is left. An invalid value shows an error and stays unsaved.
*   Accounts shows AI tools, Git hosting and Trackers. Each panel header shows its buttons at the right end, with the Check button last; it re-checks all logins of the group. Each pending provider shows Checking in its own row. Discovered accounts appear as soon as their provider finishes, and the other settings stay usable.
    *   Trackers lists one row per tracker account with its name, site and login state. A Jira login from the Atlassian CLI appears on its own and shares the Jira row. Check also looks for a Jira CLI login. Add account asks which tracker and starts browser sign-in. The app chooses the CLI or the MCP bridge; the user never sees the choice. A chat action that needs sign-in links to Accounts.
    *   AI tools: every supported harness has a row, even without an account. A row shows the tool, the account, its state and Log in only when needed. A working account shows "Logged in", OpenCode, Pi and a private Git server included. Without an account, the row says Not installed, Logged out or No models, and offers Log in when the harness is installed; logging in from the row creates its account, and Check then shows "Logged in". OpenCode and Pi are logged in when they list at least one model; with none, the row says to set up a model provider in the harness. Pi opens its own interactive login, where the user picks the provider, from the row or the setup banner. Each AI tool has a colour, shown on its row's initials, and a Colour button opens the colour picker; the choice is saved at once, and Reset restores the tool's default colour. Defaults: Claude Code terracotta, Codex light grey `#EEF1F2`, OpenCode blue `#5D9BEA`, Pi amber `#F59E0B`. "Show unavailable" in the card header shows, and "Hide unavailable" hides again, the supported tools without an account and the tools not supported yet; they are hidden when the page opens. Shown, greyed rows "Coming soon" list the tools not supported yet (Antigravity CLI, GitHub Copilot CLI, DeepSeek, Grok), each with its colour and Colour button and no other action.
    *   Git hosting lists discovered accounts and offers Add account. GitHub and GitLab show Server with the public host as the default. Adding one starts login and saves the username on success. CodeCommit shows AWS profile, initially `default`. Private Git requires Server and uses the user's Git credentials. Commit author name and email start with the app user's global Git settings or stay blank. Edit opens the account's settings, including its username and commit author.
*   You: "Your name", empty by default. The Assistant and the Project Managers get it at the start of a conversation; when it is empty the Assistant asks for it in the chat and saves it here.
*   Assistant settings offer the provider, model and effort from the harness and the automatic and maximum compaction thresholds (131,072 and 262,144 tokens by default). Both are selects, not number fields: "Compact when idle above" offers 64K, 128K, 256K and 512K tokens (1K = 1,024); "Compact at once above" offers 128K, 256K, 512K and 1024K, only those at least twice the idle threshold, and rises with it when the idle threshold grows.
*   Project Manager: Provider, Model and Effort selects, by default "Same as the Assistant", and its own pair of compaction thresholds with the same defaults.
*   In both pickers Effort is locked until a model is chosen and lists only the levels that model offers, Default alone when it offers none; choosing another model resets it to Default. The model list is read once when the app starts, and each model's levels the first time they are needed; a small refresh button next to Model reads both again.
*   Services runtime starts as None and fills itself at app start when Docker (or OrbStack, Colima) or Podman is running; the user can still change it.
*   Projects: "Projects folder", typed by hand or picked with "Choose…", default the user's home (`~`). A new project's folder starts as this folder plus the project id, in the wizard and in the chat.
*   Protected mode (IF6): one switch with a short explanation (agents cannot read your files and logins; one login per harness account for `pecore-agent`; agents can read all `pecore-agent` logins). Turning it on opens the admin prompt; if it cannot (no polkit agent), the page shows the exact script with a Copy button and "I ran it, recheck". Then the page lists each model account with a Login button for `pecore-agent`, showing the URL or code. Turning it off asks whether to also remove `pecore-agent`.
*   Diagnostics, with the description "Checks that the tools <PE/CORE> needs are installed and that your <PE/CORE> data folder is private to you.": "Recheck prerequisites", with a link to the setting each failed check points to, and "Recheck permissions". When the data folder is private, the last line reads "Only you can read your <PE/CORE> data folder." with a green check, like the tools above it.

### Zero-config start (replaces the first run checklist)

Goal: minimum friction. The user opens <PE/CORE> and it works, with no setting to fill and no file to edit.

*   No location window: `PECORE_HOME` is `~/.pecore` unless a location is already stored. Moving it from Settings is a later feature.
*   No first run screen and no `firstRunDone`. The app opens on Factory, with the Assistant chat on the right and the cursor in its message box.
*   [Auto-setup](design.md#auto-setup) discovers harnesses and existing logins on startup. It fills internal accounts, profiles and tiers as needed and chooses an Assistant model when none is set. The Project Manager follows that choice by default.
*   When no harness is installed and logged in, a banner on every page says so, with the install link of each supported harness and a Log in button for the installed ones. Nothing is disabled that can work without it.
*   git stays required, because jobs work on the projects' git repositories: without it the app shows an error with the install instruction. Other missing prerequisites (Compose, gh, glab) are warnings on the feature that needs them, as in "Missing configuration and warnings" below, never a blocking step.

## Cross-cutting behaviour

### Page layout rules

Every page follows these rules; an exception is written in that page's section.

1.  Saving: work definitions (nodes, recipes, knowledge files, project settings, variables and a project's Project Manager) have an explicit Save at the top right of the page title, disabled until something changes; leaving with unsaved changes asks first. App preferences (Settings) save by themselves.
2.  Actions: the page's main action sits at the top right of the title, primary style with an icon ("New job", "New Node"). Every other action is secondary. A project tab puts its actions in the same place.
3.  Width and height: pages use the whole content column. Forms and wizards (New project) are narrow and centred, with their buttons at the bottom. Only editors with a work area fill the window height: the recipe editor and Knowledge.
4.  One place: each setting is changed on one page; other pages show it read-only with a link to that page.
5.  Controls: only design-system components (text fields, selects, checkboxes, switches); no native browser controls. A colour is chosen with the design system's colour picker, whose custom colour opens the system picker.

### Empty, loading and disconnected states

*   Empty lists show the next action. Projects offers New project and Import. An empty Notifications page says "Nothing new".
*   Loading: lists keep their layout with placeholder rows; no spinners over the whole screen. A field whose options are loading shows a spinner and a "Reading…" text and never looks disabled.

### Controls

*   Every control comes from the design system in `packages/app/src/renderer/ds/`. The Showcase page (menu item Showcase; also `pnpm showcase` in a browser, without the engine) is the design system's reference for people and coding agents: its rules, every colour, text and size token with its use, the icons, cards and panels, and every component, with a theme preview (App, Light, Dark and each built-in theme) that is restored on leaving the page. Its source is `src/renderer/gallery/`. Read it before any UI change; a new or changed component or token is added there in the same commit.
*   One component per kind: `Button` (with `variant="link"` for a link in text or a table), `List` and `ListItem` for a list to pick from, `Chip` for an on/off tag, `Card`, `Dialog`, `EmptyState`, `Alert`, `Table` or `TextTable`, `Details`. Screens have no native buttons or inputs.
*   A select and a combobox look the same: same arrow, no clear button. A focused field shows one focus ring.
*   Engine or WebSocket disconnected: a banner "Disconnected, reconnecting", every control disabled, data marked stale. On reconnect the GUI refetches every open view.

### Missing configuration and warnings

*   A function whose requirements are missing is disabled, with a message that says what is missing and a link to where it is set ("No forge account: add one in Settings > Accounts").
*   A missing or expired login is a notification and a warning on the project or account, never a blocking dialog.
*   The shell shows a warning when the home check finds exposed login files.
*   Identity mismatch (design.md 3.4): a warning on the account; jobs that use it wait with reason `auth` until the user logs in with the right account and presses "Recheck login".

### Concurrent edits

*   Editors load each file with its hash and save with it (design.md "Local API"). When `definition.changed` reports a change to an open file (for example by the Assistant), the editor shows "Changed elsewhere: reload, compare, keep mine". Keep mine saves over the new version only after the compare view.

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
| the outcome | `completed`, any other outcome (`changes_requested`, `rebase_conflict`) | no status color |

Color is never the only signal: every state also has an icon and its label.

## Color tokens

| Token | Use |
|---|---|
| `bg` | page background |
| `surface`, `surface-raised` | panels, cards; `surface-raised` is `control-bg` |
| `separator`, `border` | lines and card outlines; `border` is `separator` |
| `text`, `text-2` (`text-muted`) | text; at least 4.5:1 on `bg` and `surface` |
| `text-3` | hints, placeholders, inactive states; at least 3:1 on `bg` and `surface` |
| `accent`, `accent-hover` | focus, links, highlighted text; at least 4.5:1 on `bg` and `surface` |
| `accent-fill`, `accent-fill-hover`, `on-accent` | solid fills (primary buttons, chat bubbles, selected items) and the text on them; `on-accent` at least 4.5:1 on both fills |
| `fill`, `fill-strong` | hover and selected backgrounds; at least 1.12:1 against both `bg` and `surface`, so hover is visible everywhere |
| `control-bg`, `control-border`, `control-border-hover` | fields and secondary buttons; the border at least 1.4:1 against `control-bg` |
| `success` (`status-success`) | success, success outcomes |
| `danger` (`status-failed`) | failed, fail outcomes, validation errors |
| `warning` (`status-warning`) | needs you, waiting, queued, items to decide |
| `status-running` | running; it is `accent` |
| `status-inactive` | paused, stopped, not delivered, pending, skipped, disabled controls; it is `text-3` |

`success`, `danger` and `warning` are also used as text, so they need at least 4.5:1 on `surface` in every theme.

## Size tokens

Every size lives in `ds/tokens.css`; components use only these variables, never a written number for text, control, row or icon size. The scale follows Claude web for readability.

| Token | Value | Use |
|---|---|---|
| `--text-size-sm`, base `--text-size`, `-md`, `-lg`, `-xl` | 14, 15, 16, 18, 26 px | captions, badges, table headers, secondary text, chat messages and the chat input, logs and code; body and controls; emphasis; section and dialog titles; page titles. No text is smaller than 14 px: no `xs` size, no text shrunk with `scale`, and third-party defaults (graph nodes and labels, `<small>`) are set to `--text-size-sm` |
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
| UI2b | Withdrawn: the Assistant chat is always on the right of every screen, with no page of its own. |
| UI3 | Surfaces and backgrounds use the chosen theme's tokens. |
| UI4 | Themes: every color is a CSS variable. Settings > Appearance has a mode (System, Light, Dark) and one theme; the mode picks the theme's light or dark version, and System follows the operating system. Shipped: Default, Autumn, Spring, Woodlands, Summer, Winter and Monochrome, each in a light and a dark version, as variable blocks in `ds/tokens.css`. Woodlands is the summer version of Everforest, with a warm yellow background glow; Summer has sand tones, sky-blue accents and an orange background glow; both keep a coloured background with cards, sidebar and controls almost neutral, as Autumn, Spring and Winter do. |
| UI5 | Page content uses a themed background with a soft moving glow. The shell honours reduced motion. |
| UI6 | A running node pulses. Reduced motion disables the pulse. Show state, duration, round and attempts without a progress percentage. |
| UI7 | Components: Base UI (unstyled, behaviour and accessibility); styles: CSS Modules with the theme's CSS variables. |
| UI7b | Libraries: React Flow (recipe graphs), CodeMirror 6 (editors), `@tanstack/react-virtual` (long lists and logs), `cmdk` (command palette). |
| UI8 | The job list has no model or harness columns; those are details of a node run. |
| UI9 | Stacked jobs are a tree of indented rows in the job lists. Graphs show recipes only. |
| UI11 | Every value shown comes from engine state, an artifact, a persisted definition, or a deterministic computation on these. A value with no source is shown as missing; the UI never asks an LLM to fill it. |
| UI12 | Factory shows only what needs the user and the state of unfinished work. Every other function is one navigation click away. |
| UI13 | Jobs has its own project filter. The top bar has no project filter. |
| UI14 | Chat context contains references to the selected item (design.md section 6). |
| UI15a | Closing the window keeps jobs running in the tray. |
| UI15b | Quit asks for confirmation and shows how many jobs it interrupts. |
| UI15c | After a restart, Factory shows "Play interrupted jobs" for jobs paused with reason `quit`. |
| UI15d | Every job control has a tooltip that says what it does (Job controls table). |
| UI16 | Status colors keep fixed meanings in every theme: green success, red failure, yellow warning, grey inactive, light blue running. A theme may change their shades. All other colors, the accent included, are free for the theme. |
| UI18 | A decision on an item to decide approves the snapshot the user saw, identified by its hash; a changed item cannot be approved. |
| UI19 | Delete of a job or project is local only and asks for confirmation; Stop needs none. |

## Alternatives Considered

| Option | Status | Reason | What is lost |
|---|---|---|---|
| Chat as the home screen | Rejected (author) | The home must show what needs the user; the chat is reached from every screen through the mini chat | A chat-first flow |
| Chat only on its own page (UI2b) | Rejected (author) | Asking about the open job or recipe needs the chat next to it | Simpler layout |
| shadcn/ui and Tailwind (UI7) | Rejected (author) | shadcn copies styled components into the code base and Tailwind replaces CSS variables with utility classes; the author wants themes as CSS variable tokens and plain CSS Modules | Ready-made styled components |
| A separate graph of stacked jobs (UI9) | Rejected (author) | A job has at most one parent, so stacks are trees; indented rows show them without a second graph view | A visual map of large stacks |
| Automatic layout only for recipes | Rejected (author) | Nodes are placed and connected by hand; positions must stay where the user put them | Nothing in the engine: `layout` is ignored by it |
| Tool logins (`gh`, `glab`) run by the user in a terminal | Rejected | design.md G16 allows only one terminal step (manual creation of the protected user) | Nothing |
| Delete runs a cleanup on the forge | Rejected (author) | Delete must not act on remote resources | Remote branches and PRs stay until closed on the forge |
| Progress percentages for agent nodes (UI6) | Rejected | No harness reports progress; a percentage would be invented | A progress bar |

## Risks & Limits

| Risk | Impact | Mitigation | Where |
|---|---|---|---|
| Untrusted text (tickets, agent output, logs) rendered in the GUI | script injection in the renderer | Markdown rendered without raw HTML; logs as text; no `dangerouslySetInnerHTML` | Job view, Notifications |
| Engine crash or WebSocket drop | stale states look live | disconnected banner, controls disabled, refetch on reconnect | Cross-cutting behaviour |
| Many running agents streaming logs | renderer overload | log streaming only for the open attempt; updates once per frame; virtual lists | Job view, Updates |
| Very large diffs (thousands of lines) | slow diff view | files rendered 30 at a time, each collapsible, risky hunks first | Notifications ID1, artifact viewer |
| Editor and Assistant write the same file | one change silently lost | save with the file hash; changed-elsewhere banner | Concurrent edits |
| Custom theme with invalid colours | unreadable UI | schema validation, fallback tokens, contrast rules | UI4, Color tokens |
| Normal mode: agents run as the app user | agents read the user's files and logins | Settings shows the mode and offers protected mode in one step | Settings |

### Limits

*   One window, one user, one machine (design.md "Risks & Limits").
*   English only.
*   "Merged" is shown only for succeeded jobs with children (design.md 4.6).
*   Recipe positions are kept only in the recipe file; a recipe written without `layout` is laid out automatically once.
