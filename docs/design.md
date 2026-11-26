# <PE/CORE>

*   **Author:** Antonio Colagreco
*   **Status:** Current product and engineering design. Earlier reviews apply to the [original design](orginal_design.md).
*   **Date:** 2026-11-18
*   **Replaces:** [original design](orginal_design.md).
*   **Maintenance:** Update this design and [ui-design.md](ui-design.md) together when a product decision changes the UI.
*   Follow the [repository workflow](repository-workflow.md) for branches, commits and pull requests.
*   **Inputs:** [Concepts brief](archive/concepts-brief.md) and [initial design](archive/initial-brainstorm.md). References to Dn name decisions in the concepts brief.
*   **Changes to the brief's decisions:** see [Changes from the Concepts Brief](#changes-from-the-concepts-brief).

Naming rule: "<PE/CORE>" in prose. Use `pecore` for the command, packages and file names, and `PECORE_HOME` for the environment variable.

The name the user reads lives in one place: `appName` in `packages/schemas/src/app.ts`, used by the app, the engine, the Assistant's instructions and the CLI. Packaging repeats it in `packages/app/package.json` (`productName`) and `packages/app/electron-builder.yml`. Renaming the app changes those three files and the prose in `docs/`. `pecore` in commands, packages, folders, OS users and `PECORE_*` variables is an internal name the user does not read, and stays.

The name stands for Product Engineering Core. The core is designed to support plugins. The mascot is a sheep. The Assistant's and Project Managers' instructions say so.

The app is in development when it runs from source (Electron `app.isPackaged` false) and in production when installed from a package. The main process passes `PECORE_STAGE=dev` or `prod` to the engine (`EngineOptions.development`). In development every agent is told, in its instructions (Assistant, Project Managers) or in its node prompt (a "Development" section after the template), that the app is under active development and that many requests test its features. The model-based review of shared projects does not get it. The Apache License 2.0 grants patent rights and covers contributions. The distribution includes `NOTICE`. The licence does not grant rights to the product name or logo.

Terms used throughout:

*   **Harness:** a vendor's own agent program (Claude Code, Codex, opencode, ...), installed and logged in by the user.
*   **ACP:** Agent Client Protocol, an open protocol between a client and a coding agent: JSON-RPC 2.0 over the agent's stdin and stdout. Zed uses it for its external agents. <PE/CORE> is an ACP client.
*   **Connector:** the program <PE/CORE> starts to talk ACP with a harness: the harness itself in ACP mode (for example `opencode acp`), or an ACP adapter that drives the harness (for example `claude-agent-acp` for Claude Code). A connector file (section 5) describes how to start it.
*   **Forge:** a git hosting service (GitHub, GitLab, Bitbucket, AWS CodeCommit, a private git server).
*   **App user:** the OS user that runs <PE/CORE>.
*   **Project user:** the OS user agents and checks run as. In normal mode (the default) it is the app user, as when the user runs Claude Code or Codex by hand. In protected mode it is `pecore-agent`, one OS user created by <PE/CORE> for all projects, the Assistant and the Project Managers, which cannot read the app user's files and logins (section 8).
*   **Workdir:** the job's git worktree, `work/<job-id>/`. "Work tree" appears only in git command contexts.
*   **Base branch** (a branch name, for example `dev`) and **base commit** (the commit a job branch starts from, `{job.base}`).

--------------------------------------------------------------------------------

## Overview

<PE/CORE> is an open source software factory. Each project's Project Manager turns chat orders and tickets from linked projects into jobs. The Assistant manages projects and templates, and passes project orders to the Project Managers. Jobs deliver according to their recipe, for example as a GitHub pull request, a GitLab merge request, a pushed branch on a private Git server or a local commit.

An engine written in TypeScript runs the jobs. It executes recipes. A recipe is a graph of nodes and edges. Every operation on the code or on the outside world is a node: an agent with a role, a check, a human review, a commit, a rebase, a push, a pull request. Models do the work inside agent nodes; code decides transitions, retries, limits and the order of operations.

The engine contains no language-specific or forge-specific code. A toolchain (Rust, Go, TypeScript, ...) is supported by adding nodes that call its commands. A forge is supported by adding nodes that call its commands or API.

Nodes and recipes live in Templates. Each project selects recipes and supplies values for their steps. The user can edit templates or ask the Assistant to do it.

Agent nodes run the original harness programs and talk to them through ACP: Claude Code (through the `claude-agent-acp` adapter), Codex (`codex-acp`), opencode (`opencode acp`), pi (through the `pi-acp` adapter), and any other harness with an ACP mode or adapter, such as GitHub Copilot CLI or Gemini CLI. Each harness uses its own login and subscription. One job can use models from several providers. Claude Code is the first connector built; the others follow (Build order).

<PE/CORE> is an Electron desktop app. A Node engine process starts harnesses and commands. Closing the window keeps jobs running in the system tray. Quitting warns about interrupted jobs and stops the engine, its child processes and job service containers (4.9). The GUI provides the Assistant, editors, live job views, project settings and account logins. The CLI uses the same local API while the app is open.

A project is self-contained: one directory holds its definitions, the history of its jobs, its artifacts and logs. A project can be exported and shared on its own.

<PE/CORE> runs on Linux and macOS, on one machine at a time. Today its only user is the author; later it will be published for public use.

## Problem Statement

The author wants to hand off software work and get a finished result back: a fix for a bug in a web app, a feature, or a new product such as a game for Linux and macOS. He does not want to write the code, and he wants several tasks running at the same time, using models from different providers.

The [initial comparison](archive/initial-brainstorm.md) and the [concepts brief](archive/concepts-brief.md) describe the alternatives available during design:

*   Cockpit tools (Herdr, emdash, Claude Squad, T3 Code) run several agents, but the user drives each one. There is no pipeline, no gate and no recovery after a restart.
*   Issue-to-PR services (Copilot coding agent, Codex cloud, Claude Code GitHub Action) are each tied to one vendor's agent and run on the vendor's infrastructure.
*   zazencodes software-factory v2 has a pipeline, but uses one provider, lets an LLM drive the state, and has no isolation.

What none of them offers together:

1.  Several providers in one pipeline, through their original harnesses and subscriptions.
2.  A pipeline the user builds from nodes, where every step, including commit and delivery, can be customised.
3.  Checks run by code, bound to the exact content they checked.
4.  Parallel jobs across several projects, with waits on quotas and limits instead of failures.
5.  An engine with no built-in language or forge, extended by data, not by code.
6.  Job scheduling, state, workdirs and checks on the user's own machine; only model calls, agents' own network use and deliveries leave it.

## Goals

*   **G1. Order to delivered result.** An order (chat text, a link, an image, or a ticket reference) becomes one or more jobs. Each job ends with the outcome of its last node (for example an open PR, a pushed branch, a local commit), with a failure reason from a fixed list (4.3) shown to the user, or because the user stopped it.
*   **G2. No built-in language.** Support for a new language or toolchain needs only new node templates, with no change to engine code. Verified by running the same recipe shape on a TypeScript project and on a Rust project, with different check nodes.
*   **G3. No built-in forge.** Support for a new delivery target needs only new node templates. Verified by delivering the same job to GitHub, to GitLab, and to the local repo only, changing only the delivery nodes.
*   **G4. Every operation is a node.** Agents, checks, human reviews, commit, rebase, push and PR/MR are nodes. A recipe can put a human review before the commit node. The engine handles only workdirs, job branches, and clone and fetch of the project's remote with the project's account: it creates workdirs and branches when a job needs them, removes workdirs when the job ends `succeeded` or `not_delivered` (or, for a failed or stopped job, when it is archived or deleted) and branches when the job is deleted.
*   **G5. Shared templates.** Templates holds node and recipe definitions. A project saves its chosen recipe names, variables and account bindings. A job saves the recipe, node definitions, prompt and script contents, and their hashes at creation. Saving a template affects jobs created after the save.
*   **G6. Several providers at once.** One job can run agents from at least three different harnesses (for example Claude Code builder, Codex reviewer, opencode with a DeepSeek model for tests). Verified by an end-to-end test of the `feature` recipe with three harnesses.
*   **G7. Parallel jobs with waits, not failures.** The number of parallel jobs and agents is configuration. A job that hits a quota, rate limit, concurrency limit, network outage or expired login enters a visible waiting state with a reason from a fixed list (4.3), and resumes when the cause clears. It does not fail for those reasons. Verified per built-in connector with recorded ACP traffic of quota, rate limit and auth errors (section 5).
*   **G8. Self-contained projects.** A project directory holds definitions, knowledge and a database with job history, artifacts and logs. The GUI, Assistant and CLI can share a project without its clone or workdirs. History is optional. Only the CLI can explicitly include attempt logs (section 8). A project can link one remote and one account. The engine uses that account and the configured node to create a new remote.
*   **G9. Stacked jobs.** An order larger than one ticket becomes a set of tickets with dependencies. A child ticket starts from its parent's last commit when the parent job completes, without waiting for the parent's merge. When the parent changes, the recipe's rebase node realigns the child, and the recipe decides which nodes run again. Verified by a test with a chain of three jobs in which the parent gets a new commit and then is merged.
*   **G10. No secrets kept by <PE/CORE>.** Each tool keeps its own login: harnesses (`claude`, `codex`, `agy`, ...), forge CLIs (`gh`, `glab`, AWS CLI) and git credential helpers. <PE/CORE> stores only references to those accounts. In protected mode, agents cannot read the app user's home, where forge logins live.
*   **G11. Rules live in recipes.** Recipes define checks, reviews, model selection and what runs again after a rebase. A recipe can include a human review. The empty recipe is valid.
*   **G12. Crash safety.** After a crash, or after the app quits during a delivery, no shipped delivery node repeats an action its repeat check reports as done, and every job that existed before is present afterwards: `queued` jobs stay `queued`, the others are `paused` or in a final state. Verified by killing the engine during each delivery node in a test.
*   **G13. Diagnosis in under a minute.** For any job, the user can see in the GUI or the CLI which node is running, why the job waits, and open the raw harness log, in under one minute.
*   **G14. Zero configuration.** First launch creates `PECORE_HOME`, finds existing harness logins and sets up accounts, profiles, tiers and the Assistant and Default Agent cards. When no account works, the app shows the next step to connect one.
*   **G15. Pluggable services runtime.** The container runtime for job services (Postgres, Kafka) is a setting: Podman, Docker, or on macOS Podman machine, Colima or OrbStack. Each needs Compose v2. When the setting is empty, the app looks for a runtime at start, in the background: Docker with Compose and a running daemon (named OrbStack or Colima when the Docker context says so), then Podman. It saves the first one found and tells the user in a notification; it never changes a runtime the user chose.
*   **G16. GUI first.** Every feature is usable from the React GUI; the only terminal step is the manual fallback for creating the protected user (CUJ 6). The GUI covers chat, recipe graph editor with drag and drop, live job graph with node state and logs one click away, template and instance editors with AI assistance, settings, account and harness logins. Harness logins for the protected user run from the GUI, which shows the harness's login URL or code.
*   **G17. Job controls.**
    *   Global pause and play. Per job: stop, pause, play, resume, realign, archive, delete. Global pause also keeps the scheduler from starting queued jobs.
    *   Stop and closing the app terminate all running processes (`SIGTERM`, then `SIGKILL` after 5 seconds).
    *   Pause waits for the running node to finish, then holds. On app start, interrupted jobs are paused until the user presses play.
    *   Resume restarts a `failed` or `stopped` job from the node that failed or was stopped, in the same workdir.
    *   Delete is allowed on a job in a final state (`succeeded`, `not_delivered`, `failed`, `stopped`) with no live children (4.6). It removes only local resources: the workdir, artifacts, logs, the local branch and the job's history. Nothing on the forge is touched: remote branches and open PRs/MRs stay; the project itself is untouched.
    *   Archive hides a job in a final state and keeps its history, branches and PR/MR.
*   **G18. Agents can do what the user does.** Every operation the user can do in the GUI or CLI can also be ordered in chat and done by an agent: the Assistant for what is global and for projects themselves, the project's Project Manager for the project's work (section 6). Important changes keep their confirmation card.

## Non-Goals

*   **Automatic merge.** A job delivers; a human merges (D2). Auto-merge may be added in a later design.
*   **Windows**, as host or as product target.
*   **iOS, Android and console** targets.
*   **Deploy** to any environment.
*   **Agents in containers.** Agents run on the host as an OS user (D9). Containers are used only for services a job's tests need (Postgres, Kafka).
*   **Network control per node.** Agents have the network access of their OS user.
*   **Checking the behaviour of new nodes** beyond schema validation.
*   **Several machines** running the same `PECORE_HOME` at the same time.
*   **Several human users** on one app, or a hosted service.
*   **A message broker.** Events live in SQLite.
*   **Parallel work inside one job.** The rule is in 4.5; several workdirs per job is a possible later evolution.
*   **Storing credentials.** Every login stays in the tool that owns it (D27).

## Open Questions

Each question must be answered before the build phase named in brackets (see Build order).

*   **Second full review, findings for later phases:** listed as entry gates under Build order.

*   **Quota and rate limit errors:** not provoked in any spike. Claude Code reports its quota windows on every turn (`_claude/rateLimit`), and a `rejected` window is handled by 5.4; what else an exhausted window sends, and what Codex, opencode and pi send, is recorded the first time it happens, or by using up a 5-hour window on purpose (author's choice). Until then an unrecorded error message ends as `HARNESS_ERROR` with the node's `retry` (5.4). [Phase 3 for Claude Code, phase 6 for the others]
*   **Connector values for Codex and opencode:** Codex offers mode `agent-full-access` and option `reasoning_effort` in the recorded traffic. Answered on 2026-11-19 (`test/e2e/providers.test.ts` with `PECORE_REAL=1`): `CODEX_PATH` points `codex-acp` at the installed Codex (without it the adapter looks for the optional platform package that the build omits); with the user's existing logins Codex reports `logged_in`, the email and the plan, and lists its models and efforts. OpenCode now uses `opencode models` to discover models and check readiness; one agent node ran to its outcome through each, with tokens recorded. Still open: Codex account notification without a login, usage when resuming, the opencode config directory, and permission requests in practice. [Phase 6]
*   **Harness login storage:** answered for Claude Code and Codex on macOS ([spike report](spikes/macos-keychain.md)) and Linux ([Linux spike](spikes/linux-harnesses.md)). Still open: opencode and pi; Antigravity, which keeps its login in the desktop keyring and cannot run as a project user. [Phase 6]
*   **Agent assignment in recipes:** all agent nodes currently use Default Agent. Selecting a card per recipe step is open.
*   **More connectors after phase 6:** Antigravity (agy) through OpenRouter or its own login, and other harnesses with an ACP mode or adapter. Each needs a connector file, a reader and recorded fixtures, with no engine change (G2, 5.6). pi is supported after phase 6 through the `pi-acp` adapter ([decisions.md](decisions.md), 2026-11-26); its login is pi's own interactive login, where the user chooses the provider. Recorded for opencode on 2026-11-19: an exhausted free model answers `session/prompt` with `-32603` "Free usage limit reached" (`errorName` `provider.free-limit`), classified as quota by a rule in `opencode.json`. The connector sets `OPENCODE_DISABLE_CLAUDE_CODE=1`, so opencode does not read Claude Code's `~/.claude/CLAUDE.md` and skills.
*   **Notification channel** outside the app (v0.5 Q2). [Phase 6]

*   **Node redesign:** Consider discovering routine checks such as clippy, typecheck and tests from the repository.
*   **Templates redesign:** Consider a recipe catalogue with nodes browsed only in the recipe editor.

## Product interface

Keep friction low. Use defaults and show only what the user needs to understand, decide or act. Users can create, import and export projects from the GUI or the Assistant. [Screen details](ui-design.md)

### Shell and navigation

The app fits a 1024×720 window. The sidebar stays on the left, the page in the centre and the Assistant on the right. The sidebar lists Factory, Projects, Jobs, Notifications, Templates, Agents and Settings. It collapses to an icon rail with tooltips. The list has no group headings. Page sub-navigation sits below the main items. Drag the chat's left edge or use the arrow keys on that edge to resize it.

Tables, lists and graphs use the full width. Standalone forms and reading pages have a centred maximum width. A form inside a full-width page keeps its maximum width and aligns left. The top bar has global search and pause or play. Project filtering belongs on the pages that support it. The sidebar has no engine status line. The disconnected banner tells the user when the engine is unavailable.

Back and Forward restore how the user left each visit: filters, search, selected tab, expanded sections and scroll. Both work from the keyboard and mouse side buttons. Opening the same page again starts a separate visit.

### Settings and accounts

Settings lists its sections in the main sidebar. Fields adapt to the window width and every section has a one-line description, including Accounts. Changes save automatically once valid. Invalid values get a readable message and stay unsaved, including a provider choice without a model. The GUI uses form controls without raw JSON, manually entered IDs or raw validation errors.

Accounts shows every supported harness automatically, even without an account. A row shows the identity when available, a visible Check button and Log in only when needed. Without an account it says Not installed, Logged out or No models, and offers Log in when the harness is installed. Show unavailable reveals these rows and Hide unavailable hides them again. Working accounts show “Logged in”, including OpenCode, pi and private Git servers. OpenCode and pi are working if they list models. With none they show “No models”. General Git hosting copy is service-neutral. An account row and the service picker identify the actual service.

Git hosting discovers GitHub, GitLab and CodeCommit accounts at startup. A manual GitHub or GitLab account starts the forge login and saves its username on success. The author name and email come from global Git settings and can be edited.

Trackers shows one row per tracker account with its name, site and login state. A Jira login from the Atlassian CLI appears on its own and shares the Jira row. The Jira site is saved after login and check. Adding an account asks which tracker and starts browser sign-in. The app chooses the CLI or the MCP bridge; the user never sees the choice.

There is no Models section. The user picks provider, model and effort on the Agents page. Effort is locked until a model is chosen. It shows the chosen model's options, falls back to Default alone when none exist and resets to Default on model changes. The app loads model lists at startup and caches them. A refresh button beside Model reloads the choices. Selects and comboboxes use the same arrow and no clear button. Focus uses one ring. Loading choices shows a spinner without making the field look disabled.

### Appearance

Appearance has one mode (System, Light or Dark) and one bundled theme. System follows the operating system. Each theme provides light and dark versions. A saved imported theme falls back to Default.

The bundled themes are Default, Autumn, Spring, Summer, Winter, Woodlands and Monochrome. Woodlands takes its green palette from Everforest and uses a warm background glow. Summer uses sand backgrounds, sky-blue accents and an orange glow. The seasonal themes use lightly tinted, near-neutral panels, sidebar and controls. Monochrome uses greys, black fills with white text in Light, and grey fills with light text in Dark. Error, warning and success states retain distinct colours.

Text, including links and labels on coloured fills and statuses, needs at least 4.5:1 contrast on its background. Type starts at 14 px for secondary text, logs, graph labels and `<small>`. Body is 15 px, chat 16 px, section titles 18 px and page titles 26 px. Controls are 36 px, menu rows 34 px and icon-only buttons 32 px. Icons are 20 px with 1.5 px strokes. Sizes come from `ds/tokens.css`. Components use the tokens directly and never scale down text.

User bubbles fade from the accent at the bottom right to a lighter top left in Light and a darker top left in Dark. Text uses the theme's colour for text on the accent. Assistant replies have no bubble.

### Projects and jobs

Projects shows New project and Import together. When the list is empty both actions move into the empty state. The project page is full width and opens on Jobs. Its table omits the Project column. New job opens a form with a title, instructions and the recipe. The only recipe is chosen automatically. The form gives a clear next action when the project has none.

Project Settings shows the fixed project ID and lets the user edit the name, base branch, repository, forge account, local folder and Compose file. The Compose field accepts a path or a file chosen within the project folder. Export is a Settings action. Project settings have no raw JSON editor, default recipe, project limits or budgets. Per-node duration and available token counts belong in each job. There is no global Usage page or Factory token or cost counter.

## Critical User Journeys (CUJs)

### CUJ 1: Bug fix from a GitHub issue

*   **Given**: project `progetto-1` points to `github.com/pappa/pippo` with account `account-1`. Its `bugfix-to-pr` recipe uses instances of check templates for the project's toolchain and the nodes `git-commit`, `git-push`, `github-pr` and `github-issue-comment`. An issue is open in that repository.
*   **When**: the user tells the Assistant “fix issue 42 of progetto-1”.
*   **Then**:
    1.  The Assistant passes the order to progetto-1's Project Manager, which reads the issue, picks the recipe and starts a job.
    2.  The engine creates a workdir and branch.
    3.  The spec writer writes acceptance criteria; the tests node writes a failing test; the builder fixes the code.
    4.  Checks pass on the workdir content; the code reviewer approves; the user approves in the human review node.
    5.  `git-commit` commits; `git-push` pushes the commit with `account-1`; `github-pr` opens a PR; `github-issue-comment` posts the PR link on the issue.
    6.  The engine removes the workdir.

### CUJ 2: New game from a chat order

*   **Given**: the user created project `progetto-3` for `gitlab.com/ciccio/pimpo` with `account-3`. The remote repo did not exist, so at project creation `gitlab-create-repo` created it with `account-3`. The project's recipes deliver through a `gitlab-mr` node.
*   **When**: the user writes "make a 2D platform game for Linux and macOS" in the project's chat.
*   **Then**: the Project Manager asks clarifying questions and creates jobs for the scaffold, game loop, movement, levels, menu and packaging. Each child starts from its parent's last commit when the parent succeeds. Its MR targets the parent's branch. When a parent changes, its children run the recipe's rebase path.

### CUJ 3: New check for Rust, created with AI

*   **Given**: a Rust project with no node for `clippy`.
*   **When**: the user asks the Assistant "create a check that runs clippy with warnings as errors, and add it to my Rust project".
*   **Then**: the Project Manager proposes a `cargo-clippy` template and where to use it. The Assistant can save the node and recipe in Templates. The project's next job uses the updated recipe.

### CUJ 4: Local-only project

*   **Given**: project `prova` has no remote repo. Its recipe ends with a `git-commit` node and no delivery node.
*   **When**: the user gives an order for `prova`.
*   **Then**: the job ends with a commit on branch `factory/<job>` in the local repo. The engine copies the branch into the user's project folder. Only the agents' model calls and their own network use leave the machine.

### CUJ 5: Quota runs out during a job

*   **Given**: three jobs run in parallel; two use the same Claude subscription.
*   **When**: the harness reports a quota or rate limit error.
*   **Then**: the affected node runs enter state `waiting` with reason `quota` and the reset time if known. Their slots are released. `pecore job why <id>` shows the reason. When the reset time passes, the nodes start a new attempt. No job fails because of the limit.

### CUJ 6: Turn on protected mode

*   **Given**: <PE/CORE> runs in normal mode; the user is logged in to Claude Code and has projects.
*   **When**: the user turns on protected mode in settings.
*   **Then**: the system shows one admin permission prompt. <PE/CORE> creates `pecore-agent`, installs a sudo rule that lets the engine run processes only as that user, gives it access to the projects' workdirs, and walks the user through one login per harness account for that user in the GUI. From then on every agent, check, the Assistant and the Project Managers run as `pecore-agent`. If the automatic path fails, a guided procedure shows the exact commands to run.

### CUJ 7: Share one project

*   **Given**: project `progetto-1` with selected recipe templates, a knowledge base and job history.
*   **When**: the user exports the project from Settings or asks the Assistant for it. Another user chooses the export file or its extracted folder in Projects or supplies its local path to the Assistant. The CLI still supports sharing via archives.
*   **Then**: the recipient reviews the scripts, prompts, findings and local account choices. The imported project refers to shared templates and retains its knowledge base and any included history.

--------------------------------------------------------------------------------

## Proposed Architecture

### 1. Processes

```text
┌─────────────────────────── <PE/CORE> app (Electron) ──────────────────────────┐
│                                                                               │
│  main process          window, menus, native dialogs, notifications,          │
│                        starts and stops the engine process                    │
│                                                                               │
│  renderer (React)      the GUI; talks to the engine over the local API        │
│                                                                               │
│  engine (Node child)   local API (HTTP + WebSocket on 127.0.0.1)              │
│                        graph executor, scheduler, limits                      │
│                        project stores (one SQLite file per project)           │
│                        chat tools (MCP server for Assistant and PM)           │
│                        tracker tools (provider integrations)                │
│                        accounts (references to tools' own logins)             │
│        │                                                                      │
│        ├── connector processes ACP over stdin/stdout; run as the              │
│        │                       project user, one process group each           │
│        ├── command processes   check, commit, rebase nodes: project user      │
│        │                       push, PR/MR nodes: app user, with the          │
│        │                       account the node declares                      │
│        └── service containers  Postgres, Kafka for a job's tests, through     │
│                                the runtime set in settings                    │
└───────────────────────────────────────────────────────────────────────────────┘
        ▲
        │ same local API, only while the app is open
     pecore CLI
```

*   The engine runs in a separate Node process so that SQLite writes and process management never block the window. It is a child of the app: closing the app ends it.
*   Every process the engine starts gets its own process group, and the engine records its pgid and OS user in `pecore.db`. Stop and app quit send `SIGTERM` to every group, then `SIGKILL` after 5 seconds. A group owned by a project user is signalled with `sudo -n -u <user> kill -s <signal> -<pgid>`, because the app user cannot signal another user's processes. The sudo rule disables `use_pty`, so the recorded pgid is the program's own group (Detailed Implementation, Fixed choices).
*   On app quit and at app start, the engine runs `sudo -n -u <user> kill -KILL -1` for the protected user `pecore-agent`, because a crash of the app (or `SIGKILL`) leaves its processes orphaned, and a process that detached from its group (`setsid`) escapes the group signal. In normal mode this step is skipped, so the user's own session is never killed; only process groups apply.
*   The local API listens only on `127.0.0.1`, requires the token stored with its port in `PECORE_HOME/run/api.json` (permissions 0600), and checks `Origin` and `Host`. The renderer and the CLI use the same API.

### 2. Files and databases

Store app data in SQLite tables with fields for each record. Keep files when the user, a harness or the operating system needs them. `PECORE_HOME` defaults to `~/.pecore`.

| File or directory | Contents |
|---|---|
| `chats.db` | Global database for configuration, themes, templates, chats and notifications |
| `projects/<project-id>/pecore.db` | Project database for project definitions, creation progress, job events, artifacts and attempt logs |
| Project `repo.git/` and `work/<job-id>/` | Bare repository and job worktrees |
| Project `knowledge/*.md` | The user's Markdown documents |
| Job or chat attachment copies | Files the harness needs to open |
| Linked project folder and repository compose file | The user's code and service definitions |
| `chats/` and `harness/<user>/<account>/` | Harness chat directories and logins |
| `adapters/<package>@<version>/` | Shipped ACP adapters |
| Electron `home.json` | Location of `PECORE_HOME` between launches |
| `run/api.json`, MCP bridge token and `run/lock` | Local connection details and the engine lock |
| System sudoers rule | Protected-mode permissions |

Global configuration extends `chats.db` to reuse the engine's database connection and private file permissions. Settings, account references, profiles, ordered tier membership, agent configuration, Markdown context and auto-setup profiles have their own rows. Empty tables use defaults. The engine ignores legacy configuration files.

Node and recipe definitions use field columns and child rows for outcomes, outputs, commands, reads, edges and other lists. Shipped templates seed the global catalog on first start and when the catalog format changes. Updated or retired shipped rows are replaced or removed, and user rows stay. A project selects shared templates or keeps its own definitions in its database. The editor and definition tools use named API resources. Zod validates all changes.

`pecore.db` runs in WAL mode. Each event and the view it updates are written in one transaction. Each attempt log row is available as soon as it is written and stays until its job or project is deleted. Legacy attempt logs are unavailable in the app.
*   When a project is created and its remote does not exist yet, `repo.git` starts as an empty local repository with one empty initial commit on `baseBranch`. The engine then runs the project's repo creation node (`createRepo` in the project definition, for example an instance of `gitlab-create-repo`) once, outside any job. The node creates the remote and pushes `baseBranch` to it; the engine then sets it as `origin`. The shipped node checks whether creation and push already succeeded before it changes anything.
*   Clone and fetch are engine operations: the engine runs them as the app user with `--git-dir=repo.git`, with the project's account selected by `forge-env.ts` as for Repository nodes (3.1). It clones at project creation, fetches the job's base branch before every job starts, and fetches on merge detection (4.6).
*   `knowledge/` holds Markdown documents about the project: architecture, conventions, domain terms. Knowledge exists only inside a project; there is no global knowledge. The directory is flat: `.md` files only, all at the same level, no subfolders. A file links to another by its bare name, for example `[naming](naming.md)`, never by an absolute or nested path.
*   Files come from four places: the user writes a new file in the GUI, uploads a `.md` file, asks the Project Manager or the Assistant to write or improve one, or a project bootstrap or wizard writes them. Job agents never write there. In a project's chat, `write_knowledge` takes the file name alone; the full path `projects/<id>/knowledge/<name>.md` also works.
*   An agent node receives each selected knowledge document and every document it links to, including indirect links. The prompt includes each document under a heading with its file name.
*   The engine checks a knowledge file on every save, from the GUI, an upload, `write_knowledge` or a bootstrap. Links: a link that is not a web address must be the bare name of an existing file of the same project (no `/`, no `..`); otherwise the save is refused with the line and the link. Formatting: `markdownlint` with a small rule set (headings, lists, code fences, no line-length rule); its findings are returned as warnings and do not block the save. Deleting or renaming a file that other files link to lists those files; a rename updates their links.

### 3. Definitions

#### 3.1 Node templates

A node template contains its defaults and references to the prompt or scripts it runs. Recipe steps supply parameter values and agent settings.

Fields common to every node:

| Field | Meaning |
|---|---|
| `name` | unique among the templates or in its project |
| `description` | what the node does; the Assistant and the Project Manager read it to pick and build recipes |
| `icon` | optional SVG icon name from `templates/icons/`, without the file extension |
| `kind` | `agent`, `command`, `human` or `repository` |
| `params` | JSON Schema of the values a recipe can set |
| `outcomes` | the results a node can produce. Use `success` and `failure` for ordinary results. Add a named result only for a distinct path. Decision outcomes may be literal answers such as `yes` and `no`. |
| `outputs` | at most one artifact type (3.3) per outcome, for example `{ "success": "spec", "rejected": "feedback" }`; an outcome not listed produces nothing. The nodes that read this node (3.2) receive it |
| `failOutcomes` | the outcomes that mean failure (for example `failure`); with no edge, they end the job as `failed` (4.2) |
| `changesFiles` | whether a command or agent may modify the workdir (see 4.4) |
| `scratchPaths` | glob patterns of files the node may create and that are thrown away after it (for example `coverage/**`, `**/*.tmp`); default empty |
| `timeoutSec` | hard time limit for one Command, Agent or Repository attempt |
| `retry` | extra attempts after a process failure (not after a `failure` outcome), default 1 |

Fields by kind:

*   **`command`**
    *   `inputs` lists required artifact types and `optionalInputs` lists optional types. The recipe selects the source steps (3.2). Each script or command receives one JSON object on stdin. Keys are artifact types. Structured types are JSON values. `feedback`, `log`, `diff` and `sha` are strings. Absent optional inputs are omitted. Inside a job, stdin includes a `job` object with `title` and `request`, even if no artifact inputs are selected. A PR or MR merge check receives the saved `pull_request` on stdin. A branch merge check uses the saved commit and target.
    *   `command`: an argument array, run without a shell; placeholders are substituted into single arguments.
    *   Command nodes run in the job's workdir as the project user. The app passes no Git hosting or tracker credentials.
    *   Every project-user command also gets `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` from the app user's global git config, or "PeCore <pecore@localhost>" when it has none, so commits work as `pecore-agent` too.
    *   `script`: instead of `command`, the name of a saved shell body. The engine runs it with `/bin/sh -c`. Use it when the logic needs conditions. Placeholders are not substituted into the script; they are passed as environment variables named after the placeholder in upper case with dots as underscores (`{job.branch}` becomes `PECORE_JOB_BRANCH`), so ticket text is never inserted into the script source; scripts must quote these variables. A node has exactly one of `command` and `script`.
    *   `outcomeRules`: how the outcome is computed: by exit code, or by a field of JSON printed on stdout.
    *   `outputRules`: for each outcome that has an output, how it is read: `{ "file": "<path>" }`, `{ "stdoutJson": "<field>" }`, or `{ "stdoutLastLine": "<name>" }` (the last line of stdout, saved in the artifact under that name, for example `url`). The engine checks the result against the structure of its type and fails the node with `INVALID_OUTPUT` when it does not match.
*   **Repository**
    *   Choose one Git hosting account on the node template. Shipped templates use the project's account. Jobs resolve and record the account before they start. A missing account blocks the job.
    *   Enter one shell script in the node editor. It runs as the app user in an empty directory, with the selected account in both normal and protected mode. Inputs, outcome rules and output rules work as for Command. Scripts read values from the same environment variables.
    *   The shipped repeat and merge checks are internal (4.8 and 4.6). Custom Repository nodes need only their action script.
    *   The migration converts old credentialed commands to Repository nodes and carries over their first account. If the old node named none, it uses the project account.
*   **`agent`**
    *   An optional Tracker permission gives the agent read or read-and-write access through <PE/CORE> tools. Choose an account or use the project's tracker account (section 7).
    *   `prompt`: name of the saved Markdown prompt.
    *   `agent`: legacy tier, profile and provider fields remain readable in existing definitions. The template uses Default Agent. The recipe can assign a different card to a step.
    *   The agent returns `{ "outcome": "<outcome>", "output": <value> }` in its final message. The prompt includes the schema. The outcome determines whether `output` is required and which type it holds (5.8).
    *   `knowledge`: names of the project's knowledge files the node receives, for example `["architecture.md", "naming.md"]`. Node templates are shared, so the node editor offers the knowledge file names found in all projects; each project gives its own file with that name, and a project without it gives nothing. An older entry with a glob (for example `*.md`) still matches the file names.
    *   `agentSession` selects Job, Node or New (`job`, `node`, `new`). Job is the default. The shipped Code Reviewer and Approver use New.
*   **`human`**
    *   `interface`: the component the person uses to respond, from a list the app can extend:
        *   `decision` asks a question in Notifications and shows what the node reads.
        *   `code-review` shows the job's current diff, with the code analysis and code reviews that match the files hash (risky hunks first).
        *   `report-review` shows what the node reads.
    *   Both reviews have the outcomes `approved`, `changes_requested` and `rejected`. For a decision, the outcomes are the buttons the user sees.
    *   `outputs`: `feedback` is a written note. Changes requested in Code review can produce one `code_review` with the general note and all inline comments.

Placeholders in executable argument arrays and prompts use plain substitution. They include `{params.<name>}`, `{job.id}`, `{job.title}`, `{job.branch}`, `{job.base}` (the required base commit), `{job.oldBase}` (the previous base commit), `{job.target}` (the delivery branch, see 4.6), `{job.commit}` (the latest `sha`), `{ticket.id}` (the ticket ID at its source, if present), `{workdir}`, `{project.repoDir}`, `{project.repo.url}`, `{project.repo.owner}` and `{project.repo.name}`.

`github-pr` and `gitlab-mr` publish the title and body from `write-pr` and return the same `pull_request` with its URL. Their retry checks compare the remote title, body and target. Git and CodeCommit use the same recipe with Push connected directly to Git Delivery.

#### 3.2 Recipe templates

A recipe is a graph. Shared recipes refer to nodes in the global database. The project database stores the ordered list of selected recipes. A step can set parameters directly or use a value from the project's `variables` object, for example `"directory": "{project.vars.rust-path}"`. Each step can pass a different value to the same node. Job creation checks the resolved parameters and which inputs reach each step.

The outcome migration updates shared templates, project definitions, saved job recipes and node snapshots, run and attempt outcomes, and pending review choices. Edge order and End results stay the same. Custom names stay when a rename would merge two outcomes.

A project export serializes its project definition, templates, and script and prompt bodies from SQLite. On import PeCore adds the project record and reuses matching local templates, adds missing ones and reports conflicts while keeping the local versions. Legacy home configuration files are ignored.

A decision asks the user to choose an outcome. A code review or report review shows artifacts and offers `approved`, `changes_requested` and `rejected`. Only a review approval satisfies a human prerequisite. An approval for changed worktree content becomes stale. Both wait for the user's response without a timeout.

Data passes between nodes through `reads`. A step gets the latest artifact of each type from each selected source. Every node gets the job title and request as context. The PM sends one `JobRequest` per job with `key`, `title`, `request`, `dependsOn` and optional `recipe`, `ticketId`, `baseBranch` and `attachmentIds`. Agents also get attachment paths and the current diff. Each command input type comes from exactly one source. Required inputs must be available on every route to the step, including after a base change. A connection to End stops its route.

A GitHub recipe can use `write-pr` to write a title and description and `github-pr` to publish them. With a `ci` configuration such as `{"after":"pr","on":"success","checks":["tests"],"intervalSec":30,"timeoutSec":1800,"maxCorrections":2}`, the scheduler waits for the listed checks on the recorded commit. Connect `ci_failed` to a correction step and use `ci_passed`, `ci_exhausted` and `ci_timeout` to route the other outcomes. The CI report of a failure is a `log` produced by the `ci.after` step, so the correction step reads that step. Persisted deadlines and correction counts survive restarts. If the PR head changes unexpectedly, the job waits for the user.

```json
{
  "name": "feature-to-pr",
  "description": "New feature on existing code: spec, tests, code, checks, review, commit, PR",
  "start": "spec",
  "onBaseChanged": "rebase",
  "ends": [
    { "from": "spec", "on": "rejected", "result": "not_delivered" },
    { "from": "human", "on": "rejected", "result": "not_delivered" },
    { "from": "commit", "on": "failure", "result": "failed" },
    { "from": "push", "on": "failure", "result": "failed" },
    { "from": "pr", "on": "success", "result": "succeeded" },
    { "from": "pr", "on": "failure", "result": "failed" }
  ],
  "nodes": {
    "spec":    { "use": "spec-writer" },
    "tests":   { "use": "tests-writer", "reads": ["spec", "tests-check", "code"] },
    "tests-check": { "use": "typecheck" },
    "code":    { "use": "builder", "reads": ["spec", "lint", "types", "test", "review", "human"] },
    "lint":    { "use": "eslint" },
    "types":   { "use": "typecheck" },
    "test":    { "use": "vitest", "params": { "suite": "unit" } },
    "review":  { "use": "code-reviewer", "reads": ["spec", "lint", "types", "test"], "agent": { "providerNot": ["code"] } },
    "approve": { "use": "approver", "reads": ["spec", "review"] },
    "human":   { "use": "human-review", "reads": ["approve"] },
    "commit":  { "use": "git-commit", "requires": ["lint", "types", "test", "human"] },
    "rebase":  { "use": "git-rebase" },
    "push":    { "use": "git-push" },
    "write-pr": { "use": "write-pr", "reads": ["spec", "lint", "types", "test"] },
    "pr":      { "use": "github-pr", "reads": ["write-pr"] }
  },
  "edges": [
    { "from": "spec",    "on": "success",  "to": "tests" },
    { "from": "tests",   "on": "success",      "to": "tests-check" },
    { "from": "tests-check", "on": "failure", "to": "tests", "maxRounds": 3 },
    { "from": "tests-check", "on": "success", "to": "code" },
    { "from": "code",    "on": "success",      "to": "lint" },
    { "from": "code",    "on": "tests_disputed", "to": "tests", "maxRounds": 2 },
    { "from": "lint",    "on": "success",    "to": "types" },
    { "from": "types",   "on": "success",    "to": "test" },
    { "from": "lint",    "on": "failure",    "to": "code", "maxRounds": 3 },
    { "from": "types",   "on": "failure",    "to": "code", "maxRounds": 3 },
    { "from": "test",    "on": "failure",    "to": "code", "maxRounds": 3 },
    { "from": "test",    "on": "success",    "to": "review" },
    { "from": "review",  "on": "changes_requested",   "to": "code", "maxRounds": 3 },
    { "from": "review",  "on": "approved",   "to": "approve" },
    { "from": "approve", "on": "success",      "to": "human" },
    { "from": "human",   "on": "approved",   "to": "commit" },
    { "from": "human",   "on": "changes_requested",   "to": "code" },
    { "from": "commit",  "on": "success",      "to": "push" },
    { "from": "commit",  "on": "stale",     "to": "lint" },
    { "from": "push",    "on": "success",    "to": "write-pr" },
    { "from": "write-pr", "on": "success",   "to": "pr" },
    { "from": "rebase",  "on": "success",     "to": "lint" },
    { "from": "rebase",  "on": "rebase_conflict",  "to": "code" }
  ]
}
```

Recipe fields:

| Field | Meaning |
|---|---|
| `icon` | optional SVG icon name from `templates/icons/`, without the file extension |
| `start` | the first node |
| `onBaseChanged` | the node the job re-enters when its base moves (D17, 4.2) |
| `layout` | optional node positions for the graph editor (`{ "<node id>": { "x", "y" } }`), ignored by the engine. Recipes without positions open with an initial layout. Dragging snaps to a free grid cell on release. Arrange runs only when requested. |
| `ends` | connections to End. Each has `from`, `on` and `result` (`succeeded`, `failed` or `not_delivered`). For new connections, the editor derives the result from `success` or `failure` and suggests an editable value for other outcomes. Each reachable outcome must have exactly one connection. |
| `successOutcomes` | legacy list of successful `<node>:<outcome>` values for recipes saved without `ends` |
| `nodes.<id>.use` | a node template name |
| `nodes.<id>.params`, `nodes.<id>.agent` | step parameters and legacy agent settings. Engine-user commands take their arguments from the node template |
| `nodes.<id>.agentId` | optional agent card ID for an agent step. With no assignment, the step uses Default Agent. Assistant is reserved for its chat |
| `nodes.<id>.reads` | Step IDs whose latest outputs this node receives |
| `nodes.<id>.requires` | nodes whose latest outcome must be `success` or a review's `approved` on the current files hash (4.4) |
| `nodes.<id>.agentSession` | optional Job, Node or New override for an agent step. When absent, the step uses its node template's setting |
| `nodes.<id>.skipWhenUnchanged` | after a base change, if the rebase was clean and the job's own changes are identical to before (same `git patch-id` of the job's diff), the node ends at once with its previous outcome instead of running, and that outcome is bound to the new files hash (4.4): an approval of the same patch carries over. Used to avoid repeating reviews and human approvals; checks never use it |
| `edges` | `from`, `on` (outcome), `to`, optional `maxRounds` |

The editor routes arrows from live card positions. An orthogonal A* search uses padded card boundaries and reserves each occupied track for the length of its segment. At 100% zoom it targets 27 px between parallel shafts away from their ends and a 34 px straight lead before the first bend. Tighter layouts can use shorter leads and at least 20 px between parallel shafts. Clearance near ends and around cards is at least 10 px. Crossings are allowed. A bend costs more than switching one end away from its facing side. Free ports prefer the center and shared sides use distinct ports. Labels reserve clearance from cards, other labels and every other arrow. The drag preview uses the latest pointer position once per frame and reuses paths that still clear the moving card. Tracks, ports and labels are computed in memory. The recipe migration drops old side fields from the catalog and job history.

Notes on the example:

*   `git-rebase` stashes uncommitted changes including untracked files, runs `git rebase --onto {job.base} {job.oldBase}` and restores the changes. `--onto` moves only the job's own commits, so after a squash merge of the parent its original commits are not replayed. A conflict at any step gives the outcome `rebase_conflict`.
*   After a rebase the job runs again through `commit`, `push` and `pr`. `git-commit` with nothing new to commit ends with `success` on the current commit. `git-push` pushes `{job.commit}` with `--force-with-lease`; its probe compares the remote branch head with `{job.commit}`, so a rebased commit is always pushed. `github-pr` finds the existing PR through its probe and does not open a second one (4.8).
*   Tests Writer writes tests named after the BDD scenarios and stubs for any new interfaces. TypeScript checks the tests and stubs. Builder fills the stubs and leaves the tests unchanged.
*   `spec: rejected` means the spec writer found the ticket unclear or not feasible; the job ends and the reason is the `feedback` output of `rejected`. `code: tests_disputed` means the builder reports a test as wrong; the job goes back to the tests node, which reads `code` and so receives the builder's `feedback` with the reason.
*   The connections to End give `human:rejected` the result `not_delivered` and `pr:failure` the result `failed`.

#### 3.3 Artifacts

Nodes pass data through `pecore.db`. The `artifacts` table stores content by job ID, run, name and type, with its SHA-256 hash and files hash. Events refer to rows by those keys. Deleting a job deletes its artifact rows.

The engine reads those rows for later steps. Agents receive each input inline in the prompt with its label. Commands receive a JSON object on stdin. Human reviews and the artifact viewer load the same content through the engine API.

Attempt logs use the separate `attempt_logs` table. The Assistant's `read_artifact` tool can return the end of an attempt log by node run (section 9).

Each artifact type has one purpose. The recipe connects a Command input only to a node that produces the required type.

| Type | Structure | Examples in the default templates |
|---|---|---|
| `spec` | `feature`, `scenarios[]` with `name`, `given[]`, `when`, `then[]` and optional `examples[]` | Spec Writer |
| `diff` | Git patch | Engine after a node that can edit files |
| `code_review` | `body` and `comments[]` with `file`, a `line` or `hunk`, and `text` | Code Reviewer and Human Review |
| `code_analysis` | `summary` and `hunks[]` with `file`, `hunk`, `level` (risky or safe), and `text` | Approver |
| `sha` | Commit SHA | Git Commit |
| `pull_request` | `title`, `body` and optional `url` | Write PR drafts it, GitHub PR and GitLab MR add the URL |
| `feedback` | Text for whoever needs to revise work | Spec Writer rejection, disputed tests, conflict resolution |
| `log` | Execution output | Commands and CI reports |

Job attachments are stored separately from node outputs. Agents receive a workdir copy of each attachment with its path listed in the prompt.

The engine uses the latest `sha` as the job commit. PR delivery uses the published `pull_request.url`. Branch delivery uses the job's branch.

Tests Writer names at least one test after each BDD scenario. Builder implements the interfaces exercised by those tests. Code Reviewer checks that each scenario has a test and that the code meets the spec. Approver explains the behaviour of every hunk for the human reviewer.

An upgrade removes job history in the old format. Catalog migration removes generated Skipped routes. A node follows its regular outcomes when reached. Custom scripts that read a retired input key need to use the new contract.

#### 3.4 Accounts, profiles and tiers

*   Auto-setup creates internal profiles and tiers. The Assistant card configures its chat. Each Project Manager uses the card picked in its project's PM tab. Agent nodes and PMs without a card choice use Default Agent.
*   <PE/CORE> keeps no secrets of its own. Each tool stores its login. The `accounts` table holds references.
*   The `accounts` table has three kinds of account.
    *   `model`: provider, connector, login type (`subscription` or `api-key`, both configured inside the harness), the account's `email` (compared with the logged-in account, below), `maxParallel`.
    *   `forge`: forge type, host, tool (`gh`, `glab`, `aws`, `git`), the tool's account name (for example the `gh` login, the AWS profile), commit author.
    *   `service`: external service (for example Atlassian), the tool or MCP server that holds its login, the account name, the site when the service has one.
*   Private Git and AWS CodeCommit deliver to existing repositories by pushing a branch. They require an existing repository. Private Git uses the user's configured Git credentials. CodeCommit uses the stored AWS CLI profile and derives its Git host from the profile's region. Legacy CodeCommit rows still use the username field as their profile reference.
*   There are no exceptions. A service is reached only through a tool that keeps its own login (for example Jira through `acli` or the Atlassian MCP server). A service with no such tool is not supported until one exists.
*   A harness keeps its login in a config directory, chosen through the variable named in the connector file (for example `CLAUDE_CONFIG_DIR`, `CODEX_HOME`).
    *   Normal mode: the first account of each harness uses the harness's own default directory (no variable set, so `~/.claude`, `~/.codex`): the login the user already has, with no login in <PE/CORE>. A second account of the same harness gets `PECORE_HOME/harness/<app user>/<account-id>/`, private to the app user, and needs one login there.
    *   Protected mode: every account gets `PECORE_HOME/harness/pecore-agent/<account-id>/`, the only part of `PECORE_HOME` besides `chats/` and the job work folders that `pecore-agent` can open (ACL rwx there, pass-through only on the folders above), and needs one login there, once, for all projects, the Assistant and the Project Managers. Every agent can read all these logins, because they share one OS user (section 8).
    *   A harness whose connector names no such variable supports one account per OS user, and the GUI says so.
*   A login is one model account in one of these directories (5.9). Login state, `auth` waits and rechecks belong to the login; quota cooldowns (4.7) belong to the account.
*   The user logs in inside the harness, through the harness's own login command and the vendor's own flow. <PE/CORE> never reads, copies or moves a harness token: Anthropic's terms forbid apps to collect, store or intermediate Claude credentials ([ACP spike](spikes/acp.md), Terms).
*   In protected mode, `pecore-agent` has no desktop session, so it has no usable desktop keyring. On macOS its Keychain locks at every logout of the app user, and Codex in keyring mode then opens password dialogs on the user's desktop ([spike report](spikes/macos-keychain.md)). So, for `pecore-agent` only:
    *   Codex keeps its login in a file: connector `configDirFiles` writes `cli_auth_credentials_store = "file"` into a new config directory.
    *   Claude Code keeps its login in `$CLAUDE_CONFIG_DIR/.credentials.json` on Linux. On macOS `claude auth login` writes only to the Keychain. There, the Claude Code connector file creates a Keychain for `pecore-agent` with an empty password before the first login, and unlocks it as that user before every connector start (`beforeLogin`, `beforeStart`; Fixed choices). A locked Keychain shows no dialog: Claude Code only reports a missing login.
    *   Antigravity keeps its login in the desktop keyring and hangs without a desktop session ([Linux spike](spikes/linux-harnesses.md)). It works in normal mode, but not in protected mode until it can keep its login in a file.
*   In normal mode the harnesses store their logins as they always do, in the app user's session.
*   Each config directory holds its own login: two directories with copies of the same tokens invalidate each other at the first refresh.
*   ACP reports a missing login as JSON-RPC error `-32000` with a message starting with "Authentication required"; a run that ends with it waits with reason `auth`. A run that fails with an error no rule matches first gets a login check; if no account is logged in, it waits with reason `auth` too (5.4).
*   The connector reports the logged-in account (email and plan) when a session starts, before any prompt: Claude Code and Codex send it in an `auth/status_update` (Codex: `_auth/status_update`) notification during `session/new`. Claude Code also reports there that no account is logged in. A connector that reports no account names an `identityCommand` or, like opencode and pi, is considered logged in when its session lists at least one model. After each harness login, and in the background after app start, the engine runs `checkLogin` for every login and compares the email, ignoring case, with the account's `email` in `chats.db`; the plan is only shown. A mismatch shows a warning and blocks that login with waiting reason `auth`.
*   Each row in `profiles` holds a model account, model and effort. The time limit is the node's `timeoutSec`. The GUI lists the models and efforts that the connector offers for the account (`listOptions`, 5.1).
*   The `tier_profiles` table links each tier (`frontier`, `strong`, `standard`, `cheap`) to its profiles in order. The first profile that is available and satisfies the node's constraints is used; later profiles are backups used only when earlier ones are unavailable (quota, rate limit, harness error).
*   Recipes refer to tiers, not profiles, unless the user chooses otherwise. Tier names are the same on every machine, so a shared recipe works after import.

#### 3.5 Projects

`project.json`:

| Field | Meaning |
|---|---|
| `id`, `name` | identity |
| `repo` | `url` of the remote, or `null` for a local-only project; `account` from the global database |
| `folder` | Absolute path to the user's copy of the code, or `null`. Paths beginning with `~/` expand to the user's home. The wizard and chat propose `<projectsFolder>/<id>` and the default projects folder is the user's home. Settings can move the checkout or set a folder for an imported project. |
| `baseBranch` | branch new jobs start from and deliver to, for example `dev` or a feature branch; the Assistant, the Project Manager or the user can set another one per job |
| `createRepo` | node template that creates the remote repo when needed |
| `recipes` | recipe template names selected by the project |
| `variables` | project values that steps can reference |
| `credentials` | account IDs bound to credential names used by templates |
| `pm` | the Project Manager's `agentId`, `name` and `color` (`#RRGGBB`). AI tools (harnesses) are listed in `harnesses` in `schemas/src/harnesses.ts` with a name, a default colour (from the 24 agent colours, except Claude Code's terracotta `#D97757`) and whether they work yet; the settings field `harnessColors` keeps the user's colour per AI tool (`harnessColor()` reads it with the default as fallback). New projects receive the first free entry of the 24 agent colours (`agentColors` in `schemas/src/colors.ts`: colour name, hex and agent name, for example Crimson `#DC2626` Chris) and use Default Agent. The PM tab edits the card, identity and context |
| `services` | path of a compose file for job services, relative to the repo (4.9); `null` (the default) means automatic: the first of `compose.yaml`, `compose.yml`, `docker-compose.yaml`, `docker-compose.yml` found at the root of the job's base commit, and none when the services runtime is not set |
| `tracker` | optional project tracker account for the Project Manager and for Agent nodes that select Project account. Without it, they use the repository's account if it supports ticket tools |

Settings can connect, replace or disconnect an existing remote. The engine validates the base branch with the selected forge account before changing its `origin`. Changing the remote URL clears its repo creation node. Existing recipes and job history are preserved. Review the recipes if they use a specific forge.

Moving the checkout preserves its working files and Git history. The destination must be empty. If there is no checkout at the old path, Settings can attach an existing checkout or create a copy in an empty folder. A change to the repository or folder requires the project's jobs to finish or stop first.

### 4. Engine

#### 4.1 Job states

| From | To | When |
|---|---|---|
| `queued` | `running` | the scheduler starts it |
| `running` | `waiting` | its next node run waits for a limit or a human |
| `waiting` | `running` | the wait ends |
| `running`, `waiting` | `paused` | pause, or app quit |
| `paused` | `running`, `waiting` | play (back to the state it was in) |
| `running` | `succeeded`, `not_delivered`, `failed` | the recipe ends (4.2) |
| `queued`, `running`, `waiting`, `paused` | `stopped` | stop |
| `failed`, `stopped` | `running` | resume (G17), unless archived; base change (4.2) |
| `succeeded`, `not_delivered` | `running` | base change (4.2) |

Final states are `succeeded`, `not_delivered`, `failed` and `stopped`; a job in a final state can be archived or deleted.

| State | Meaning |
|---|---|
| `queued` | created, waiting for a parent job (stacked) or for the scheduler |
| `running` | its node run is running |
| `waiting` | its next node run waits for a limit or a human; the reason is shown |
| `paused` | the user paused it, globally or per job, or the app quit while it ran |
| `succeeded` | ended on an outcome listed in the recipe's `successOutcomes` (for example `pr:success`); a base change can move it back to `running` |
| `not_delivered` | ended on a path such as `spec:rejected` or `human:rejected`. The outcome is shown as the reason. A base change can move the job back to `running`. |
| `failed` | a node failed beyond its retries, an unrouted failure outcome ended the job (4.2), or the user ended the job when an edge reached its round limit |
| `stopped` | the user pressed stop |

Pause waits for the running node run to finish, then holds. Play moves a paused job back to `running` or `waiting`. On app start every job that was `running` or `waiting` is `paused` with reason `quit`; `queued` jobs stay `queued`; a pause by the user has reason `user`. A job is archived only from a final state. Archiving removes the workdir, so an archived `failed` or `stopped` job cannot be resumed; a `succeeded` or `not_delivered` job that re-enters `running` on a base change is first unarchived and its worktree recreated from its branch (4.5).

#### 4.2 Graph rules

*   **Start** runs nothing. The job runs `start` first, which is Spec Writer in every shipped recipe. Job creation stores the title, request and optional `ticketId`. The tracker ID is used for tracker actions.
*   **One node at a time**: a job has one workdir and runs one node at a time (4.5).
*   **Edges**: when a node run ends with an outcome, the edge `from` that node `on` that outcome starts its target. The validator rejects two edges with the same `from` and `on`.
*   **End**: a step outcome either continues along an edge or reaches End with the result recorded in `ends`. The empty recipe goes directly from Start to End and succeeds. An unrouted outcome in an explicit recipe is a validation error. A previously saved recipe without `ends` retains its terminal rules based on `failOutcomes`, `successOutcomes` and `not_delivered`.
*   **Rounds**. An edge with `maxRounds: n` can send the job to its target up to `n` times. When the edge reaches that limit, the job enters `waiting` with reason `round_limit`. The user can allow one more round or end the job as `failed`.
*   **Base change**: a job's base and target change only through a request, recorded as `job.base_change_requested`, in exactly three cases: its parent job's branch gets a new commit (from a node of the parent job); its parent's delivery is detected as merged (4.6); the user, the Assistant or the Project Manager asks to realign it to a branch. A job inherits its base branch from the project when it is created (or from the branch chosen at creation), and its base never moves while it works. A request is applied at once when the job is `queued`, `succeeded`, `not_delivered`, `stopped` or `failed`; otherwise it waits and is applied when the job reaches one of those states. Requests that wait are merged into one, the latest. A realign asked by the user is refused while the job is `running`, `waiting` or `paused`. Applying a request records `job.base_changed`; a job that has started then re-enters `running` at `onBaseChanged` (its worktree recreated if needed), where the rebase node moves its commits and the delivery node moves its PR or MR. If the recipe has no `onBaseChanged`, the job only shows that its base moved. Commits pushed to a branch by hand on the forge, or new commits on `baseBranch`, are not detected; the user realigns by hand.

#### 4.3 Node run states

```text
pending ──▶ waiting(reason) ──▶ running ──▶ completed(outcome)
                  ▲                │
                  └────────────────┤        quota or rate limit: the attempt ends,
                                   │        the node run waits for a new attempt
                                   ├──▶ failed(reason)     process error after retries
                                   └──▶ interrupted        stop, app quit
```

Node run waiting reasons: `concurrency`, `quota`, `rate_limit`, `human`, `services`, `round_limit`, `network` (a probe or forge command could not reach the forge), `auth` (a harness or tool login expired or does not match the account; the user is notified and the run continues after a new login), `disk` (free disk below the threshold, Risks & Limits). A `queued` job stores its own waiting reason on the job: `parent_job`, `parent_failed` (4.6), `concurrency`, `disk` (before its workdir is created), or `network` and `auth` (the fetch of its base branch at start failed; retried with the backoff of 4.7). An `auth` wait also records the account id, the OS user of the login (3.4), and whether the login belongs to a harness or to a forge or service tool. Failure reasons: `HARNESS_ERROR`, `TIMEOUT`, `INVALID_OUTPUT`, `READ_ONLY_VIOLATION`, `PROCESS_KILLED`, `COMMAND_NOT_FOUND`.

Approver, Tests Writer and Write PR have one recipe outcome, `success`, because they have one usable result and no alternate branch. Harness errors and invalid results use the existing attempt, wait and failure rules.

A job waiting for a human, a quota or a login releases its pool units (4.7) and takes them again before its next node run, so waiting jobs never block running ones.

#### 4.4 Files hash and evidence

*   After every node run with `changesFiles: true`, the engine computes the workdir's **files hash**: the git tree hash of all tracked and untracked files, built with a temporary index so the worktree's index is never touched. Files ignored by git and the `.pecore/` folder are not part of it.
*   Every node run records the files hash before and after it. Every check result is bound to the files hash it saw; a check whose before and after states differ binds to neither and does not count as `success`. A human review is bound the same way to the files hash of the diff it showed, and its `approved` counts as `success` for `requires`.
*   The engine also recomputes the files hash right before it evaluates `requires` and right before a commit node, because another job of the same project runs as the same OS user and could have changed the workdir in between.
*   `requires` on a recipe node is checked against the current files hash. If one of the listed nodes has not succeeded or been approved on that exact state, the node does not run and produces the built-in outcome `stale`, which the recipe can route (for example back to the checks).
*   A commit node must produce a commit whose tree equals the files hash checked by `requires`; otherwise it fails with `READ_ONLY_VIOLATION`. The commit node records the `sha`, and delivery pushes that exact SHA (`{job.commit}`), never whatever the branch ref points to.
*   Files ignored by Git (`node_modules/`, build caches, `.env`) are outside the files hash. Job checks run in the workdir and can pass because of ignored files. Repository CI checks the commit independently of those local files.
*   After every node run, the engine deletes new files that match the node's `scratchPaths`, before computing the files hash.
*   A node with `changesFiles: false` must leave the files hash unchanged. If it changed, the engine restores the previous state and fails the run with `READ_ONLY_VIOLATION`. Test output such as coverage reports therefore needs to be in `.gitignore` or in `scratchPaths`.
*   Before each node run the engine records the branch SHA, HEAD and `refs/stash`. When a node run is interrupted, the engine aborts any git operation in progress, resets the branch, HEAD and `refs/stash` to the recorded values, then restores the files hash from before the run. A new attempt starts clean.

#### 4.5 Workdirs and branches

*   At job start the engine creates branch `factory/<job-id>` from the job's base commit (the head of its base branch, by default the project's `baseBranch`, or the parent job's last commit for stacked jobs) and a worktree under `work/<job-id>/`. The worktree is owned by the project user.
*   `repo.git` is shared with the project user through a group (`core.sharedRepository=group`), because commits made in a worktree write objects into it. Every git command that runs with a work tree under `work/` runs as the project user, reads included: computing and restoring the files hash, creating and removing worktrees, rebase, commit. The app user never runs git with a work tree under `work/` and never uses `safe.directory` for it (section 8).
*   One job has exactly one workdir and runs one node at a time. Work that should run in parallel is split into separate jobs (sibling or stacked, 4.6). Several workdirs per job is a possible later evolution, not part of this design.
*   Node-run ids: `<job-id>/<node>#<round>`.
*   When a job ends `succeeded` or `not_delivered`, the engine removes its worktree. If the job later re-enters `running` (base change, 4.2), the engine first recreates its worktree from `factory/<job-id>`. When a job fails or is stopped, its worktree stays, so the user can see what the agents left; it is removed when the job is archived or deleted. Branches stay until the job is deleted.
*   When an agent node cannot start because its agent is unavailable, the job stops with `AGENT_UNAVAILABLE` and the details explain the cause. Resume retries the node after the agent is configured or reconnected.
*   Project folder: when a job ends `succeeded` or `not_delivered` and the project has a `folder`, the engine force-pushes `factory/<job-id>` from `repo.git` into the folder as the app user, so the user finds the branch in their own copy. If the push fails (folder gone, branch checked out there), the job keeps its state and a notification of kind `folder` says why. Deleting the job or the project never removes the branch from the folder.
*   With `repo: null` and a `folder`, the folder is `origin` of `repo.git`: the base branch is fetched from it when a job is created and when it starts, so jobs start from the user's latest commits. If the fetch fails, the job uses the base branch already in `repo.git`.

#### 4.6 Stacked jobs

*   A job can have a `parentJobId`. It stays `queued` with waiting reason `parent_job` until the parent job ends as `succeeded`.
*   Its base is the last commit on the parent's branch. The recipe validator rejects a parent recipe that has no commit node.
*   When the parent's branch changes later, the engine requests a base change for every child that has started (4.2).
*   `{job.target}` is the parent job's branch while the parent is not merged, so the child's PR or MR shows only the child's changes. For a job with no parent it is the job's base branch.
*   Merge detection: for every job with a delivery not yet merged, the engine runs the `mergedCheck` of its delivery node at the interval set in settings (default 5 minutes). When it reports `done`, the engine records `job.delivery_merged` on the parent and notifies each child: it requests a base change with the parent's target as the child's new `{job.target}` (4.2). When the request is applied, the engine fetches that branch into `repo.git` (section 2) and sets the child's base to the fetched commit. The child's rebase node runs, and its delivery node moves the existing PR or MR to the new target (`gh pr edit --base` in `github-pr`). A delivery node with no `mergedCheck` gives no notification; the user realigns by hand.
*   The Assistant and Project Manager create stacked jobs through `create_jobs`, which takes tickets with `dependsOn`.
*   Parent ends `not_delivered`, `failed` or `stopped`: its queued children move to waiting reason `parent_failed` and the user is notified. They start when the parent later ends `succeeded` (after a resume or a base change), or the user stops them.
*   Parent re-enters `running` after a base change and then does not succeed: its children keep their current base and show `parent_failed` until the parent succeeds again.
*   A parent with children that are not in a final state cannot be deleted; the GUI lists the children. Archiving a parent is allowed: merge detection continues while it has live children.

#### 4.7 Scheduler and limits

*   Limits are counters held in memory, organised in pools: `jobs` (global), `agents` (global), `account:<id>` (from `maxParallel`). A node run takes one unit from every pool that applies, all at once, or waits with reason `concurrency`.
*   The job limit is global. There are no per-project job pools or budget waits.
*   After an app restart the counters start at zero, after the leftover-process sweep of section 1.
*   When a connector reports a quota or rate limit error (section 5), the engine marks the account as cooling down until the reset time the connector reported, or for a backoff of 1, 2, 4, then 8 minutes if no time is known. Agent nodes using that account wait with reason `quota` or `rate_limit`.
*   Attempts record token usage and cost when the connector reports them (5.3). The app reports usage in each job. It keeps no daily usage table and exposes no aggregate usage route.

#### 4.8 External effects and crash safety

*   Repository actions record `effect.requested` before the script runs and `effect.completed` or `effect.failed` after it runs. Agent tracker calls are recorded in the attempt log.
*   Shipped delivery nodes with a repeat check run it first. If the action is complete, the node uses the check's output and ends. If the action is still needed, the script runs. If the check cannot tell, the node waits and retries with the backoff of 4.7 (1, 2, 4, then every 8 minutes), or until the user stops the job. This covers crashes and reruns after a rebase.
*   Delete removes the job's local branch, worktree, logs, services and rows in `pecore.db`, including artifacts. The user can close the job's PRs or MRs and delete remote branches on the forge.
*   Project delete stops unfinished jobs, shuts down their services and removes the project directory, including `pecore.db` and its attempt logs. The GUI asks the user to stop running jobs first. The user can remove `pecore-agent` when turning protected mode off.

#### 4.9 Job services

*   If `project.json` has `services`, or it is `null` and the job's base commit has a standard compose file at its root while a services runtime is set, the engine starts them when the job starts. Pause stops the containers and keeps their data (`compose stop`); play starts them again (`compose start`). A final state removes them with their data (`compose down -v`); a job that re-enters `running` starts them from scratch. Until they are healthy, node runs wait with reason `services`.
*   The container runtime runs as the app user, but the compose file lives in the repo, where agents can edit it. So the engine never reads it from the workdir. It reads it from the job's base commit (`git --git-dir=repo.git show <base>:<path>`), rejects `build:`, bind mounts of host paths, `privileged`, `cap_add`, `devices`, `network_mode: host` and `pid: host`. It passes the validated copy on stdin with `-f - --project-directory <empty temp dir>`; no compose file is written.
*   Each job gets its own compose project, `pecore-<job id in lower case>`. The compose file must publish ports as `"127.0.0.1::<container port>"`, so the runtime picks free host ports on the loopback address and parallel jobs never clash.
*   The engine reads the chosen ports with `compose port` and passes them to every node as environment variables `PECORE_SERVICE_<SERVICE>_<PORT>`, with the service name in upper case and `-` replaced by `_` (for example `PECORE_SERVICE_POSTGRES_5432=127.0.0.1:49153`). The project user can reach the loopback address.
*   When the app quits (Electron `before-quit`), the main process runs `compose down -v` for every `pecore-*` compose project before exiting. As a backup after a crash, at app start the engine removes compose projects named `pecore-*` that belong to no job.

### 5. Agents and connectors

Two domains are kept apart. The engine knows jobs, nodes, accounts, logins, OS users and waiting reasons. The package `@pecore/agents` knows ACP, connectors and the habits of each harness. The engine uses only the interface below and never reads a connector-specific field. `@pecore/agents` builds every argument and every variable that concerns the connector; it never chooses an OS user, never starts a process except through `spawn`, and never touches a file.

#### 5.1 Interface of `@pecore/agents`

```ts
type Login = { account: string; osUser: string; configDir: string };   // 3.4

type Spawn = (p: { argv: string[]; env: Record<string, string>; cwd: string }) => Promise<{
  stdin: Writable; stdout: Readable; stderr: Readable;   // stderr without the pid line
  pgid: number;                              // known when the promise resolves (Fixed choices: Process groups)
  exited: Promise<{ code: number | null; signal: string | null }>;
  stop(): Promise<void>;                     // TERM to the group, KILL after 5 s
}>;

checkPrerequisites({ connector, spawn }): Promise<{ ok: boolean; problems: string[] }>;
prepareLogin({ connector, login }): {
  files: { path: string; content: string }[];        // configDirFiles, written by the engine
  before: string[][];                                // beforeLogin, run by the engine through spawn
  command: { argv: string[]; env: Record<string, string> };
  urlPattern: string; readsCode: boolean;
};
checkLogin({ connector, login, spawn }):
  Promise<{ state: "logged_in"; email: string; plan?: string } | { state: "logged_out" } | { state: "unknown" }>;
listOptions({ connector, login, spawn }): Promise<{ models: string[]; efforts: string[] } | null>;
startSession({ connector, login, spawn, cwd, model, effort?, resumeId?, mcpServers? }): Promise<Session>;

type Session = {
  sessionId: string;
  resumed: boolean;                        // false when resumeId was given but a new session was started
  events: AsyncIterable<AgentEvent>;       // for the live view only
  raw: AsyncIterable<RawLine>;             // every JSON-RPC line in both directions and every stderr line, MCP tokens redacted
  prompt(text: string): Promise<TurnResult>;   // never rejects
  cancel(): Promise<void>;                 // session/cancel
  close(): Promise<void>;                  // ends stdin, waits 5 s, then stop()
};

type TurnResult = {
  stopReason?: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
  error?: { kind: "auth" | "quota" | "rate_limit" | "other"; resetAt?: number; raw: string };
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model?: string;                          // resolved model id, when the connector reports it
  costUsd?: number;                        // only for a new session (5.3)
  quota?: { status: string; resetAt?: number; windows?: Record<string, { utilization: number; resetAt: number }> };
  text: string;                            // the agent's text in this turn
  finalText: string;
};
```

`RawLine` is one item of the attempt log (section 9). The engine stores each item after `@pecore/agents` redacts it. `AgentEvent` is `text {text}`, `tool_call {toolCallId, title, kind, status}`, `permission {toolCallId, optionId}`, `account {email, plan}`, `quota {...}`, `usage {...}`. Times are epoch milliseconds. When the connector fails before the prompt, `startSession` returns the error and any recorded traffic. The engine stores that traffic and classifies the failure like a turn error (5.4).

The engine adds to `env` only `HOME`, `PATH` and `LANG` of the target user and the `PECORE_*` variables, and chooses the OS user of `spawn` (Process below).

#### 5.2 ACP session

*   One connector process per attempt, as the project user, with the node's workdir as `cwd`. It talks ACP over its stdin and stdout ([ACP spike](spikes/acp.md)); its stderr goes to the raw log.
*   Every request before `session/prompt` has a limit of 30 seconds; past it the process group is stopped and the result is `other`.
*   Order: the connector's `beforeStart`; `initialize` (protocol version 1, no file system, no terminal); then, when `resumeId` is given, `session/resume` with `sessionId`, `cwd` and `mcpServers` if the connector offers it, else `session/load` (its replayed `session/update` notifications are dropped until it answers). If neither is offered or the call fails, `session/new` with `cwd` and `mcpServers`, and `resumed` is `false`. Each of the three calls carries the connector's `sessionMeta` as `_meta`. Then `sessionConfig`, then `session/prompt`.
*   `sessionConfig` is an ordered list, applied one `session/set_config_option` at a time, because setting one option can reset another (in the Claude Code traffic, setting `model` changed `effort`). After each call the answer's `currentValue` for that option must equal the value sent; otherwise the result is `other`. An entry whose value is empty (no effort in the profile) is skipped. Every option is set at every session start, because the Claude Code adapter otherwise takes mode and model from the harness's own settings.
*   Mapping of agent messages: `session/update` `agent_message_chunk` gives `text`; `tool_call` and `tool_call_update` give `tool_call`; an answered `session/request_permission` gives `permission`; every other update goes to the raw log only. The reader receives every incoming notification, including `auth/status_update` and `_auth/status_update`, which are not `session/update`.
*   Permissions: agents get full permission inside their harness, with network access (author decision). `sessionConfig` selects the connector's most permissive mode. Any `session/request_permission` that still arrives is answered with the `optionId` of its option of kind `allow_once`, or `{ "outcome": "cancelled" }` if there is none. Every tool call is in the raw log. The project user is the security boundary (section 8).

#### 5.3 Usage, quota and cost

*   The reader turns the connector's usage into four fields that do not overlap: `input` (not served from cache), `cacheRead`, `cacheWrite`, `output`. Claude Code reports them separately in the `session/prompt` answer (`usage.inputTokens`, `cachedReadTokens`, `cachedWriteTokens`, `outputTokens`); its reader adds the side models listed in `_meta.quota.model_usage` (for example a Haiku model for titles). Codex counts cached tokens inside `inputTokens`, so its reader subtracts `cachedReadTokens`.
*   `model` is the resolved model id when the reader finds it (Claude Code: `_meta["_claude/model"]` in `usage_update`), else the profile's model. Price lookups use it.
*   Cost: Claude Code sends the total cost of the session so far in `usage_update.cost` (`amount`, `currency`). It is reported as `costUsd` only for a new session, where the total is the attempt's cost. For a resumed session, and for any currency other than USD, the cost is unknown.
*   pi sends only the context size in `usage_update` (`used`, `size`). `pi-acp` reports no token counts and no cost, so pi attempts record zero tokens and no cost; the selected model is still recorded from its config option. Its automatic retries arrive as the text `Retrying (attempt n/m)…` and are classified as `rate_limit` by `pi.json`.
*   Quota: the Claude Code reader reads `_meta["_claude/rateLimit"]` in `usage_update`: `status` (`allowed`, `allowed_warning`, `rejected`), `resetsAt` (epoch seconds), `rateLimitType` (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included`, `overage`), and `unifiedWindows` with `utilization` (0 to 1) and `resetsAt` per window. These are the values of the Agent SDK's `SDKRateLimitInfo` type. Only `rejected` is an error. The values are not kept.
*   When a turn is refused for quota, the adapter ends it with a JSON-RPC error whose `data` is `{ "errorKind": "rate_limit", "rateLimit": <the same fields> }` (`claude-agent-acp` 0.108.0, `result-end.js`). The reader reads `data.errorKind` and `data.rateLimit.resetsAt`, never the error text. `errorKind` values from the SDK's `SDKAssistantMessageError` type: `rate_limit` is `quota` with its reset time; `billing_error` and `account_on_hold` are `quota` with no reset time; `authentication_failed` and `oauth_org_not_allowed` are `auth`; `overloaded` and `server_error` are `other`.

#### 5.4 End of a turn

The engine decides in this order:

1.  The engine itself cancelled the turn: `TIMEOUT` after a timeout, interrupted after a stop or quit.
2.  JSON-RPC error `-32000` whose message starts with "Authentication required" (seen with Claude Code, opencode and pi): `auth`. Other `-32000` errors go on to step 4.
3.  With `stopReason: end_turn`, a valid result in the final message completes the run. A valid question opens a human queue item. A `rejected` quota during the turn still starts the account's cooldown for later attempts.
4.  A turn error with `data.errorKind` (5.3), or a `rejected` quota during the turn: the kind and reset time of 5.3.
5.  The connector's `errors` rules, applied to the JSON-RPC error message or to the turn's `text`: their kind, with the reset time if the rule reads one.
6.  `end_turn` with a missing or invalid output: the validation errors are sent as a new message in the same session, at most twice, each answer decided again from step 1; then `INVALID_OUTPUT`.
7.  `max_tokens`, `max_turn_requests`, `refusal`, a connector that exits without answering, or any other error: `checkLogin`; `logged_out` gives `auth`, anything else `HARNESS_ERROR`.

`quota` and `rate_limit` make the node run wait (4.7) and `auth` makes it wait for a new login (3.4). These waits preserve the node's retry budget. `HARNESS_ERROR` and `TIMEOUT` use that budget. `INVALID_OUTPUT` ends the run after two correction prompts. A retry starts from the files hash before the node run (4.4) and applies the session rules below.

Each built-in connector ships with recorded ACP traffic of these cases, used by its tests. A quota or rate limit error that cannot be provoked on purpose is recorded the first time it happens; until then a synthetic fixture (a recorded session with `status` changed to `rejected`, file name ending in `.synthetic.jsonl`) tests the reader, and an unrecorded error message reaches step 7.

#### 5.5 Agent sessions and timeout

*   Job steps continue the latest completed Job session for that agent card within the job. Node steps continue the latest completed Node session for that card and recipe step within the job. New steps start a fresh session on each run. Different agent cards have separate sessions.
*   A change to the account, model, effort, connector or OS user requires a new session on the next run. An answer to an agent question continues the session of that same run.
*   Attempts record the card, session mode and harness session ID. Existing Shared settings and attempts become Job, and Isolated becomes New. The loader also reads the old values in saved job snapshots and archives.
*   If the connector cannot resume it, a new session starts with the same prompt, and the attempt records `resumed: false`. The prompt always contains the node's inputs, so a new session has what it needs; only the conversation history is lost.
*   The node's `timeoutSec` covers the whole attempt, correction messages included. `runners/agent.ts` owns it: `cancel()`, then `stop()` 5 seconds later.

#### 5.6 Connectors

*   A connector file says how to start a connector, which harness program it drives and which versions, the session options, the variables, the login command and the error rules (Detailed Implementation, Connector file). Built-in connector files are read from the app's resources, so an app update updates them.
*   Kinds: `native`, a harness with its own ACP mode, started directly (for example `opencode acp`); `adapter`, an ACP adapter shipped with <PE/CORE> (Fixed choices: Adapters), run with the Node runtime shipped with <PE/CORE> and pointed at the user's installed harness (for example `claude-agent-acp` with `CLAUDE_CODE_EXECUTABLE`). The user installs nothing besides the harness. The adapters ship without their bundled copies of the harness (350 to 450 MB): the user's own harness is used, the one the user logged into.
*   Built-in connectors: Claude Code (adapter `@agentclientprotocol/claude-agent-acp`), Codex (adapter `@agentclientprotocol/codex-acp`), opencode (native), pi (adapter `pi-acp`). A new harness that speaks ACP natively needs only a connector file; one that needs an adapter also needs that adapter installed where the project user can run it. pi-acp starts the user's installed `pi` with `PI_ACP_PI_COMMAND`, reads its models and thinking levels as ACP config options and reports no account identity.
*   Readers: ACP leaves room for extensions in `_meta` fields, and adapters use them for data <PE/CORE> needs. A connector names a reader, code in `@pecore/agents`, that maps its usage, quota and account data (5.3). A reader treats missing or unknown fields as absent.
*   The Claude Code connector sets `ENABLE_CLAUDEAI_MCP_SERVERS=false`, so the MCP connectors of the user's claude.ai account (mail, calendar, drive) never join an agent's session; with it the claude.ai servers disappear from the session ([ACP spike](spikes/acp.md)). In protected mode it also sets `DISABLE_AUTOUPDATER=1`, because `pecore-agent` cannot write the app user's installation. Its `sessionMeta` sets the SDK option `strictMcpConfig`, so the session has only the MCP servers <PE/CORE> passes in `mcpServers`: without it the repository's `.mcp.json` servers start with the session, as do the user's own and plugin MCP servers ([sudo spike](spikes/sudo.md)). The adapter loads the harness's user, project and local settings: in normal mode agents work with the user's own Claude Code configuration (instructions, plugins, hooks, but no MCP servers), as when the user runs it by hand; the repository's `CLAUDE.md` is read in both modes.

#### 5.7 Process

*   The engine runs a connector or command as the project user with `sudo -n -H -u <user> -- env -i <variables> <program> ...` (Fixed choices: Process groups), in the given `cwd`. `sudo` resets the environment, so every variable is passed through `env`: those built by `@pecore/agents` plus those the engine adds (5.1). The sudo rule is limited to that user and needs no `SETENV`. In normal mode processes are spawned directly, without `sudo`, with the same variables.
*   Program paths: the harness program is looked up in this order: `command -v <program>` run by the app user's login shell with the name passed as an argument, then the engine's `PATH`. A desktop-launched app often lacks the shell's `PATH`, hence the login shell. Node is the runtime shipped in `PECORE_HOME/adapters/node/` (Fixed choices: Adapters).
*   In protected mode `pecore-agent` runs the app user's installed harness. Its files are readable by others in the usual installations (for example `~/.local/share/claude`); `pecore-agent` gets traverse-only access on each directory on the path that it cannot otherwise traverse, like `work/` (section 8). `checkPrerequisites` verifies, as the project user, that the harness and Node run and that the harness version is in range.

#### 5.8 Prompt and output

*   The engine sends the prompt as the text of `session/prompt` and records it in the attempt log. The prompt includes the job request, current diff, read artifacts and knowledge documents under their own headings. It lists worktree paths for the selected original files, including images. Spec Writer uses these inputs without fetching the ticket or web pages again. The prompt includes the JSON Schema built from the node's `outcomes` and `outputs`.
*   The agent ends its turn with a final message containing only its result or question. The engine reads the last ACP message, accepts a plain JSON object or one JSON code fence, and validates it with Zod. Missing or invalid JSON follows the correction flow in 5.4. Each correction includes the expected shape again.

#### 5.9 Logins

*   A login is a model account in one config directory (3.4). In normal mode the first account of each harness is the login the user already has, so <PE/CORE> asks for no login; it only runs `checkLogin`. A second account of the same harness, or protected mode, needs one login per account, done once.
*   The GUI starts a login with `prepareLogin`. The engine creates the config directory and writes the returned files as the target user through `workdir/fs-as.ts`, runs `before` and then `command` through `spawn`, and streams the output to the GUI. The GUI shows the first match of `urlPattern`; when `readsCode` is true it shows a field, and the code goes to the command's stdin (`POST /logins/:id/code`). Then the engine runs `checkLogin`.
*   `checkLogin` and `listOptions` run `initialize` and `session/new` with no prompt, so no tokens are spent, in an empty directory `<configDir>/probe/`, then `close()`. The account comes from the last account notification before the `session/new` answer: for Claude Code `auth/status_update` with `state` (`authenticated`, `unauthenticated`) and the entry of `accounts` with `active: true`, which gives `email` and `_meta.claudeCode.plan`. With no notification and no `identityCommand` the state is `unknown`: runs are allowed and the GUI shows the login as not verified. `listOptions` returns the values of the config options with category `model` and `thought_level`, and `null` when not `logged_in`. OpenCode reports no identity: the engine treats it as logged in when `opencode models` lists at least one model, at start and at every check, and takes its model list from that command. pi reports no identity either: its `session/new` answer carries the models and thought levels, so the engine treats it as logged in when it lists at least one model and reads both lists from the ACP session.

### 6. Assistant and Project Manager

The Assistant manages what is global: the templates and the projects themselves. Each project's Project Manager runs that project's work: jobs, recipes, nodes, knowledge, tickets and agent questions. Both use a connector and the project user's permissions. The user can still do everything by hand in the GUI and CLI.

Recipes can perform the external actions they define. In Project Manager chat, a Repository or Tracker action that makes a change needs confirmation even when the user asked for it.

*   **Assistant:** the user's chat outside projects, including the Jobs list. It reads every project and writes only what is global: templates and projects. Project creation, settings changes, import and deletion use confirmation cards. A flagged export requires the user's decision. It treats untrusted content as data. A direct chat order authorises the requested action. It cannot do a project's work: for that it calls `delegate_to_pm`, which queues a complete, self-contained order, with any images of the current message copied, in that project's Project Manager chat. The Assistant never reads that chat and never says the work is done. When the delegated turn ends (completed, failed or interrupted) the engine posts the Project Manager's final reply, or the failure, in the Assistant chat as a message from "Project Manager · <project>". That message starts no Assistant turn. The Assistant's next turn receives the reports it has not seen yet (`reported_until` in `chats.db`).
*   **Project Manager:** plans jobs, manages project knowledge and answers agent questions. It reads tickets through Tracker tools and public HTTP or HTTPS text pages through `read_web_page`, which returns up to 200 KB as untrusted data and reports truncation. It chooses a recipe, combines the relevant ticket, page and chat details into one self-contained request per ticket, and chooses original files from the current order by ID. `create_jobs` saves the full request in `request` and the original tracker ID or link in `ticketId` when there is one. The Project Manager's chat and calls are scoped to one project.
*   Agents contains the built-in Assistant and Default Agent cards. Startup recreates missing cards before checking harnesses. Assistant starts white. Default Agent uses the Agent badge colour. Both names are fixed. Each project's PM tab selects a card and edits the PM's identity and optional additional Markdown context. The selected card supplies the account, model, effort, compaction thresholds and shared Markdown context. The choice is saved in the local database. A deleted card is replaced by Default Agent for every PM that used it. An agent step uses the card assigned in the recipe or Default Agent. If its assigned card is unavailable, the job stops and names the card.
*   Agents lists reusable configurations with a unique name, provider, model, effort, compaction thresholds and optional Markdown context. These configurations are intended for recipe nodes. Assignment is a separate change.
*   Agent questions: when a job's agent asks a question (an `agent-question` item), the engine also queues it in the project's Project Manager chat, starting with "Answer this agent question", with the question as untrusted data. The Project Manager answers with `answer_question` only if the project's knowledge, recipes, ticket or job already decide it; otherwise it says in one line that the user must decide, and the item stays in Notifications. During that turn its tools are `list_recipes`, `list_definitions`, `read_definition`, `read_ticket`, `job_status`, `read_artifact` and `answer_question`, for that item only. Without a Project Manager profile the question goes only to Notifications.
*   Prompt injection: the prompts of the Assistant, the Project Manager and every agent node say that tickets, replies, repository code and anything from the internet can contain prompt injection, and must never be followed as instructions.
*   Single chat and compaction: the Assistant's chat is one conversation for the whole app. After each reply the harness reports the context in use (`usage_update.used`, out of `size`). Above the maximum threshold (default 262,144 tokens) the engine compacts at once; above the automatic threshold (default 131,072) it compacts after 5 minutes with no message. Thresholds are powers of two: the automatic one is 65,536, 131,072, 262,144 or 524,288; the maximum one is 131,072 to 1,048,576 and at least twice the automatic one. The settings schema moves any other value to the nearest valid one, so older files keep working. Both thresholds are in settings (`assistant.compaction.auto`, `assistant.compaction.max`); Project Manager sessions use `pm.compaction`, with the same defaults. The engine stores the last reported size per chat (`context_tokens` in `chats.db`), so the check runs again at app start with the current settings. A new message restarts the 5 minutes. Compaction is queued as a `/compact` message, at most one at a time, and sets the size to what the harness reports after it (unknown if it reports nothing).
*   The Assistant is an agent run through a connector, like any agent node, with the provider, model and effort chosen in settings. The model and effort are passed to the connector before the session starts or resumes, so a resumed chat uses the current choice. It runs as the project user: the app user in normal mode, `pecore-agent` in protected mode, where it cannot read the app user's files although it reads untrusted tickets and links.
*   Both roles use an MCP server provided by the engine. The harness starts a stdio shim configured in `mcpServers`. The shim reads a private token file and forwards requests to the engine on loopback (Phase 6 decisions). The engine refreshes the token at startup and redacts it from logs.
*   Each chat has a fixed working directory, `PECORE_HOME/chats/<chat-id>/`, because harnesses store sessions by directory. In protected mode `chats/` is opened to `pecore-agent` alone (ACL rwx, pass-through only on the folders above); the rest of `PECORE_HOME` stays closed to it. All the app's data lives in `PECORE_HOME`: at start the app moves an old `~/.pecore-harness` into `PECORE_HOME/harness/<user>/` and deletes an old `~/.pecore-chats`, for the app user and for `pecore-agent`. Messages of one chat run one at a time: a message sent while the previous one runs waits for it. That token reaches only the tools below. It cannot choose the outcome of a human node, change global settings other than the user's name, or stop or delete jobs: those need the user token of the GUI and CLI. Tools: `list_projects` (with each Project Manager's name, so the user can name a project by its Project Manager: "tell Aura to…"), `get_project`, `update_project`, `delete_project`, `delegate_to_pm`, `ask_user` (Assistant and Project Managers, in chats with the user: one to six questions, each single choice, multiple choice or short text, with up to eight options, one optionally marked as recommended; the form appears as a card and the clicked answers are posted as the user's next message, "How do you want to start?\n→ From a repository"; a form left unanswered when the user writes is marked "Not answered" and can no longer be sent; the instructions tell agents to use it whenever they offer options), `set_user_name` (saves the user's name in `chats.db` at once, with no card; the only global setting the Assistant writes), `list_definitions` and `read_definition` (saved definitions of the templates and projects), `create_project` (proposes a project, local or on a remote repository, with an optional folder, default `<projectsFolder>/<id>`, as a card in the chat; the project is created only when the user confirms the card), `project_creation_options` (forge accounts to offer, default base branch and folder), `list_recipes`, `read_ticket`, `create_jobs` (with `dependsOn` and an optional `baseBranch` per job), `job_status`, `read_artifact` (an artifact or the log of a node run of a job, by job id and node-run id; size-capped), `answer_question`, `list_templates`, `write_template`, `instantiate`, `write_instance`, `write_knowledge`, `validate`, `comment_ticket`.
*   The Project Manager's MCP server lists Repository nodes with their descriptions, parameters and artifact inputs. A tool can use the branch, commit and ticket of a job in the same project. It returns declared outputs as untrusted data. The separate tracker tools use the project's tracker account (section 7).
*   Repository nodes set to Reads only run immediately, as do read and search tracker calls. Writes show the action, inputs, account and target in the chat form. Approve runs the request once and gives the Project Manager the result in the next turn. Reject runs nothing. A changed script, account or target needs a new confirmation.
*   Protected mode exposes authorized nodes only. The catalog hashes the saved action and its execution settings. This includes saved checks for scripts and the server, tool and arguments for MCP. Shipped nodes and user saves set the hash. Agent saves leave it alone. When the hash differs, the editor shows To approve and lets the user review the action. This authorization applies to chat calls only.
*   `update_project` validates a patch to the name, base branch or Compose path and proposes it as a card with each change as "old → new"; the engine applies it only when the user confirms. `delete_project` proposes the deletion of one project. The GUI confirms or rejects these proposals with the user API token. The engine checks the project and its running jobs again before deleting.
*   `analyze_project_archive` reviews a local export or extracted folder without importing it. `import_project` reviews the same sources and proposes an import. The user sees the warning and coverage, chooses any required mappings and confirms with the user API token. `export_project` saves `<project id>.tar.zst` in the system's downloads folder and returns the path. If the secret scan finds a match, only the user can proceed using the findings card.
*   `write_*` tools validate the file before saving and return the validation errors; a saved file is committed to `PECORE_HOME`.
*   The Assistant validates and saves templates directly. The Project Manager, on the user's order within its project, validates and saves recipe, node, script and knowledge changes directly. During intake the Project Manager can only read definitions and plan jobs.
*   Artifacts and logs are written by agents and can carry prompt injection, like tickets. `read_artifact` gives the Assistant and the Project Manager nothing beyond their existing tools.
*   A chat message can carry a context: references only (project id, job id, node-run id, recipe, node or template name), never content. The GUI shows it as a removable chip; the Assistant reads what it needs through its tools.
*   Chats are stored in `chats.db`. Attachments are stored as files next to it.
*   The reply streams: the engine collects the `agent_message_chunk` text of the current prompt, sends `chat.changed` on the WebSocket, and `GET /chat` returns it as `streamingReply` until the turn ends. Only one complete reply is stored. Text sent before the prompt (for example during a resume) is dropped.
*   The message box keeps focus after Send and receives focus when the chat opens. Animated dots show work until the reply starts.
*   Each reply records the user message it answers (`reply_to`). The GUI shows the Assistant's tool actions under that reply. A change gets a card with its result or a link to it. Reads share one muted line.
*   The instructions of a role include the user's name from settings (`user.name`) for both roles. When it is empty, the Assistant is told to ask for it and save it with `set_user_name`.
*   The role's instructions (and, for a Project Manager, "Your name is Mara.") are sent only when a new session starts, after a compaction, or when they change (a renamed Project Manager, an app update). `chats.db` keeps a hash of the instructions last sent (`instructions`), so a resumed session gets the order alone. Instructions sent again in a resumed session because they changed start with "Your instructions changed. They replace all earlier ones", so the model applies the current instructions.
*   Compact in the header or a message containing only `/compact` starts the harness's own compaction. The command goes to the resumed session without attachments or a preamble. A divider shows progress and completion. No reply is stored and the command is omitted from history replay. If resumption fails, the saved session stays intact. Clear asks for confirmation before starting a fresh session.
*   A reply sends a native notification ("Assistant replied", or "<project>: Project Manager replied" with kind `pm-replied` for a reply to the user in a project chat, and the reply's first line) only when the <PE/CORE> window is not focused, and is not stored in the notification log; the unread counts show it.
*   `chats.db` holds the Assistant chat (id `assistant`) and one Project Manager chat per project (`project` column). The API in [Local API, WebSocket and MCP](#local-api-websocket-and-mcp) exposes the Assistant chat under `/chat` and each Project Manager chat under `/projects/:id/chat`, with the same operations. `chat.changed` carries `project` (`null` for the Assistant). Clearing a chat deletes its messages and attachments and forgets the session; clearing a Project Manager chat also forgets what it remembered of past tickets. Clearing is refused during a turn.
*   During development, schema changes may reset local data. The legacy multi-conversation store has no migration into the single Assistant chat.
*   `chats.db` also holds the notification log with a `seen` flag. Notifications shows outstanding items first, then the log. There is no bell in the top bar. `POST /notifications/seen` marks all entries seen. The trash button deletes one via `DELETE /notifications/:id`. The menu count includes open items and unseen notifications.

### 7. Trackers

*   The Project Manager can search and read tickets and choose which ones become jobs. A job can have one ticket reference. Automatic scheduling is deferred.
*   Agent nodes default to None. Read exposes `read_ticket` and `search_tickets`. Read and write adds `comment_ticket`, `change_ticket_status` and `update_ticket_fields`, including provider-specific fields. Each attempt gets access to its own tool scope through the app's MCP server. The app runs the provider integration with the selected account and returns its result as untrusted data. It records calls in the attempt log. The same tools are available to the Project Manager in chat. Each chat write needs the user's approval.
*   GitHub uses `gh` and GitLab uses `glab`. Jira uses Atlassian Rovo MCP or the active Atlassian CLI login. Jira custom fields use Rovo. Linear uses its MCP server. The app launches the installed `mcp-remote` bridge over stdio for MCP integrations. The bridge opens browser sign-in and owns the tokens. A Jira call selects the site from the ticket link, an explicit site or the only accessible site.
*   The database upgrade converts former Tracker nodes and saved job definitions to Agent nodes. It preserves recipe routes, outputs and job results. Custom actions keep their old configuration as a reference, and the replacement asks the user how to configure it.
*   Import accepts Agent, Command, Human and Repository nodes. Projects exported with Tracker nodes need to be upgraded and exported again from the original installation.
*   Bug Fix to PR uses a final Agent to check for an existing delivery comment before posting the PR link and to move the ticket to In review when applicable. Without a ticket it finishes successfully.

### 8. Security

*   Normal mode (the default) works like running Claude Code or Codex by hand: agents run as the app user, with access to its files and logins and to `pecore.db`. The rest of this section applies to protected mode. The GUI shows which mode is on and offers protected mode.
*   Protected mode: agents, checks, the Assistant and the Project Managers run as `pecore-agent`, which cannot read the app user's files unless those files are readable by others (see the check below). All projects share this user, so protected mode separates agents from the user, not projects from each other.
*   The app user owns the project directory. The project user writes to `work/` and `repo.git/` through a shared group. The global and project databases, including their configurations, definitions and attempt logs, are private to the app user. Project knowledge is private too.
*   Inside `repo.git/`, only `objects/`, `refs/`, `logs/`, `worktrees/` and `packed-refs` are group-writable. `config`, `hooks/` and `info/` belong to the app user and are read-only for the group. Otherwise a Git call run as the app user could execute a hook or a command set by an agent. App-managed Git calls and Repository scripts disable hooks and fsmonitor. `extensions.worktreeConfig` stays off, so per-worktree config files are ignored.
*   The project user controls the worktree's `.git` file and `repo.git/worktrees/<id>/`. In protected mode the app user runs Git with `--git-dir=<project>/repo.git` and no worktree. Repository nodes start in an empty temporary directory.
*   The engine uses the project user for workdir file operations so an agent cannot use a symlink to reach files private to the app user. These operations include copying attachments, reading `outputRules.file` and deleting `scratchPaths`. They use `cat` and `find -P ... -type f -delete` through `runners/process.ts` and reject symlinks with `test -L`. The engine stores artifact content in `pecore.db` as the app user.
*   The project user gets traverse-only access (execute, no read) on the directories on the path to `work/`, through ACLs (`setfacl` on Linux, `chmod +a` on macOS). It can reach `work/` but cannot list the app user's home.
*   At project creation and at every app start, <PE/CORE> checks that the app user's home and the tools' login files are not readable by others, and offers to fix the permissions.
*   In protected mode, harness logins (subscriptions and API keys) live in `pecore-agent`'s home, stored by each harness. All of them belong to the same OS user, so an agent can read every protected login, not only the one of the harness it runs in: a prompt-injected agent in one project can take the logins of every account used in protected mode. Protected mode protects the app user's files and logins, not the protected logins from each other.
*   `PECORE_HOME/adapters/` holds only code shipped with the app. It is readable by every user, so `pecore-agent` can run the adapters and the shipped Node; it gets traverse-only access on the directories on the path to it, like `work/`, and on the directories on the path to the harness program (5.7). Only the app user can write any of them.
*   The Claude Code connector keeps the MCP connectors of the user's claude.ai account out of agents' sessions (5.6), because those act with the user's account outside the project user's reach.
*   Forge and service tools store their logins in the app user's home. Repository scripts and app-managed tracker integrations use those accounts. Tracker MCP responses give agents the operation result. In normal mode a process running as the app user can still reach that user's own logins.
*   Recipes cannot override Repository node `params` (3.2). Saving and running recipes, nodes and Compose files requires no technical approval, including agent edits and custom repository creation nodes. Schema validation, recipe-defined human reviews and destructive-action confirmations still apply.
*   The human queue holds reviews declared in a recipe, agent questions and round limits.
*   The GUI opens a native save dialog at `<project id>.tar.zst` in the system's downloads folder (Electron `app.getPath("downloads")`, which follows the XDG user directories on Linux, so `~/Scaricati` on an Italian desktop). The app passes that folder to the engine in `PECORE_DOWNLOADS`, and the Assistant saves there; without it the engine uses `~/Downloads`. Both can include history and exclude raw logs. When history is included, the engine scans artifacts with its own list of common token formats (`share/secrets.ts`: GitHub, GitLab, AWS, Slack, Stripe, Anthropic, OpenAI, Google, npm, PyPI, Hugging Face, Atlassian, JWT, private keys); nothing needs to be installed. Both show the findings before "Export anyway" accepts the displayed fingerprints. History export requires the project's queued, running, waiting and paused jobs to be stopped or archived.
*   History exports include artifacts in the SQLite snapshot. The CLI can include attempt log rows with history. The engine scans those rows for secrets when included. Otherwise it removes the rows from the snapshot and rebuilds the snapshot to clear their bytes.
*   GUI and Assistant import validate entries, reject links and apply the same manifest checks to archives and extracted folders. Review covers files, artifact rows, job history and included attempt log rows, with a 32 MB limit per item. It lists findings and skipped items. The import dialog and chat card ask the user to review scripts and prompts. Each required forge account maps to a local one, preselected when just one fits. The import asks for a new ID only if the original is taken. Confirmation checks the content digest, ID and account mappings. History imports remap job, run, attempt and queue item IDs and update the log rows' attempt references. The raw messages are preserved.
*   Ticket text, links, images and repo content are data. Prompts mark them as untrusted input.

### 9. Observability

*   `pecore.db` holds `jobs`, `node_runs` (state, waiting reason, files hashes), `attempts` (profile, harness version, model, tokens and cost), `human_queue` (decisions by `kind`) and `artifacts` (content and metadata). External effects are recorded as events (`effect.requested`, `effect.completed`, `effect.failed`).
*   `attempt_logs` holds one row per ACP message, stderr line or command output, keyed by attempt and sequence. Direction, timestamp and payload have their own columns. The raw view displays messages in sequence order. Deleting a job deletes its attempts and their logs. Deleting a project removes its database.
*   The GUI shows the job graph with each node's state, round, waiting reason, duration, tokens and cost. One click opens the node's attempts, artifacts and raw log. `pecore job why <id>` prints the same blocking reasons.
*   Notifications cover job completion, jobs that need attention, expired logins, failed parents, auto-setup changes and exposed login files. The engine stores these in the notification log, including Project Manager reports. Assistant replies use the unread marker and a native notification only. Native notifications are sent only while the window is unfocused. The operating system handles do-not-disturb.

### 10. Stack

| Area | Choice |
|---|---|
| App shell | Electron, packaged as AppImage and deb (Linux) and dmg (macOS), with auto-update |
| UI | React, Vite; Base UI components styled with CSS Modules and theme CSS variables; React Flow for graphs; CodeMirror 6 for editors and diffs (see `ui-design.md`) |
| Engine | Node.js (the version bundled with Electron), TypeScript strict |
| Local API | Fastify with WebSocket |
| Schemas | Zod |
| SQLite | `better-sqlite3`, rebuilt for Electron |
| Ids | ULID |
| Agents | ACP client written in `@pecore/agents` (JSON-RPC over stdin and stdout); ACP adapters `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, run with the Node runtime shipped with the app |
| Credentials | none stored by <PE/CORE>; tools keep their own logins |
| Tests | Vitest, fast-check for graph rules |
| Monorepo | pnpm workspace |

## Alternatives Considered

### Scope

Each entry: option, status (Rejected or Deferred, with the decision if any), reason, and what is lost.

*   **A reduced first version.** Rejected (D1). A cut list would drop parts the author needs from day one (several providers, stacked jobs, GUI). The build order (Detailed Implementation) still gives a usable engine early. Lost: nothing; only the order of work is fixed.
*   **Automatic merge by an approver agent.** Deferred (D2). Merging safely needs evidence that the change meets the ticket's acceptance criteria, and no node in this design produces such evidence yet. Lost: every job needs a human merge.
*   **Windows support.** Rejected (D5). The isolation in section 8 relies on POSIX users, `sudo`, ACLs and process groups, which Windows does not have in the same form. Lost: Windows users.

### Running agents

*   **Direct API calls instead of the vendor harnesses.** Rejected (D4). Subscriptions work only through the vendor harnesses: Anthropic forbids using a Claude subscription login in other apps. The harnesses also already handle tools, files and context.
*   **The Claude Agent SDK called by the engine.** Rejected. It works with a subscription login, because it drives the installed Claude Code binary ([ACP spike](spikes/acp.md)), but it serves only Claude Code. The Claude Code ACP adapter is built on it and gives the same control (sessions, permission requests, usage) through the protocol <PE/CORE> uses for every harness.
*   **One JSON manifest per harness, run in non-interactive mode (`claude -p`, `codex exec`).** Rejected after the phase 0 spikes; it was the previous version of this design. It allows one message per process and no permission requests. Each harness also needed code beyond what a manifest could describe: usage reported per session instead of per turn, ten retries before a missing login is reported, a process that never exits after a login error ([Linux spike](spikes/linux-harnesses.md)). Lost: a harness with no ACP mode and no adapter cannot be added.
*   **Our own adapter per harness, on each vendor's protocol (`claude` stream JSON, `codex app-server`).** Rejected. ACP adapters for Claude Code and Codex already exist, and opencode, Copilot CLI and Gemini CLI speak ACP natively. Lost: control over adapter releases; <PE/CORE> pins the versions it ships.
*   **Adapter binaries from the ACP registry (the archives Zed downloads).** Rejected. The Claude Code archive also holds a copy of Claude Code (about 460 MB in all), and a download at first use adds a network step and checksums to manage. The npm packages and a Node runtime, shipped with the app, add about 40 MB per platform and no download. Lost: nothing.
*   **A container per agent, with runner images and a token proxy.** Rejected (D9). Each harness would need its own login flow inside a container, plus runner images, file ownership mapping and a network proxy per container. <PE/CORE> runs agents on the host as the project user (the app user, or `pecore-agent` in protected mode). Lost: network limits per node. Containers remain only for job services such as Postgres, with the runtime set in settings (D22).
*   **A proxy that injects tokens or filters traffic (TLS-intercepting, or a CONNECT allowlist such as Squid).** Rejected. Without containers there is nothing to route through it, and each harness keeps its own login (D27).
*   **An LLM gateway such as LiteLLM for rate limits.** Rejected. It needs API keys, and subscriptions do not provide them. <PE/CORE> reads token and cost figures from each harness's output.

### App and storage

*   **An always-on daemon managed by systemd or LaunchAgent.** Rejected (D23). The author wants an app that is downloaded and opened, with nothing to install as a service. Closing the window keeps the app in the tray with jobs running; only Quit stops them. Lost: jobs do not run after Quit, after logout or while the machine is off.
*   **A web app or PWA.** Rejected (D23). <PE/CORE> must start processes, create OS users and write to the disk, and a browser cannot.
*   **No GUI: <PE/CORE> as an MCP server used from an existing harness, with recipes rendered as Mermaid.** Rejected. The author wants a full React GUI with a graphical recipe editor (D23).
*   **One global SQLite database, or one database partitioned by project.** Rejected (D18). SQLite has no partitions. A project must be one directory that can be copied or shared, so each project has its own `pecore.db`.
*   **A durable workflow engine (Temporal, Restate, DBOS) or LangGraph.js.** Rejected. They need a separate server or their own workflow SDK, and they do not store state inside the project directory. <PE/CORE> needs only a graph executor, a scheduler and one SQLite file per project.
*   **State tables plus a separate audit log, instead of events.** Rejected. Each engine operation writes its event and updates the views in one transaction, so the history and the current state cannot drift apart. Duplicate pushes and PRs are stopped by the probe either way (4.8).
*   **A separate telemetry database with W3C trace spans.** Deferred. Diagnosis (G13) needs only `pecore.db` and the raw logs. Spans are useful only for export to tools such as Grafana or Jaeger, which is not a goal; they can be added later.
*   **An encrypted secrets file (`secrets.enc`).** Rejected (D27). Harnesses and CLIs such as `gh`, `glab` and the AWS CLI keep their own logins. <PE/CORE> stores only references.
*   **Encrypted storage for credentials no tool keeps (Electron `safeStorage`).** Rejected. Its only uses were a Jira token and a GitHub App key, and Jira has tools that keep their own login. It would add a decrypt service in the main process and a credentials file.
*   **Parallel work inside a job (subtasks with their own workdirs, joins, a merge node).** Deferred. It needed per-subtask branches, join rules, a merge node and conflict routing, while separate jobs already run in parallel. Lost: parallelism inside one ticket.

### Definitions

*   **JSONC files.** Rejected (D14). Files are written by the GUI and by AI as well as by hand; a program rewriting JSONC loses or misplaces comments, and JSON Schema tooling expects plain JSON. Explanations go in `description` fields. Lost: free-form comments.
*   **Built-in support for languages and forges (a closed list of check types, a `Forge` interface).** Rejected (D3, D13). Every operation is a node written as data: checks, commit, rebase, push, PR or MR, repo creation. A new language or forge needs new nodes, created by hand or with AI, not engine code.
*   **Workdirs and branches as nodes.** Rejected (D15). Files hashes (4.4), crash recovery and permissions (section 8) assume the engine controls the workdir's whole life; a recipe that skipped or reordered these steps would break them.
*   **Commit and rebase done by the engine.** Rejected (D16, D17). Commit is a node, so a recipe can put a human review before it. Rebase is a node, because conflicts need an agent.

### Existing tools

*   **Issue-to-PR tools (Copilot coding agent, Codex cloud, Claude Code GitHub Action, OpenHands, Vibe Kanban).** Rejected. As reported in the concepts brief (not re-verified), each is tied to one vendor's agent, or is a cockpit where the user steers each agent; OpenHands supports several model providers but not several vendor harnesses with their subscriptions. <PE/CORE> runs several harnesses in one job, runs checks as recipe nodes, and delivers to any forge that has delivery nodes, or to a local repo only.

## Risks & Limits

### Risks

| Risk | Category | Impact | Mitigation | Where |
|---|---|---|---|---|
| An agent reaches the app user's forge logins through git config or symlinks in its workdir | security | forge account takeover | the app user never runs git with a work tree under `work/` and never touches files there; file operations run as the project user | 4.5, 8 |
| An Assistant edit changes a recipe or Repository node | security | unreviewed code can run with the user's account | validation of definitions and fixed parameters for Repository nodes | 3.2, 6, 8 |
| An agent reads the login of the harness it runs in | security | subscription token theft by a prompt-injected agent | accepted; in protected mode the damage stays within that harness account | 8 |
| Normal mode: agents run as the app user | security | a prompt-injected agent can read the user's files and forge logins, as when the user runs a harness by hand | author decision: normal mode is the default, for zero setup; the GUI shows the mode and offers protected mode in one step | 8 |
| Protected mode: all protected harness logins share `pecore-agent` | security | a prompt-injected agent can read the protected logins of every account | accepted: the app user's files and logins stay out of reach; per-account OS users would multiply logins (D9) | 8 |
| An agent edits the compose file to mount the app user's home or run a privileged container | security | forge login theft, root on rootful Docker | compose file read from the base commit, forbidden keys rejected | 4.9 |
| One job's agent changes another job's workdir or refs in the same project | integrity | unchecked content delivered | files hash recomputed before `requires` and commit; push of the exact checked SHA | 4.4 |
| Checks pass on modified ignored files | integrity | a check result that does not hold for the commit | Repository CI runs checks on the commit | 4.4 |
| An adapter or harness changes its `_meta` fields or error messages | failure mode | quota errors become failures | adapter versions pinned with the app; harness version range checked at start; recorded ACP traffic tests per connector; a reader treats missing fields as absent; an unknown error ends as `HARNESS_ERROR` after a login check (5.4), so the job fails visibly instead of waiting on a wrong reason | 5 |
| The claude.ai account's MCP connectors (mail, calendar, drive) join an agent's session | security | a prompt-injected agent acts on the user's mail or files with the user's account, outside the project user's reach | `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the Claude Code connector (5.6), checked in phase 0 | 5, 8 |
| Anthropic treats automated use of a Claude subscription as a breach of its consumer terms | policy | the user's Claude account is restricted | the unmodified Claude Code binary, logged in by the user through Anthropic's flow; <PE/CORE> never handles tokens; API key accounts are supported. Anthropic's legal page allows an end user to sign in to the unmodified binary, says that developers of products, including those built on the Agent SDK, "should use API key authentication", and does not name automation; the consumer terms forbid automated access except where Anthropic permits it ([ACP spike](spikes/acp.md), Terms). Before the public release, ask Anthropic, or make API keys the default for Claude | 3.4, 5 |
| A crash during a git operation | failure mode | inconsistent repo state | recorded branch, HEAD and stash; abort and reset on interruption | 4.4 |
| A crash during a delivery | failure mode | double PR or push | repeat checks in shipped delivery nodes | 4.8 |
| Parent changes re-run every descendant | cost | tokens, quota and repeated human reviews | base change requests merged while a job works; `skipWhenUnchanged` | 4.2, 3.2 |
| Forge outages or expired logins during long jobs | failure mode | lost work | waits with reasons `network` and `auth` instead of failures; resume control | 4.3, G17 |

### Limits

*   **Disk:** each job holds one workdir (repo size plus installed dependencies, often several GB for Node or Rust projects) until it ends `succeeded` or `not_delivered`, or until a failed or stopped job is archived or deleted. Before a job starts, the engine checks free disk space; below the threshold in settings (default 10 GB) the job waits with reason `disk`.
*   **Parallel jobs:** the default `jobs` limit is the number of CPU cores divided by 2, and `agents` is 4; both are settings. The real limit is usually the providers' quotas.
*   **Polling:** merge detection checks succeeded parent jobs with live children every five minutes.
*   **Storage growth:** `pecore.db` grows with job history and raw attempt logs. Both stay until the user deletes the job or project.
*   **One machine, one user:** `PECORE_HOME` is used by one app instance (lock file); no multi-user access.

## Changes from the Concepts Brief

| Decision | Brief said | Design says | Reason |
|---|---|---|---|
| D9 | each project picks its OS user: the author's own or a dedicated one | one global mode: normal (agents run as the app user, the default) or protected (all projects, the Assistant and the Project Managers run as `pecore-agent`) | one login per account is already friction; a per-project user would multiply logins |
| D11 | workdir kept on failure or takeover | a failed or stopped job keeps its workdir until it is archived or deleted; a `succeeded` or `not_delivered` job loses it | the user inspects what agents left; ended jobs need no workdir |
| D18 | `events.db`; global state includes secrets | `pecore.db`; no secrets anywhere | naming; D27 |
| D26 | delete removes the remote branch and open PR/MR too | delete is local only; remote branches and PRs/MRs stay | remote cleanup depends on the forge and cannot be undone |
| D25 | delete only when stopped | delete in any final state, if no live children | a finished job need not be stopped first; children need their parent's branch |
| D23 | work stops when the app is closed | closing the window keeps the app and its jobs running in the tray; only Quit stops them | closing a window by mistake must not stop several running jobs |
| D27 | exception: credentials no tool stores go to `safeStorage` | no exception, no `safeStorage` | the only use was a Jira token, and Jira has tools that keep their own login |

## Detailed Implementation

The repository holds only `docs/` today. Every file below is new unless marked "(exists)" or "(changed)". Unit tests sit next to the file they test (`<name>.test.ts`); the tests that verify a goal or a security rule are listed in "Tests".

### Fixed implementation choices

*   **Engine process:** started with Electron `utilityProcess.fork`, so it runs on Electron's Node and uses the same `better-sqlite3` build as the app. It talks to the main process only through `process.parentPort` (protocol below).
*   **Admin prompt:** the privileged script is passed as text, never as a file: `pkexec /bin/sh -c "<script>"` on Linux, `osascript -e 'do shell script "/bin/sh -c " & quoted form of "<script>" with administrator privileges'` on macOS. Root cannot read the AppImage mount, and a temporary file could be changed before root runs it. With no polkit agent running, the GUI falls back to the guided procedure.
*   **Project ids:** match `^[a-z][a-z0-9-]{0,23}$`, so they are safe in paths and compose project names.
*   **Protected user, Linux:** `groupadd pecore-agent`; `useradd --system --create-home --gid pecore-agent --shell /bin/sh pecore-agent`; `usermod -aG pecore-agent <app user>`.
*   **Protected user, macOS:** `dseditgroup -o create pecore-agent`; `sysadminctl -addUser pecore-agent -UID <free id below 500> -password <random> -home /Users/pecore-agent`; `createhomedir -c -u pecore-agent`; `dscl . -create /Users/pecore-agent IsHidden 1`; `dseditgroup -o edit -a <app user> -t user pecore-agent`; `dscl . -create /Users/pecore-agent PrimaryGroupID <group id>` (`sysadminctl` assigns `staff`).
*   **Turning protected mode on:** one admin prompt creates the user, group and sudo rule; then, as the app user, every project's `repo.git` and `work/` get the group and the ACLs below, and the directories on the path to the adapters and to each model account's harness program (the link and its target) get a traverse-only ACL for `pecore-agent`, set by the app user from its home downwards. No admin prompt opens when the script has nothing to do (the user exists and there is no project). Every process run through sudo starts from `/` and changes to its working directory as the target user, because that directory may be closed to the app user (for example the home of `pecore-agent`). Turning it off stops nothing that runs: jobs pause, and the next node runs as the app user. The user and its logins are kept unless the user asks to remove them (admin prompt); removing them also removes the traverse ACLs added for the adapters and the harnesses, before the user is deleted.
*   **Group membership:** a new group is not active in the running app's session. The app never relies on it: it owns `repo.git`, and gives the group access through ownership of the writable subdirectories. Nothing else needs the app user to be in the group.
*   **Sudo rule:** written to a temporary file, checked with `visudo -c -f <tmp>`, installed with `install -m 0440 -o root -g root` (group `wheel` on macOS) as `/etc/sudoers.d/pecore-agent`. Content: `<app user> ALL=(pecore-agent) NOPASSWD: ALL` and `Defaults>pecore-agent !use_pty`. Without `!use_pty`, sudo 1.9.14 and later run the command in a new session on a pty, and the engine cannot signal its process group.
*   **ACLs:** `setfacl -m u:pecore-agent:--x <dir>` on Linux; `chmod +a "pecore-agent allow search" <dir>` on macOS.
*   **Claude Code login, macOS, protected mode:** the `darwin` entries of `beforeLogin` and `beforeStart` in `connectors/claude-code.json`, run as the project user through `sudo -n -H -u`. Before the first login: `security create-keychain -p "" ~/Library/Keychains/pecore.keychain-db`, `security default-keychain -d user -s <path>`, `security list-keychains -d user -s <path>`, `security set-keychain-settings <path>` (no automatic lock). The name must not be `login.keychain-db`: unlocking it fails right after creation. Login: `claude auth login --claudeai` with the account's `CLAUDE_CONFIG_DIR`; it prints a URL and reads the code on stdin. Before every connector start: `security unlock-keychain -p "" <path>`. Verified by hand in the spike with a password; to verify with an empty password, and that token refreshes are written back to the Keychain, in the macOS pass.
*   **Process groups:** the engine spawns `sudo -n -H -u <user> -- /usr/bin/setsid /bin/sh -c 'echo "PECORE_PID $$" >&2; exec env -i "$@"' sh <VAR=value>... <program> <args>...` with `detached: true`; variables and arguments are passed as arguments, never spliced into the script. The shell's pid arrives as the first stderr line (sudo closes file descriptors above 2 by default, so a separate descriptor would not survive it), and `exec` keeps that pid for the program. With `!use_pty` the group is sudo's, so `setsid` makes the shell the leader of its own session and group; it does not fork, because sudo's child is not a group leader, so the printed pid is the pgid ([sudo spike](spikes/sudo.md)). macOS has no `setsid` command: settled in the macOS pass. Stop: `sudo -n -u <user> kill -s TERM -<pgid>`, then `-s KILL` after 5 seconds. It stops the adapter, Claude Code and the shell commands Claude Code runs (each in its own session, ended by Claude Code on `TERM`); a process the agent detaches itself survives until the restart sweep. In protected mode `spawn` returns once the pid line has arrived (at most 5 seconds, else the spawn fails and sudo's own process is killed); in normal mode the child's pid is known at once. The engine records the pgid before any ACP request, so a stop or a restart sweep always has it.
*   **repo.git:** created with `git clone --bare` (or `git init --bare` plus an empty commit made with `git mktree </dev/null`, `git commit-tree`, `git update-ref`). Then `core.sharedRepository group`, `gc.auto 0`, `maintenance.auto false`, the fetch refspec `+refs/heads/*:refs/remotes/origin/*`, in protected mode `chgrp -R pecore-agent` and `chmod -R g+rwX` with `g+s` on `objects/`, `refs/`, `logs/`, `worktrees/`. `factory/*` branches are deleted by the app user with `--git-dir`. The project user runs `git --git-dir=<repo.git> worktree add`.
*   **Git credentials:** git ignores `GH_TOKEN`, so engine git network commands set a credential helper per forge tool: `-c credential.helper= -c 'credential.helper=!gh auth git-credential'` for GitHub, `!glab auth git-credential` for GitLab, `!aws codecommit credential-helper $@` for CodeCommit, the user's helper for `git`.
*   **Push:** `git --git-dir=<repo.git> push --force-with-lease=refs/heads/factory/<id>:<expected> origin {job.commit}:refs/heads/factory/<id>`, where `<expected>` is the SHA the probe read with `ls-remote`, or empty when the branch does not exist.
*   **Accounts per tool:** `gh auth token --user <login> --hostname <host>` (gh 2.40 or later). `glab` keeps one token per host, so <PE/CORE> supports one GitLab account per host and sets `GITLAB_TOKEN` from `glab config get token --host <host>`.
*   **Compose:** Compose v2 is required and its version is checked at first run. Runtime to command: Docker, Colima and OrbStack use `docker compose`; Podman uses `podman compose` with the docker-compose v2 provider. Apple `container` is not supported (no compose). Project name `pecore-<job id in lower case>`. Orphans are found with `compose ls --all --filter name=pecore- --format json`.
*   **Harness permissions:** agents get full permission inside their harness, with network access (author decision). Each connector file's `sessionConfig` selects the most permissive mode: Claude Code `mode` = `bypassPermissions` (run as `pecore-agent` in the [sudo spike](spikes/sudo.md)), Codex `mode` = `agent-full-access` (offered in the recorded traffic). The engine answers any remaining `session/request_permission` as in 5.2. The security boundary is the project user (section 8).
*   **ACP:** protocol version 1. The client is written in `@pecore/agents` on `node:child_process` and `node:readline`, about 80 lines in the spike (`docs/spikes/acp/client.mjs`); the `@agentclientprotocol/sdk` types are used for message shapes only. Requests used: `initialize`, `session/new`, `session/resume`, `session/load`, `session/set_config_option`, `session/prompt`, `session/cancel`; client methods answered: `session/request_permission`; any other request from the agent is answered with error `-32601`. `initialize` declares no file system and no terminal capability, so the harness reads and writes files and runs commands itself, as the project user.
*   **Libraries:** `@modelcontextprotocol/sdk` for the MCP server; `@fastify/websocket`; `ulid`; Node's `zlib` zstd if Electron's Node supports it (Node 22.15 or later), otherwise `@mongodb-js/zstd`; `tar` for export archives (`.tar.zst`); `electron-updater` with GitHub Releases as the feed.
*   **Tests and native modules:** Vitest runs under Electron's Node (`ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs`), so `better-sqlite3` loads with one build. `.npmrc` sets `node-linker=hoisted`, which electron-builder needs with pnpm.
*   **macOS release:** targets `dmg` and `zip` (auto-update needs `zip`), signed with a Developer ID and notarized in `release.yml`; certificates come from GitHub Actions secrets.
*   **Package names:** `@pecore/schemas`, `@pecore/agents`, `@pecore/engine`, `@pecore/app`, `@pecore/cli`.
*   **Adapters:** `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, at versions pinned in `packages/agents/adapters.json`. They are not workspace dependencies: pnpm hoists dependencies to the root, so a copied package would not find its own. `packages/agents/scripts/build-adapters.mjs` creates `out/adapters/<package>@<version>` (npm does not create a nested prefix such as `@agentclientprotocol/...`) and runs `npm install --omit=optional --no-package-lock --prefix out/adapters/<package>@<version> <package>@<version>` for each, so each directory holds the package with its own `node_modules` and without the bundled harness copies. The same script downloads the official Node LTS archive for the target platform from nodejs.org, checks its SHA-256 against the published `SHASUMS256.txt`, and unpacks it to `out/adapters/node/`. electron-builder ships `out/adapters` as extra resources. The Electron binary is not used to run adapters, because in an AppImage it is readable only by the app user. When the app version differs from the one in `PECORE_HOME/adapters/version`, `home/layout.ts` copies the adapters there keeping their file modes, removes directories of versions no longer pinned, and writes the new version.
*   **Claude Code version:** the adapter's Agent SDK expects a Claude Code at least as new as the one it bundles. The connector's `versionRange` is therefore a lower bound only (`>=` that version), and newer releases are accepted.

### Data model

Events (`src/events.ts`). Each row of `events` has `id` (ULID), `job_id`, `type`, `payload` (JSON), `at`. Every event updates the listed views in the same transaction.

| Event | Payload | Views changed |
|---|---|---|
| `job.created` | recipe, title, request, optional ticket ID, parent, base branch, base commit, target | `jobs` insert |
| `job.state_changed` | state, reason | `jobs.state`, `jobs.waiting_reason` |
| `job.base_change_requested` | cause, base commit (null: the head of the target when applied), target | none; the latest request after the last `job.base_changed` is pending |
| `job.base_changed` | cause (`parent_commit`, `parent_merged`, `realign`), new base commit, old base commit, new target | `jobs.base`, `jobs.old_base`, `jobs.target` |
| `job.delivery_merged` | delivery URL | `jobs.merged_at` |
| `job.archived`, `job.unarchived` | | `jobs.archived` |
| `node_run.created` | node, round, the index of the edge that started it (null for `start` and `onBaseChanged`) | `node_runs` insert |
| `node_run.state_changed` | state, waiting reason, reset time, queue item id for human review or round limits, account id, OS user and login type for authentication | `node_runs` |
| `node_run.git_recorded` | branch SHA, HEAD, `refs/stash` | `node_runs.git_before` |
| `node_run.completed` | outcome, files hash after, artifacts | `node_runs` |
| `node_run.failed` | failure reason | `node_runs` |
| `attempt.started` | profile, connector, harness and connector versions, OS user, agent card ID and context mode | `attempts` insert |
| `attempt.session_started` | ACP session id, `resumed` | `attempts.session_id`, `attempts.resumed` |
| `attempt.ended` | end reason (outcome, waiting reason or failure reason), resolved model, tokens (input, output, cache read, cache write), cost | `attempts` |
| `effect.requested`, `effect.completed`, `effect.failed` | node, command hash, result | none |
| `queue.added`, `queue.resolved` | kind, subject, choice, note | `human_queue` |
| `ticket.seen` | source, ticket id | `tickets_seen` |

Tables (`src/store/migrations/`):

| Table | Columns |
|---|---|
| `jobs` | `id` pk, `title`, `recipe` (resolved recipe at job creation), `state`, `waiting_reason`, `failure_reason`, `parent_job_id`, `base_branch`, `base`, `old_base`, `target`, `branch`, `archived`, `merged_at`, `created_at`, `updated_at`; index on `state`, `parent_job_id` |
| `node_runs` | `id` pk (`<job>/<node>#<round>`), `job_id`, `node`, `round`, `via_edge`, `state`, `outcome`, `waiting_reason`, `reset_at`, `queue_item_id`, `auth_account`, `auth_os_user`, `auth_kind`, `failure_reason`, `files_hash_before`, `files_hash_after`, `git_before` (JSON), `pgid`, `os_user`, `started_at`, `ended_at`; index on `job_id` |
| `attempts` | `id` pk (ULID), `node_run_id`, `profile`, `connector`, `harness_version`, `connector_version`, `model`, `account`, `os_user`, `agent_id`, `agent_session`, `session_id`, `resumed`, `tokens_in`, `tokens_out`, `cache_read`, `cache_write`, `cost`, `end_reason`, `log_omitted`, `started_at`, `ended_at` |
| `attempt_logs` | `attempt_id` and `sequence` form the primary key. `direction`, `at` and `payload` describe the message |
| `human_queue` | `id` pk, `job_id` (nullable), `kind` (`human-node`, `agent-question`, `engine-node`, `source-node`, `connector`, `recipe-change`, `import`, `ticket`, `services`, `round-limit`, `outbound`), `subject` (JSON: a snapshot of everything the user must see to decide, for example the full node definition and script, never re-read from disk at decision time), `subject_hash` (sha256 of `subject`), `state` (`open`, `resolved`, `cancelled`), `choices` (JSON), `choice`, `note`, `created_at`, `resolved_at` |
| `tickets_seen` | `source`, `ticket_id`, `seen_at`; pk on both |
| `schema_version` | `version` |

`chats.db`: `chats` (`id`, `title`, `last_read_at`, `created_at`), `messages` (`id`, `chat_id`, `role`, `text`, `context` (JSON references), `reply_to` (on a reply: the user message it answers), `created_at`), `attachments` (`id`, `message_id`, `path`, `mime`), `actions` (`id`, `message_id`, `tool`, `target` (JSON reference: job, definition path or queue item), `created_at`; written by the MCP tool handlers, read by the GUI for the chat cards), `notifications` (`id`, `kind`, `title`, `body`, `target`, `created_at`; the last 500 are kept).

### Connector file

`packages/schemas/src/connector.ts` defines this shape; `packages/app/resources/connectors/claude-code.json` is the reference example. Fields that differ by platform take either one value or `{ "linux": ..., "darwin": ... }`.

| Field | Meaning |
|---|---|
| `name`, `title` | identity |
| `kind` | `native` or `adapter` (5.6) |
| `harness` | `{ "program", "versionArgs", "versionRange" }`: the harness program the user installs, the arguments that print its version, and the supported semver range (for Claude Code a lower bound only, Fixed choices) |
| `command` | argument array that starts the connector, with the placeholders `{harnessPath}` (absolute path of `harness.program`, 5.7), `{nodePath}` and `{adapter:<package>}` (the entry file of the adapter version this app pins); for example `["{harnessPath}", "acp"]` or `["{nodePath}", "{adapter:@agentclientprotocol/claude-agent-acp}"]` |
| `env` | variables for the connector, with the same placeholders; for Claude Code `{ "CLAUDE_CODE_EXECUTABLE": "{harnessPath}", "ENABLE_CLAUDEAI_MCP_SERVERS": "false", "DISABLE_AUTOUPDATER": "1" }` (5.6) |
| `configDirEnv` | variable for the per-account config directory (3.4), or `null` |
| `configDirFiles` | files written into a new config directory, for example Codex `config.toml` with `cli_auth_credentials_store = "file"` (3.4) |
| `sessionConfig` | ordered list of ACP config options set at every session start (5.2): `[["<option id>", "<value>"], ...]` with the placeholders `{model}` and `{effort}`; Claude Code `[["mode", "bypassPermissions"], ["model", "{model}"], ["effort", "{effort}"]]`; Codex `[["mode", "agent-full-access"], ["model", "{model}"], ["reasoning_effort", "{effort}"]]` |
| `sessionMeta` | object sent as `_meta` of `session/new`, `session/resume` and `session/load` (5.2); Claude Code `{ "claudeCode": { "options": { "strictMcpConfig": true } } }` (5.6) |
| `reader` | name of the reader in `@pecore/agents` (`claude-code`, `codex`, `opencode`, `pi`), or `null` (5.3) |
| `errors` | list of `{ "pattern": <regex>, "in": "error" \| "text", "kind": "quota" \| "rate_limit" \| "auth" \| "other", "resetAt": <regex group name or null>, "resetFormat": "epoch" \| "iso" \| "seconds" }`; `error` is a JSON-RPC error message, `text` the agent's text of the turn (5.4); `seconds` counts from when the message arrived |
| `loginCommand` | the harness's interactive login command, per platform; for Claude Code `["{harnessPath}", "auth", "login", "--claudeai"]`; for pi `["script", "-qefc", "exec \"$PECORE_PI_NODE\" \"$PECORE_PI_ADAPTER\" --terminal-login", "/dev/null"]` on Linux and the equivalent `script` invocation on macOS, because pi's own interactive login needs a pseudo-terminal and the user chooses the provider there |
| `loginUrlPattern`, `loginReadsCode` | regex of the URL the GUI shows; whether the command then reads a code on stdin (5.9) |
| `beforeLogin`, `beforeStart` | optional lists of argument arrays per platform, run as the project user before the first login and before every connector start, only for logins in a `PECORE_HOME/harness/` directory (3.4), never for the harness's own default one; for example the Claude Code Keychain steps on macOS (Fixed choices) |
| `identityCommand`, `identityField` | used only when the connector reports no account at session start (5.9) |

Recorded ACP traffic for tests lives in `packages/agents/fixtures/<connector>/<case>.jsonl`, in the raw log format (section 9). Each case has a `<case>.expected.json` with the events and the `TurnResult` it must give. The five files recorded in phase 0 (`claude-code/two-turns`, `claude-code/permission`, `claude-code/auth-missing`, `codex/tool-call`, `opencode/auth-missing`) have no `at` field; the test loader accepts lines without it, and their `expected.json` files are written in phase 3. The three files of the sudo spike (`claude-code/protected-new`, `protected-resume`, `protected-stop`) have it.

### Local API, WebSocket and MCP

*   The engine binds `127.0.0.1` on port 0 and writes `run/api.json` (`{ "port", "token" }`, mode 0600). The token is a random 32-byte value made by the engine at each start. The engine also sends port and token to the main process in `ready`; the main process gives them to the renderer through preload and never reads the file. The CLI reads the file.
*   Every request carries `Authorization: Bearer <token>`, except `/live`, which authenticates with its first message. The server also checks `Host` and `Origin` (Phase 5 decisions).

| Method and path | Purpose |
|---|---|
| `GET/POST /projects`, `GET /projects/:id` | list, create and read projects. A new project starts with no recipes. The Settings form and Assistant validate edits to `project.json`. |
| `POST /projects/:id/export`, `POST /projects/import` | export and CLI archive import |
| `POST /projects/import/analysis` | CLI archive security review |
| `POST /projects/import/preview`, `POST /projects/import/complete` | review a local export or extracted folder, then import the reviewed contents with the selected ID and forge accounts |
| `POST /chat/actions/:id/project-import`, `POST /chat/actions/:id/project-export` | confirm or reject a chat import proposal or a flagged export |
| `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/why` | list and read |
| `POST /jobs` | create (Job creation below) |
| `POST /jobs/:id/{stop,pause,play,resume,archive,delete,realign,check-merge}` | job controls. `check-merge` runs merge detection for the job immediately. |
| `POST /pause`, `POST /play`, `POST /play-interrupted` | global controls; `play-interrupted` plays every job paused by the app quit |
| `GET /projects/:id/creation`, `POST /projects/:id/creation/{retry,cancel}` | creation progress, errors and recovery actions |
| `GET /status` | app version, home check warnings, global pause, jobs paused by the quit, Notifications count |
| `GET /setup` | what auto-setup found: each built-in harness (installed, version, logged in) and whether any model account works; feeds the banner of ui-design.md "Zero-config start" |
| `POST /prerequisites/check` | checks the prerequisites for the features in use and points each result to its setting |
| `GET /queue`, `POST /queue/:id` | waiting items and the user's choice; the body carries `{choice, note, input, hash}`, where `hash` is the sha256 of the item's `subject` the GUI showed; the engine refuses the choice (409) if the item changed, was resolved or was cancelled since |
| `GET /definitions?dir`, `GET/PUT /definitions/*path`, `POST /definitions/validate`, `POST /definitions/instantiate` | templates and instances by resource path (`templates/...`, `projects/<id>/...`). `GET` returns the current revision hash. `PUT` checks `baseSha256` (null for a new resource) and returns 409 if the revision changed. `validate` returns `errors` and `warnings`; for a knowledge file both carry line and column. Listing a knowledge directory returns each file's internal links as `value.links` |
| `POST /projects/:id/knowledge`, `POST /projects/:id/knowledge/rename`, `DELETE /projects/:id/knowledge/:name` | knowledge files: upload up to 50 `.md` files at once (their links may point to each other; a link to a file that is in neither the project nor the upload, or with a path, is removed and its text kept, and the response lists the removed links; an existing name is 409), rename one and update the links that point to it, delete one; each is one commit |
| `DELETE /projects/:id` | project delete (4.8) |
| `POST /protected-mode` | `{on: true}` creates `pecore-agent` if missing and switches every project to it; `{on: false}` switches back; `{on: false, removeUser: true}` also removes the user (admin prompt) |
| `POST /accounts/:id/recheck` | re-runs the identity check of a forge or service account, or of every login of a model account, and releases runs waiting with `auth` on them |
| `POST /chat/read` | mark the Assistant chat as read |
| `GET /notifications`, `POST /notifications/seen`, `DELETE /notifications/:id` | list the log, mark all seen or delete one notification |
| `GET/PUT /settings`, `/accounts`, `/profiles`, `/tiers` | global files; `GET` returns the value and its sha256, `PUT` carries `baseSha256` (409 when the file changed since); `protectedMode` changes only through `POST /protected-mode` |
| `GET /logins`, `POST /logins` | harness logins (account and OS user, 3.4) with their state; start one (`{account, osUser}`); progress and the URL over WebSocket |
| `POST /logins/:id/code`, `POST /logins/:id/recheck` | send the code the login command reads on stdin (5.9); re-run `checkLogin` and release runs waiting with `auth` on that login |
| `POST /accounts/:id/login` | start a forge or service tool login; progress over WebSocket |
| `GET /accounts/:id/options` | cached model choices for an account. With `?model=`, returns the effort choices for that model. |
| `POST /accounts/:id/options/refresh` | refresh the account's available choices |
| `GET /chat`, `DELETE /chat` | read or clear the Assistant's only chat (section 6) |
| `POST /chat/messages`, `POST /chat/attachments`, `POST /chat/messages/:id/retry` | send a message with optional context references and attachments, upload an attachment or retry a turn |
| `GET /chat/attachments/:id`, `GET /projects/:id/chat/attachments/:attachmentId` | an attachment of that chat as `mime` and base64 `data`, for the image thumbnails of sent messages |
| `GET/DELETE /projects/:id/chat`, `POST /projects/:id/chat/messages`, `POST /projects/:id/chat/attachments`, `POST /projects/:id/chat/messages/:messageId/retry`, `POST /projects/:id/chat/read` | the same operations on the project's Project Manager chat (section 6) |
| `POST /chat/actions/:id/project-creation`, `POST /chat/actions/:id/project-update`, `POST /chat/actions/:id/project-deletion` | confirm or reject an Assistant proposal |
| `GET /artifacts/:job/:run/:name` | artifact metadata and content from the project database |
| `GET /logs/:attempt?view=events\|raw` | Normalised events or raw JSON lines from `attempt_logs`. Returns 410 when the log is unavailable |

*   WebSocket `/live` sends a union of `job.updated`, `node_run.updated`, `queue.updated`, `project.updated` (a creation step changed), `definition.changed` (path, new hash), `configuration.changed` (`settings`, `agents`, `accounts`, `profiles` or `tiers`), `log.line` (one normalised event), `login.progress`, `chat.changed`, `notify`. `log.line` is sent only for attempts the client subscribed to (`{subscribe: attempt id}`, `{unsubscribe: attempt id}`), so the GUI receives the lines of the log it shows and nothing else.
*   MCP uses a separate loopback endpoint with a private token. The harness talks to it through the stdio shim (section 6 and Phase 6 decisions).

### Engine and main process messages

Over `parentPort`: engine to main `ready {port, token}`, `error {message}` (the engine could not start; main shows it and quits), `notify {title, body, kind}`, `admin {script}` (main runs the admin prompt and replies `admin.result`), `active {jobs}` (reply to `active?`), `shutdown.done`. Main to engine: `active?`, `shutdown`.

Window and tray: closing the window hides it; the app, the engine and the jobs keep running. A tray icon (Electron `Tray`) shows the number of running jobs and notifications, and has "Open <PE/CORE>" and "Quit". The app holds a single-instance lock (`app.requestSingleInstanceLock()`): launching it again shows the existing window, so the window can be reopened on a Linux desktop with no tray. The first time the window is hidden, a notification says that jobs keep running and how to quit.

Quit (tray, app menu, Cmd+Q): main asks the engine `active?`. If jobs are `running` or `waiting`, a dialog says how many jobs will be interrupted and that they will be `paused` at the next start; the user confirms or cancels. Then on `before-quit` the main process calls `event.preventDefault()` once, sends `shutdown`, and waits for `shutdown.done` for at most 15 seconds. The engine stops every process group (TERM, then KILL after 5 seconds), runs the leftover sweep of section 1, runs `compose down -v` for its `pecore-*` projects, closes the databases and replies. Then main calls `app.exit()`. At the next start, if jobs were paused by the quit, Factory shows "Play interrupted jobs", which plays all of them.

### Project creation

The wizard and Assistant collect the name, repository choice (local, existing remote or new remote), any forge account, folder and base branch. Pick a local folder or accept the default from Settings. The ID comes from the name in lowercase with dashes, with a maximum of 24 characters and a numeric suffix (`-2`, `-3`, …) when taken. The wizard has no ID field.

The Assistant fills in choices when the user delegates them, validates the inputs and shows a card. Confirm starts the same creation as the wizard. A new project has no recipes. Users add recipes later. Validation refuses a recipe that uses a remote operation, such as push, PR, MR or ticket comment, on a project without a remote.

`src/projects/create.ts` runs the steps below. A failed step reports the error and rolls back completed local steps.

1.  Validate the id. With a `repo`, also validate its URL and account and check the account belongs to the repo's forge and host; with `repo: null` there is no forge account to check. With a `folder`: it must be an absolute path, and missing, empty, or the root of a Git repository; with `repo: null` or `createRepo`, a repository folder must have the branch `baseBranch`.
2.  Nothing to create for the OS user: in normal mode the project runs as the app user; in protected mode `pecore-agent` already exists.
3.  Create the project directory, `project.json`, `pecore.db`; set ownership and permissions (section 8).
4.  With `repo: null`: create `repo.git` with one empty initial commit on `baseBranch`; no `createRepo`, no clone. If the remote exists: clone into `repo.git`. Otherwise create the empty repo and run the `createRepo` node once under `project-setup`. With `repo: null` or `createRepo`, a `folder` that is a repository is cloned into `repo.git` instead of the empty repo, so its code is the project's start and, with `createRepo`, the new remote's content. Then the folder: a missing or empty one gets a clone of `repo.git` on `baseBranch`, with the remote as its `origin` or, with `repo: null`, no `origin`; an existing repository without `origin` gets the remote as `origin`, and is otherwise left as it is. With `repo: null` the folder is `origin` of `repo.git`. <PE/CORE> never deletes the folder, also when creation is cancelled. Repository setup runs as part of creation.
5.  Configure `repo.git` (Fixed choices), run the home check, commit the definitions to `PECORE_HOME`.
6.  In protected mode, give `pecore-agent` access to the new project (group and ACLs, Fixed choices). No login is needed: logins belong to the user, not to the project.

### Auto-setup

Harness and forge checks run in parallel outside the configuration lock. Each provider publishes its accounts when its check finishes. Settings reads and writes can continue during discovery. Generated harness profiles and tier entries are saved in connector order once the harness checks finish.

At startup the engine also reads the app user's authenticated `gh` and `glab` identities and checks configured AWS CLI profiles for CodeCommit access. It adds missing accounts by service, host and user, or by host and AWS profile for CodeCommit. An AWS profile must have a region, a working STS identity and permission to list CodeCommit repositories to be discovered. The listing check uses at most one result. All three tools use the app user's existing sessions. Auto-setup never adds plain Git accounts.

`src/home/autosetup.ts`, run by `Engine.start` after the home and the connectors are loaded, and again when a harness login finishes. It only adds what is missing: it never edits or removes an account, profile, tier entry or setting the user has. Each run that changes something is one `PECORE_HOME` commit `auto-setup: <what>` and one notification, for example "Set up Claude Code and Codex: 8 profiles".

1.  Harnesses: for each built-in connector, in the order claude-code, codex, opencode, pi, the harness is found in the supported version range and the user is logged in (the connector's login check; opencode and pi have no identity, so they count as logged in when they list at least one model).
2.  Accounts: each such harness with no model account on its connector gets `{ id: <connector name>, kind: "model", connector, login: "subscription" }`, with its provider.
3.  Profiles: models and efforts are read from each harness at every start, never written in <PE/CORE>: `listOptions` (models, efforts, the current default model); for opencode, `opencode models` and the default model of the user's opencode configuration, otherwise the first model it lists; for pi, the model and thought-level options of its ACP session. Each account gets the profiles `<connector>-frontier`, `-strong`, `-standard` and `-cheap`. The only fixed part is a ranking rule on model names that holds across versions: a name with `opus`, `pro`, `max` or `ultra` ranks as frontier, `sonnet` as middle, `haiku`, `mini`, `flash`, `lite` or `nano` as cheap. Frontier takes the best ranked model, strong and standard the harness's default model, cheap the cheapest ranked model; a tier with no ranked model takes the default model. Efforts come from the harness's list: frontier and strong the highest, standard the middle one, cheap the lowest; a harness that offers no effort leaves it unset. At every start, a profile that auto-setup created and the user has not changed since is updated to what the harness offers now; `PECORE_HOME/auto-setup.json` records the values auto-setup last wrote, so a profile the user changed is never touched.
4.  Tiers: each tier gets new profiles appended after the existing ones, in connector order.
5.  Agent cards: the app creates both cards before harness discovery and fills missing models from the first Standard profile when available. It can fill an unset model at a later login. Existing model selections are preserved.

When no harness is ready, both cards still appear and the GUI shows the connection banner.

### Job creation

`src/jobs/create.ts` is used by `POST /jobs`, `create_jobs` from the Assistant and Project Manager. A job without a recipe gets the project's only recipe; with no recipes or more than one, creation fails and asks to add or choose one. It validates the recipe, stores the request and optional tracker ID, fetches the base branch (for a `repo: null` project only from its `folder`, if any; without one the base branch lives only in `repo.git`), and sets base commit, target and branch. A job with an unfinished parent is created `queued` with reason `parent_job`; otherwise it waits for the scheduler and the disk check. When the job starts, the engine fetches its target branch again (unless the target is a `factory/` branch of a parent) and creates the worktree from the fetched head, recorded as `job.base_changed` with cause `fetched`; if that fetch fails, the job stays `queued` with reason `network` or `auth` and never starts on an old base.

### Tests

Run typecheck, lint and engine tests for every code change. Defer GUI tests until the redesign is stable. `pnpm dev` runs the app with live reload and needs no prior build.

V8 measures statements, branches, functions and lines under `packages/*/src` with an 80% threshold for each. Test files, the renderer design system and the component gallery are excluded.

| File | Scenario | Runs |
|---|---|---|
| `graph/rules.test.ts` | property tests of 4.2 | CI |
| `workdir/fs-as.test.ts` | symlinks at every engine file path | CI (Linux, with a test user) |
| `workdir/git-as.test.ts` | hooks, `core.fsmonitor`, `core.sshCommand` and a forged `commondir` do not run as the app user | CI (Linux, test user) |
| `workdir/files-hash.test.ts` | `READ_ONLY_VIOLATION` restore; `requires` gives `stale`; interrupted rebase is undone | CI |
| `definitions/engine-node.test.ts` | Repository nodes run with the current scripts without approval | CI |
| `agents: src/connectors.test.ts` | for each built-in connector, the incoming messages of each fixture go through the reader and the classifier, and the result must equal `<case>.expected.json`: auth, quota and rate limit errors (synthetic until recorded, 5.4), usage, account (G7) | CI |
| `agents: src/session.test.ts` | ACP session with the fake agent: options applied in order and checked, a mismatching `currentValue`, permission answered, resume and fallback to a new session, a request past 30 seconds, connector exit without answer | CI |
| `engine: runners/agent.test.ts` | agent node with the fake agent: the order of 5.4, invalid output corrected twice then `INVALID_OUTPUT`, timeout with cancel then stop, `retry` use, quota and auth waits, resume lookup (5.5) | CI |
| `phase 0: Claude Code through sudo` | done ([sudo spike](spikes/sudo.md)); by hand, with the spike client `docs/spikes/sudo/client.mjs`, the adapter installed with `npm install` into a directory `pecore-agent` can read, and a Node LTS from nodejs.org in the same kind of directory (the real build of phase 3 is not needed); recorded as fixtures: the adapter, that Node and the user's Claude Code run as `pecore-agent` (protected mode) with a new config directory; a session in `bypassPermissions`; a resume in a new process; no claude.ai MCP servers and no repository `.mcp.json` servers in the session; stopping the process group stops the harness | manual, real login |
| `jobs/crash.test.ts` | kill during each delivery node, restart, no double delivery (G12) | CI with the fake forge |
| `jobs/stacked.test.ts` | three-job chain: parent recommit, parent merge, parent failure (G9) | CI with the fake forge |
| `e2e/languages.test.ts` | same recipe shape on a TypeScript and a Rust fixture project (G2) | CI |
| `e2e/forges.test.ts` | delivery to GitHub, GitLab, local only (G3) | manual, sandbox accounts |
| `e2e/providers.test.ts` | `feature-to-local-commit` with three connectors: Claude Code, Codex, opencode (G6) | manual, real logins |
| `e2e/pi.test.ts` | pi login, models and efforts from its ACP session, and one agent node end to end | manual, real login |
| `e2e/why.test.ts` | `why` output for every waiting reason (G13) | CI |

The fake forge (`test/fake-forge/`) is a local bare repo plus scripts that imitate the `gh` commands used by the GitHub templates. The fake agent (`test/fake-agent/agent.mjs`, outside the build) is an ACP agent that follows a script named by the variable `FAKE_AGENT_SCRIPT`: a JSONL file of steps `{ "expect": <method> }`, `{ "send": <JSON-RPC message> }`, `{ "write": { "path", "content" } }`, `{ "sleep": <ms> }`, `{ "exit": <code> }`. Tests use it through a connector file of kind `native` with `harness.program` `node` and reader `claude-code`.

### Root

| File | What and why |
|---|---|
| `package.json` | pnpm workspace root; scripts `dev`, `build`, `test`, `lint`, `typecheck`, `dist` |
| `pnpm-workspace.yaml` | lists `packages/*` |
| `tsconfig.base.json` | shared TypeScript strict settings |
| `vitest.config.ts` | `test.projects` lists every package; run under Electron's Node (Fixed choices) |
| `.npmrc` | `node-linker=hoisted` for electron-builder |
| `eslint.config.js` | lint rules for all packages |
| `.gitignore` | ignores `node_modules/`, `dist/`, `out/` |
| `LICENSE` | Apache License 2.0 |
| `NOTICE` | name and copyright notice required by Apache License 2.0 |
| `README.md` | what <PE/CORE> is, install, first run, build from source |
| `.github/workflows/ci.yml` | lint, typecheck and tests on Linux and macOS for every push |
| `.github/workflows/release.yml` | on tags: builds AppImage, deb, dmg and zip; signs and notarizes the macOS build; publishes to GitHub Releases for auto-update |

### `packages/schemas`: Zod definitions

Every file exports a Zod schema and the TypeScript type inferred from it. The engine, the app and the CLI import types only from here.

| File | What and why |
|---|---|
| `src/node.ts` | node schema of 3.1: common fields, fields by kind, `failOutcomes`, internal repeat and merge checks, `scratchPaths`, placeholder syntax check |
| `src/recipe.ts` | recipe schema of 3.2: `start`, `onBaseChanged`, `successOutcomes`, nodes, edges, `requires`, `skipWhenUnchanged`, `maxRounds` |
| `src/project.ts` | `project.json` of 3.5 |
| `src/accounts.ts` | account schema with the kinds `model`, `forge`, `service` |
| `src/profiles.ts` | profile schema |
| `src/tiers.ts` | tier schema with four fixed tier names |
| `src/settings.ts` | global job and agent limits, services runtime, minimum free disk (10 GB), merge check interval (300 seconds), `projectsFolder` (user home), the user's name, protected mode (off by default) and appearance |
| `src/connector.ts` | connector file (Connector file above) |
| `src/artifacts.ts` | the eight artifact contracts of 3.3, the structure of each, and the description agents read |
| `src/events.ts` | the events of Data model |
| `src/api.ts` | request and response bodies of the API table and the WebSocket union |
| `src/errors.ts` | waiting reasons and failure reasons of 4.3 |
| `src/index.ts` | exports |

### `packages/agents`: ACP client and connectors

Everything that knows ACP or a harness lives here (section 5). It imports only `@pecore/schemas`; the engine imports only `src/index.ts`.

| File | What and why |
|---|---|
| `src/index.ts` | the interface of 5.1: functions, `Login`, `Spawn`, `Session`, `TurnResult`, `AgentEvent` |
| `src/acp/client.ts` | JSON-RPC 2.0 over the `Spawn` streams, one message per line; requests with ids and the 30-second limit before the prompt, notifications, answers to agent requests (Fixed choices: ACP); emits every message and stderr line in the raw log format (section 9), with the MCP token replaced by `***` |
| `src/session.ts` | `startSession` and `Session` (5.2, 5.5): `beforeStart`, `initialize`, resume or new session, `sessionConfig` in order with the `currentValue` check, `session/prompt`; maps notifications to `AgentEvent`; answers permission requests; builds `TurnResult` |
| `src/connectors.ts` | loads built-in connector files from the app's resources; fills the placeholders of `command` and `env`; resolves `{adapter:<package>}` from `adapters.json` |
| `src/prerequisites.ts` | `checkPrerequisites`: runs the harness's `versionArgs` and the shipped `node --version` through `spawn` as the project user, checks `versionRange` |
| `src/errors.ts` | sets `TurnResult.error` for steps 2, 4 and 5 of 5.4: `-32000` with "Authentication required" is `auth`, a `rejected` quota is `quota`, then the connector's `errors` rules, else `other` when the turn did not end with `end_turn`; the engine applies the order of 5.4 |
| `src/readers/claude-code.ts` | usage with side models, resolved model, cost and `_claude/rateLimit` from the prompt answer and `usage_update` (5.3); `auth/status_update` to `account` (5.9) |
| `src/readers/codex.ts` | usage without double-counted cache (5.3); `_auth/status_update` to `account` |
| `src/readers/opencode.ts`, `src/readers/pi.ts` | the model from `config_option_update` and the selected model in the session answer (5.3); pi sends no token usage |
| `src/login.ts` | `prepareLogin` and `checkLogin` (5.9) |
| `src/options.ts` | `listOptions` (5.9) |
| `src/connectors.test.ts`, `src/session.test.ts` | Tests |
| `fixtures/<connector>/<case>.jsonl`, `<case>.expected.json` | recorded ACP traffic and the expected result (Connector file) |
| `adapters.json` | the adapter packages and versions this app pins (Fixed choices: Adapters) |
| `scripts/build-adapters.mjs` | installs each pinned adapter into `out/adapters/<package>@<version>/` (Fixed choices: Adapters) |

### `packages/engine`: the engine process

| File | What and why |
|---|---|
| `src/main.ts` | Opens the home and its databases, recovers interrupted jobs, starts the API and checks harness logins. Handles shutdown. |
| **home/** | |
| `src/home/layout.ts` | paths of section 2; on first run creates `PECORE_HOME` and `run/` (0700) and copies the shipped `templates/` into it; on every later start, copies shipped template files the home does not have, never overwriting a file (a shipped file the user deleted comes back); a file the app no longer ships is removed only while it is identical to a version the app shipped; a home from before the rename has its `library/` renamed to `templates/`; when the app version changed, copies the bundled adapters to `adapters/` (Fixed choices: Adapters) |
| `src/home/autosetup.ts` | Auto-setup: accounts, profiles, tiers and Assistant profile from the installed and logged-in harnesses (Detailed Implementation, "Auto-setup") |
| `src/home/git-commit.ts` | commits every definition change to `PECORE_HOME` (or to the project's own repo if it was moved) with the message `<kind> <name>: <created\|edited\|deleted>` |
| `src/home/lock.ts` | one engine per `PECORE_HOME`; a lock whose pid is not running is taken over |
| `src/home/prerequisites.ts` | first-run and start checks: git, sudo, setfacl (Linux), Compose v2; when an account needs them: gh 2.40 or later, glab; for each harness login, `checkPrerequisites` as its OS user (5.1), after adding the traverse ACLs of 5.7 |
| **projects/** | |
| `src/projects/create.ts` | Project creation above |
| `src/projects/defaults.ts` | the forge's nodes from `templates/forges/`: a recipe added to a project gets the delivery, comment, repo creation nodes of the project's forge (`github-pr` and `github-issue-comment`, or `gitlab-mr` and `gitlab-issue-comment`); a project without a remote repo (`repo: null`) gets no renames. A new project has no recipes: the user adds them afterwards |
| **definitions/** | |
| `src/definitions/load.ts` | loads and validates shipped definitions, archive entries and catalog records |
| `src/definitions/knowledge.ts` | knowledge checks with `markdownlint` and a custom link rule, link renaming, and the files a node receives with the files they link to |
| `src/definitions/recipe-check.ts` | recipe rules beyond the schema: `use` exists in the project, every edge outcome exists on its node, every read step produces something, each command input comes from exactly one read step and, when required, on every path (3.2), a parent recipe has a commit node (4.6), `providerNot` targets exist; in a project without a remote repo, no node that uses `project.account` (push, PR, MR, ticket comment), so saving or adding such a recipe fails |
| `src/definitions/seed.ts` | seeds shipped node, recipe, prompt, script and icon records when the format changes |
| **store/** | |
| `src/store/project-db.ts` | opens `pecore.db` in WAL mode, applies migrations, records events and reads and writes artifacts |
| `src/store/migrations/001-init.sql` | the tables of Data model |
| `src/store/migrations/005-artifacts.sql` | artifact content and metadata, with cascade deletion by job |
| `src/store/chats-db.ts` | Assistant chat, internal Project Manager sessions and notifications |
| `src/store/migrations/chats-001-init.sql` | the `chats.db` tables of Data model |
| **graph/** | |
| `src/graph/job-machine.ts` | job states and transitions of 4.1 |
| `src/graph/node-run-machine.ts` | node run states of 4.3 |
| `src/graph/rules.ts` | pure functions for running one node at a time, routing outcomes, counting edge rounds, and handling base changes (4.2) |
| `src/graph/rules.test.ts` | property tests with fast-check: a job never runs two nodes at once, rounds never exceed `maxRounds`, every job reaches a final state or `waiting` |
| `src/graph/executor.ts` | applies the rules to a job: picks the next node, applies `skipWhenUnchanged` (`git diff <base> <commit> \| git patch-id --stable`), asks the scheduler for pool units, hands the node to its runner, records the outcome, writes the `diff` artifact after `changesFiles: true` nodes; answers to `round-limit` queue items |
| **scheduler/** | |
| `src/scheduler/pools.ts` | in-memory pools of 4.7; takes all units at once or none; releases them while a job waits for a human, quota or login (4.3) |
| `src/scheduler/disk.ts` | before job start, checks free disk against `minFreeDiskGb`; below it the job waits with reason `disk` |
| `src/scheduler/cooldown.ts` | per-account cooldown after quota or rate limit errors; backoff 1, 2, 4, then every 8 minutes |
| **workdir/** | |
| `src/workdir/repo.ts` | creates and configures `repo.git` (Fixed choices); adds `.pecore/` to `info/exclude`; clones and fetches with the project account and the forge's credential helper; deletes `factory/*` branches with `--git-dir` |
| `src/workdir/worktrees.ts` | as the project user, with `--git-dir`: creates, recreates (job re-entering `running`) and removes job worktrees |
| `src/workdir/content-state.ts` | as the project user: tree hash with a temporary index, excluding ignored files and `.pecore/`; deletes `scratchPaths` matches; restores a previous state; records branch SHA, HEAD and stash list per node run and undoes interrupted git operations (4.4); recomputes before `requires` and commit |
| `src/workdir/fs-as.ts` | the only way the engine reads, writes or deletes files under `work/` or in another user's home (harness config directories, 5.9): runs `test`, `cat` and `find -P` as the project user through `runners/process.ts`, refusing symlinks (section 8) |
| `src/workdir/git-as.ts` | the only entry point for git: work-tree commands go through `sudo -n -u <project user>`; app-user commands get `--git-dir` and no work tree; both get `core.hooksPath=/dev/null` |
| **runners/** | |
| `src/runners/process.ts` | spawns a process as a given OS user and records its pgid (Fixed choices: Process groups); applies the timeout of command nodes; to stop, sends `TERM` to the group through `sudo -n -u <user> kill`, then `KILL` after 5 s; gives `runners/agent.ts`, `accounts/` and `chat/` a `Spawn` (5.1) bound to one OS user |
| `src/runners/placeholders.ts` | substitutes placeholders into argument arrays; builds `PECORE_*` environment variables for `script` nodes and probes |
| `src/runners/command.ts` | gives JSON inputs on stdin to commands and probes, applies the outcome and output rules, and returns the text log |
| `src/runners/probe.ts` | runs the probe and applies `probeRules`: `done`, `not_done`, `unknown`; on `unknown` the node run waits with reason `network` and retries (4.8) |
| `src/runners/agent.ts` | runs agents through `@pecore/agents`, includes inputs, knowledge and the result schema in the prompt, and validates the final message. Handles session resume, timeouts and attempt metrics |
| `src/runners/human.ts` | puts a human node in `human_queue` (kind `human-node`) and waits for the user's outcome |
| `src/runners/forge-env.ts` | environment and git credential helper for an account (Fixed choices: `GH_TOKEN`, `GITLAB_TOKEN`, `AWS_PROFILE`) |
| **accounts/** | |
| `src/accounts/logins.ts` | the harness logins (account, OS user, config directory) of 3.4, derived from the accounts and the current mode (app user, or `pecore-agent` in protected mode); their state |
| `src/accounts/identity.ts` | runs `checkLogin` for a login and compares the email with the account's `email` (3.4); a mismatch blocks that login with reason `auth` |
| `src/accounts/login.ts` | harness logins (5.9): `prepareLogin`, config directory and files through `fs-as.ts`, `before` and the command through `Spawn`, the URL and the code; forge and service tool logins (`gh auth login --web`, `glab auth login`, `acli` login) as the app user (phase 4). Streams the URL or device code to the GUI, then rechecks |
| **jobs/** | |
| `src/jobs/create.ts` | Job creation above |
| `src/jobs/controls.ts` | global pause and play (global pause also holds queued jobs); per job stop, pause, play, resume, realign, archive, delete (G17); refuses delete of a parent with live children (4.6) |
| `src/jobs/stacked.ts` | `parentJobId`, `dependsOn`, base and old base, `job.base_changed` for children |
| `src/jobs/merge-watch.ts` | runs `mergedCheck` of every job with a delivery not yet merged every `mergeCheckSec`; on merge, notifies the children (4.6) |
| `src/jobs/delete.ts` | removes the local branch, worktree, artifacts, logs, services and rows of a job; project delete calls it for every job, then removes the project directory and definitions; never acts on the forge (4.8) |
| `src/jobs/effects.ts` | writes the events `effect.requested`, `effect.completed`, `effect.failed` around Repository actions (4.8) |
| **osuser/** | |
| `src/osuser/script.ts` | builds the privileged script that creates or removes `pecore-agent` (user, group, sudo rule); the same text is shown in the guided procedure |
| `src/osuser/protected-mode.ts` | turns protected mode on and off (Fixed choices): admin prompt, group and ACLs on every project, logins of `pecore-agent` |
| `src/osuser/acl.ts` | traverse-only ACLs on the path to `work/` (`setfacl` on Linux, `chmod +a` on macOS) |
| `src/osuser/home-check.ts` | checks that the app user's home and tool login files are not readable by others; returns the fix commands |
| **services/** | |
| `src/services/compose-file.ts` | reads the compose file from the base commit with `git show`, rejects forbidden keys (4.9), provides a validated copy that runs are given on stdin |
| `src/services/runtime.ts` | lifecycle of 4.9 with the runtime command map (Fixed choices): starts, stops and cleans up `pecore-<job id>` compose projects; reads ports into `PECORE_SERVICE_*` variables; waits with reason `services` until healthy |
| **api/** | |
| `src/api/server.ts` | Fastify on `127.0.0.1` port 0; writes `run/api.json`; token, `Origin` and `Host` checks |
| `src/api/routes/projects.ts` | project routes of the API table |
| `src/api/routes/jobs.ts` | job routes, global controls and artifact content from SQLite |
| `src/api/routes/queue.ts` | items requiring a user decision (section 8) |
| `src/api/routes/definitions.ts` | definition routes |
| `src/api/routes/settings.ts` | settings, accounts, profiles, tiers, protected mode, logins |
| `src/api/routes/chats.ts` | chat routes; a user message starts an Assistant turn |
| `src/api/ws.ts` | the WebSocket union |
| **chat/** | |
| `src/chat/mcp-server.ts` | MCP over streamable HTTP on `127.0.0.1` with its own token; the tools of section 6 only |
| `src/chat/tools.ts` | tool handlers; the `write_*` handlers validate input before saving; `read_artifact` returns at most 200 KB, the end of a log when it is longer; `answer_question` resolves a question an agent asked through the chat (an `agent-question` item), never a review or confirmation |
| `src/chat/session.ts` | connector sessions, model and effort selection, streamed replies, resumption and compaction for the Assistant and Project Manager (section 6) |
| `src/runners/repository.ts` | Resolves Repository accounts and the Git environment for scripts and merge checks |
| `src/chat/tracker-tools.ts` | Tracker operations and account selection for jobs and chat |
| **share/** | |
| `src/share/export.ts` | `.tar.zst` project archive. History and its attempt logs are optional. Included artifacts and log messages are scanned for secrets (section 8) |
| `src/share/secrets.ts` | built-in secret scan: one regular expression per common token format, findings as file, line, rule and a fingerprint without the secret |
| `src/share/import.ts` | validates archives and extracted folders, checks the reviewed content digest, maps accounts and restores optional history |
| `src/share/review.ts`, `src/share/review-model.ts` | static checks and isolated model review of shared content, with findings and coverage |
| **observability/** | |
| `src/observability/logs.ts` | writes and reads attempt log rows in `pecore.db` |
| `src/observability/why.ts` | blocking reasons of a job, used by GUI and `pecore job why` |

### `packages/app`: Electron and React

The screens below come from G16. Their layout is designed in [ui-design.md](ui-design.md), which must be approved before phase 5.

| File | What and why |
|---|---|
| `electron-builder.yml` | AppImage, deb, dmg, zip; auto-update from GitHub Releases; rebuilds `better-sqlite3` for Electron; bundles `templates/`, `connectors/` and the adapters (Fixed choices: Adapters) as extra resources. Built so far (phase 6): the Linux AppImage only; deb needs a project homepage, macOS and auto-update come with the release workflow. The engine copies the adapters into `PECORE_HOME/adapters` with directories 0755 and files 0644 or 0755, whatever the modes inside the app |
| `electron.vite.config.ts` | builds main, preload and renderer |
| `src/main/index.ts` | window, menus, tray and single-instance lock. Uses `~/.pecore` unless a home is configured, starts the engine and handles quit and shutdown. |
| `src/main/engine.ts` | `utilityProcess.fork` of the engine with `PECORE_HOME`; handles `parentPort` messages |
| `src/main/admin.ts` | runs the privileged script text with `pkexec` or `osascript` (Fixed choices) |
| `src/main/notifications.ts` | native notifications for `notify` messages; optional sound |
| `src/main/updater.ts` | auto-update |
| `src/preload/index.ts` | exposes only the API port and token (from the `ready` message) to the renderer |
| `src/renderer/main.tsx` | React root and routes |
| `src/renderer/api/client.ts` | typed HTTP client from `@pecore/schemas` |
| `src/renderer/api/live.ts` | WebSocket subscription |
| `src/renderer/shell/` | navigation with the page's sub-navigation, top bar (command palette, global pause and play), command palette (`cmdk`), disconnected banner ([ui-design.md](ui-design.md) Proposed Design, Cross-cutting behaviour) |
| `src/renderer/theme/` | selects the bundled palette and resolves mode from settings (UI4, UI16) |
| `src/renderer/shell/SetupBanner.tsx` | the banner shown when no harness is installed and logged in (ui-design.md "Zero-config start") |
| `src/renderer/screens/Factory.tsx` | home: counters, unfinished jobs, "Play interrupted jobs" |
| `src/renderer/screens/Jobs.tsx` | every job, filters, stacked jobs as a tree, controls by state |
| `src/renderer/screens/JobView.tsx` | header and controls, Graph and History tabs, node run detail, log, artifact viewer, result view |
| `src/renderer/screens/Notifications.tsx` | open `human_queue` items by kind (ID1-ID9) and the notification log; snapshot and hash, lock on cancel |
| `src/renderer/screens/Project Manager.tsx` | single Assistant chat with streaming, action cards, agent questions, Compact and Clear |
| `src/renderer/components/MiniChat.tsx` | the mini chat with the context chip (UI2b, UI14) |
| `src/renderer/screens/Projects.tsx` | project list, New project and Import project entry points |
| `src/renderer/screens/ProjectPage.tsx` | project configuration sections, export, delete |
| `src/renderer/screens/NewProjectWizard.tsx` | collects inputs, shows creation progress and opens the project |
| `src/renderer/screens/RecipeEditor.tsx` | recipe graph editor on a grid, `layout` saving, instance and template modes |
| `src/renderer/screens/NodeEditor.tsx` | node template and instance editor, JSON tab, save with `If-Match` |
| `src/renderer/screens/Templates.tsx` | shared node and recipe templates |
| `src/renderer/screens/Settings.tsx` | accounts and logins, protected mode, Assistant and Project Manager, projects, global limits, runtime, updates and appearance |
| `src/renderer/components/NewJobModal.tsx` | New job form |
| `src/renderer/components/NodeCard.tsx` | the one node card used in Templates, the recipe palette and graph, and the job graph; node kind labels and badge |
| `src/renderer/components/ConfirmItem.tsx` | one confirmation, from the item's `subject` snapshot, sending its hash; used by Notifications (UI18) |

### `packages/cli`

| File | What and why |
|---|---|
| `src/index.ts` | `pecore` command; reads `run/api.json` and calls the local API; when the API is unreachable, exits with code 1 and prints `<PE/CORE> is not running: open the app` |
| `src/commands/project.ts` | `project list`, `export`, `import` (creation is GUI only, because it needs the admin prompt and harness logins) |
| `src/commands/job.ts` | `job list`, `why`, `stop`, `pause`, `play`, `resume`, `realign`, `archive`, `delete` |
| `src/commands/validate.ts` | validates definition files |

### Shipped templates and connectors

Stored in the repository under `packages/app/resources/` and bundled with the app. Templates seed catalog rows in `chats.db`. Forge defaults and connector files are read from the bundled resources. They are data, so adding one needs no engine change (G2, G3). `{project.repo.owner}` and `{project.repo.name}` are the last two path segments of the repo URL (for GitLab subgroups, owner is everything before the last segment).

| File | What and why |
|---|---|
| `templates/nodes/spec-writer.json` + `.md` | writes the feature and BDD scenarios |
| `templates/nodes/tests-writer.json` + `.md` | writes tests and stubs that throw "not implemented" |
| `templates/nodes/builder.json` + `.md` | fills the stubs; never edits tests |
| `templates/nodes/code-reviewer.json` + `.md` | writes `code_review` |
| `templates/nodes/approver.json` + `.md` | writes `code_analysis` with one item per hunk, level `safe` or `risky` |
| `templates/nodes/human-review.json` | outcomes `approved`, `changes_requested`, `rejected` |
| `templates/nodes/git-commit.json` | commit; `success` also when there is nothing to commit |
| `templates/nodes/git-rebase.json` + `.sh` | `git stash push --include-untracked`, `git rebase --onto {job.base} {job.oldBase}`, `git stash pop` |
| `templates/nodes/git-push.json` | push of Fixed choices; probe script: `h=$(git --git-dir="$PECORE_PROJECT_REPODIR" ls-remote origin "refs/heads/$PECORE_JOB_BRANCH" \| cut -f1); [ "$h" = "$PECORE_JOB_COMMIT" ] && echo "$h"; exit 0` |
| `templates/nodes/github-pr.json` | 3.1 example; `mergedCheck`: `gh pr view <url> --json state --jq 'select(.state=="MERGED") \| .state'` |
| `templates/nodes/github-create-repo.json` | Repo creation with `gh repo create {project.repo.owner}/{project.repo.name} --private`, then push of `baseBranch`; probe `gh repo view` |
| `templates/nodes/gitlab-mr.json` + `.sh` | probe `glab mr list --source-branch <b> --target-branch <t> -R <repo> --output json`; create `glab mr create --source-branch --target-branch --title --description -R --yes`; retarget `glab mr update <id> --target-branch <t> -R`; `mergedCheck` `glab mr view <id> -R --output json` with a JSON rule on `state == "merged"`. Flags verified against the pinned glab version in phase 4 |
| `templates/nodes/gitlab-create-repo.json` | `glab repo create`, with an internal repeat check |
| `templates/nodes/typecheck.json`, `eslint.json`, `vitest.json`, `tests-fail-check.json` | TypeScript project checks in the job's workdir |
| `templates/nodes/cargo-check.json`, `cargo-clippy.json`, `cargo-test.json` | Rust project checks in the job's workdir (G2) |
| `templates/nodes/post-delivery-to-ticket.json` | Agent that links the delivered pull request to the job's ticket |
| `templates/recipes/feature-to-pr.json` | the recipe of 3.2 (shown as "Feature to PR") |
| `templates/recipes/bugfix-to-pr.json` | shown as "Bug Fix to PR": runs the final ticket Agent after PR delivery and checks that the tests fail before the fix |
| `templates/recipes/feature-to-local-commit.json` | shown as "Feature to Local Commit": the nodes of `feature-to-pr` up to `git-commit`, with `successOutcomes` `commit:success` (CUJ 4); its reviewer has no `providerNot`, so it runs with a single provider |
| `connectors/claude-code.json` | Claude Code connector (Connector file above), the reference example; built in phase 3 |
| `connectors/codex.json`, `opencode.json` | Codex and opencode connectors; built in phase 6, for G6 |
| `connectors/pi.json` | pi connector through the `pi-acp` adapter; added after phase 6. `pi auth login` needs a pseudo-terminal, so its login command runs through `script`; pi reports no account identity and lists its models and thinking levels in the ACP session |

### Docs

| File | What and why |
|---|---|
| `docs/design.md` (exists) | this design |
| `docs/ui-design.md` (exists) | UI inventory and layout |
| `docs/orginal_design.md` | original design for historical reference |
| `docs/nodes.md` | how to write a node: fields and placeholders |
| `docs/recipes.md` | how to write a recipe: edges, rounds, `onBaseChanged` |
| `docs/connectors.md` | how to add a bundled connector file for a harness with an ACP mode or adapter, and how to record its fixtures |

### Build order

This section records the original build sequence and its validation gates. The first release includes all six phases (D1).

Phases 1-6 target Linux first. The macOS parts (`osuser/` with `dscl` and `sysadminctl`, `chmod +a` ACLs, the `osascript` admin prompt, Keychain logins, dmg signing and notarization) follow in a macOS pass after phase 6, before the first release. Phase 0 still runs the Keychain spike on macOS, because its result can change how harness logins are stored.

| Phase | Files | Gate |
|---|---|---|
| 0. Spikes | none (results go into connector files, fixtures and Open Questions) | done: ACP sessions with Claude Code (two turns, permission, missing login), one Codex tool call, opencode's missing login ([ACP spike](spikes/acp.md)); macOS Keychain behaviour; the "Claude Code through sudo" check of Tests, with its fixtures ([sudo spike](spikes/sudo.md)) |
| 1. Definitions and storage | `schemas`; engine `home/` (except `prerequisites.ts`), `definitions/`, `store/`; root files; the templates that use no forge or agent | done: every template present validates (each later phase adds its templates, and its gate re-runs the validation); migrations apply; `PECORE_HOME` initialises. `git-rebase` moves to phase 4 with its entry gate (rebase checkpoints), `markdown-folder` with the source templates |
| 2. Engine core | `graph/`, `scheduler/`, `runners/process.ts`, `placeholders.ts`, `command.ts`, `probe.ts`, `human.ts`, `workdir/`, `jobs/create.ts`, `controls.ts`, `delete.ts`, `effects.ts`, `main.ts` (without API), `observability/logs.ts`, `projects/create.ts` for `repo: null` only; test fake forge | done: `rules.test`, `files-hash.test`, `fs-as.test`, `git-as.test` pass; command-only recipes run end to end on a local-only project, with the app user as project user (`test/e2e/local-commands.test.ts`). Job controls and delete live in `graph/executor.ts`; the fake forge moves to phase 4, its first user |
| 3. Agents | `packages/agents` with the Claude Code connector only, `adapters.json`, `build-adapters.mjs`; engine `accounts/` (harness logins only), `runners/agent.ts`, `scheduler/tiers.ts`, `cooldown.ts`, the `checkLogin` step of `main.ts`; test fake agent | done: `connectors.test`, `session.test` and `agent.test` pass; a `local-only` job on a `repo: null` project runs end to end to its commit with Claude Code as the only provider, with the app user as project user, in normal mode, with the user's existing Claude Code login (`test/e2e/claude-local.test.ts` with `PECORE_REAL=1`: 4 minutes with Sonnet, 2026-11-18) |
| 4. Isolation and delivery | `osuser/`, the rest of `projects/`, `home/prerequisites.ts`, `services/`, `runners/forge-env.ts`, `jobs/stacked.ts`, `merge-watch.ts`, delivery and source templates | done: `crash.test`, `stacked.test`, `engine-node.test` pass with the fake forge; `e2e/forges` passes against real GitHub and GitLab sandbox repositories with `gh` and `glab` (`test/e2e/forges.test.ts` with `PECORE_E2E_GITHUB_REPO`/`_USER` and `PECORE_E2E_GITLAB_REPO`/`_USER`: repo creation on an empty repository, one PR or MR per job, one push and one request after a kill during push, 2026-11-19) |
| 5. API, GUI, CLI | `api/`, `observability/why.ts`, `packages/app`, `packages/cli` (requires approved `ui-design.md`) | done: `why.test` passes; every action of G16 works from the GUI, chat and AI assistance excepted (phase 6): verified by the GUI tests until 2026-11-22, when they were removed (decision in `decisions.md`); harness logins for the user and for the protected user, and protected mode on and off, verified by hand on Linux (2026-11-19) |
| 6. Project Manager, sharing and more connectors | `chat/`, `sources/`, `share/`, `api/routes/chats.ts`; Codex and opencode connectors with their readers and fixtures | CUJ 1-7 run by hand; `e2e/providers` and `e2e/languages` pass; in the packaged app in protected mode, a chat resumed after an app restart calls an MCP tool with the new token (Phase 6 decision 4) |

Entry gates: a phase does not start until these open findings of the second full review are resolved in this document ([triage](reviews/design/round2/triage.md), table "Later", with sources). Each one is closed by a design change or by a recorded decision to accept it.

| Phase | Must be resolved before it starts |
|---|---|
| 4 | resolved below (Phase 4 decisions) |
| 5 | resolved below (Phase 5 decisions) |
| 6 | resolved below (Phase 6 decisions) |
| macOS pass | Keychain with an empty password: path, creation and unlock after logout; pass criteria of the macOS gate |

#### Phase 4 decisions

Each line closes one entry gate of phase 4 and overrides the earlier text it contradicts.

1.  **Rebase checkpoint.** `git-rebase.sh` never uses `refs/stash`, which all worktrees of `repo.git` share. With uncommitted changes it makes a checkpoint commit on the job branch (`git add -A`, `git commit --no-verify -m "pecore checkpoint"`), runs `git rebase --onto {job.base} {job.oldBase}`, then `git reset --mixed HEAD~1` to turn the checkpoint back into uncommitted changes. A conflict runs `git rebase --abort`, `git reset --mixed` to the recorded head, and gives `rebase_conflict`. The engine no longer records or restores `refs/stash`.
2.  **Push probe.** The `git-push` probe prints JSON `{"state": "absent" | "same" | "other", "head": "<sha or empty>"}` and exits non-zero when `ls-remote` fails (`unknown`). `probeRules`: `done` on `same`, `not_done` on `absent` and `other`. The engine passes the probe's stdout to the command as `PECORE_PROBE_STDOUT`; the push script uses its `head` as the expected value of `--force-with-lease`, so a remote branch moved by someone else after the probe makes the push fail instead of overwriting it.
3.  **Repo creation probe.** `done` only when the remote repository exists and has `baseBranch`. The creation script creates the repository if missing, then pushes `baseBranch`; running it on an existing empty repository only pushes.
4.  **Auth versus network.** When a probe gives `unknown` or a Repository script fails with no matching outcome rule, the engine runs the account tool's identity check (`gh auth token --user <login> --hostname <host>`, `glab config get token --host <host>`). A failed check makes the node run wait with reason `auth` (kind `tool`); a passing check means `network`.
5.  **Compose.** Allowed service keys: `image`, `environment`, `ports` (only `127.0.0.1::<port>`), `healthcheck`, `command`, `entrypoint`, `tmpfs`, `depends_on`, and `volumes` with named volumes only; any other key refuses the file. The check runs on the output of `compose config --format json` of the validated copy, so anchors, `extends` and variables are resolved before the check. Before that command runs, the engine parses the file with the `yaml` package (one document, no duplicate keys, merge keys resolved, no parse warnings) and refuses `include`, `services.*.env_file`, `services.*.label_file` and `services.*.extends.file`, because `compose config` would already read the files they name. The engine is the only owner of services: on quit it runs `compose stop` (data kept), not `down -v`, and the main process runs nothing; a final job state runs `down -v`; Play starts stopped services with `compose start`; the start-up sweep removes `pecore-*` projects whose job is final or missing.
6.  **Protected `repo.git`.** `repo.git/` is mode 3775 (setgid and sticky) with group `pecore-agent`: the project user can create `packed-refs` and lock files but cannot rename or delete the app user's `config`, `HEAD`, `hooks/` and `info/`, which stay owned by the app user and not group-writable. An ACL (`u:<app user>:rwX`, also as default ACL) on all of `repo.git` lets the app user read and update what `pecore-agent` writes there, because the running app gets the `pecore-agent` group only after the next login. Protected mode is switched only when no job is `running`; running jobs are paused first. The admin prompt that switches also changes the owner of every `work/<job>/` to the new project user. Turning protected mode off gives every file in `repo.git` back to the app user, including those `pecore-agent` created.
7.  **Technical approvals.** The engine saves and runs definitions without an approval store (section 8).
8.  **Forge choices as data.** `templates/forges/<forge>.json` names, per forge, the clone credential helper, the delivery, comment, repo creation node templates. `projects/defaults.ts` reads it; the engine has no `if github`. A forge may have no credential helper, repo creation (`null`): `git`, a private Git server, uses the user's own Git credentials, delivers the pushed branch (`git-delivery`), skips the ticket comment (`git-no-comment`), and needs an existing repository.
9.  **Slots while waiting.** A node run holds pool units only while its process runs. Waits for `network`, `auth`, `quota`, `rate_limit` and `human` hold none.
10. **Stacked jobs.** A child's target while the parent is not merged is the parent's branch; after the merge, the parent's own target. A queued child gets its base when the parent ends `succeeded`: the parent's job commit (3.3). Merge detection runs, while the app runs, for every job that has a delivery (3.3) not yet merged, whatever the state of the job and of its children, using the `pull_request` URL or the branch’s saved commit; the API also runs it on demand for one job.
11. **Bugfix proof.** `bugfix-to-pr` runs `tests-fail-check` after the tests node: a `vitest` variant whose outcome is `success` when the tests fail as expected and `failure` when they pass unexpectedly. The failure path goes back to the tests node.
12. **Prerequisites by feature.** First run checks git, and on Linux sudo and setfacl only when protected mode is turned on. `gh`, `glab` and `aws` are checked when an account uses them, Compose when a project has `services` or a services runtime is set.
13. **Project creation across a restart.** The `project_creation` table records the last finished step. At start, an unfinished creation is shown in Notifications with Retry (continue from the next step) and Cancel (undo the finished steps). The `createRepo` node run waits like any node run (`network`, `auth`).
14. **Group before relogin.** The admin prompt that turns protected mode on also runs the group and ACL steps for every existing project as root. A project created later, while the app user's session does not have the group yet (`id -Gn`), gets its group step through an admin prompt too; the GUI suggests logging out and in to avoid it.
15. **Base changes only on a job that does not work.** A base change is a request (4.2): applied at once on a `queued`, `succeeded`, `not_delivered`, `stopped` or `failed` job, otherwise applied when the job reaches one of those states. The user cannot realign a `running`, `waiting` or `paused` job. A job therefore re-enters at `onBaseChanged` only after its `start` node has completed, and the recipe validator counts the outputs of `start` as available at `onBaseChanged`.
16. **Detached processes on job stop.** Every process the engine starts for a job, agent or command, gets `PECORE_JOB_ID=<job id>` in its environment, and its children inherit it. After stopping the group, the engine kills, as the project user, every process of that user whose environment holds that exact variable (`/proc/<pid>/environ` on Linux; macOS in the macOS pass). The user's own shells and editors in the workdir lack it and survive; a process that removes the variable on purpose escapes. The `kill -KILL -1` sweep stays only for app start and quit in protected mode.

#### Phase 5 decisions

Each line closes one entry gate of phase 5 and overrides the earlier text it contradicts.

1.  **Renderer origin.** The packaged app loads the renderer from the custom scheme `app://pecore/` (Electron `protocol.handle`, registered as standard and secure), not from `file://`: a `file://` page sends `Origin: null`, which a sandboxed iframe on any website also sends. The development app loads it from the electron-vite dev server; the main process passes that origin to the engine in `PECORE_DEV_ORIGIN`, only when the app is not packaged. The renderer's Content-Security-Policy allows `connect-src` only to `http://127.0.0.1:<port>` and `ws://127.0.0.1:<port>`, so a script injected through rendered agent output cannot send the token elsewhere.
2.  **Host and Origin.** Every HTTP request and the `/live` upgrade are checked before the token. `Host` must be exactly `127.0.0.1:<port>`, which blocks DNS rebinding (a website whose name resolves to 127.0.0.1 still sends its own name as `Host`). `Origin` must be absent (the CLI and other non-browser clients; a browser always sends it on a cross-origin request and on a WebSocket) or equal to `app://pecore` or `PECORE_DEV_ORIGIN`. Any other value gives 403. The renderer's origin differs from the API's, so its requests with `Authorization` are preflighted: the server answers `OPTIONS` for an allowed origin without the token, with that origin in `Access-Control-Allow-Origin` and the headers `authorization` and `content-type`.
3.  **`/live` authentication.** A browser `WebSocket` cannot send headers. Every client opens `/live` without a token and sends `{"auth": "<token>"}` as its first message. The server sends nothing before it, and closes the socket with code 4401 when the token is wrong or does not arrive within 5 seconds. A token in the query string would end up in logs; header injection by the main process (`webRequest`) would work only for the renderer.
4.  **Typed operations.** `packages/schemas/src/api.ts` holds one table of routes: method, path, and the Zod schemas of params, query, body and response. The server registers its routes from the table and validates every input (400 with the Zod issues); tests also validate the responses. The renderer client and the CLI call routes through one typed function built from the same table, so a changed route breaks the build of both. An error body is `{error, message}`, with `error` one of `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `gone` (410), `conflict` (409), `engine_error` (500). The routes the GUI needed and the API table lacked (wizard progress, Retry and Cancel of a creation, status, auto-setup status, prerequisite recheck, themes, normalised log history, on-demand merge check, play interrupted jobs) are in the API table above.
5.  **Owner of `run/api.json`.** Only the engine writes `run/api.json`: after the API listens, mode 0600, written to a temporary file and renamed. It deletes the file at shutdown. The main process gets port and token from `ready` and never reads the file. A file left by a crash points to a closed port, so the CLI prints `<PE/CORE> is not running: open the app`. When `shutdown.done` does not arrive within 15 seconds, the main process kills the engine process and exits; the next start runs the sweep of section 1 and the services sweep of 4.9.

#### Phase 6 decisions

Each line closes one entry gate of phase 6 and overrides the earlier text it contradicts.

1.  **Orders.** A chat message is an order with a stable ID. The Project Manager submits the full job plan once. The app records the plan and resumes creating missing jobs after a restart. A chat interrupted before the plan is saved can be retried from its message.
2.  **Agent questions.** An agent that needs an answer ends its turn with just `{"question": "..."}` in its final message. The engine adds an `agent-question` item to `human_queue` and the run waits with reason `human`, freeing its execution slot. The Project Manager answers with `answer_question` when project data provides the answer. Otherwise the user answers in Notifications. The engine sends the answer as the next prompt of the same session (5.5), with the remaining attempt time.
3.  **Files in orders.** Chat attachments are any file, at most 10 MB each, stored next to `chats.db` as `<id>-<file name>`. Images (png, jpeg, gif or webp) go to the agent as ACP image content blocks in `session/prompt`; when the profile's connector does not report `promptCapabilities.image` in `initialize`, images are refused and the GUI says why. Any other file is copied as the chat's OS user into `files/` of the chat folder, and the prompt lists each name and path as untrusted, so the agent opens it with its own tools and never reads the app user's files, also in protected mode. Clearing the chat removes both copies. `create_jobs` takes attachment ids per job; the engine stores them as job artifacts and copies them as the project user into `.pecore/attachments/` of the workdir, and the prompt lists their paths.
4.  **Project Manager MCP token.** The MCP server of the Assistant and Project Manager is a stdio server, not HTTP: a small shim shipped in `PECORE_HOME/adapters/`, run with the shipped Node, whose only argument is the path of a token file, `PECORE_HOME/chats/<chat-id>/mcp-token`, mode 0600, written by the engine as the project user (`fs-as.ts`) at every app start and at chat creation. The shim reads the token and forwards MCP messages to the engine's MCP endpoint on `127.0.0.1`. The command line, which `--mcp-config` exposes in `/proc` to every local user, carries no token, and the `mcpServers` entry never changes, so a chat resumed after a restart uses the new token with no other step. In protected mode job agents run as the same `pecore-agent` and can read the file; this is the shared-user limit of section 8, and the Project Manager's external comments still require a user decision.
5.  **Import warning.** The GUI and Assistant show the security review and account mappings before the user proceeds (section 8).
6.  **Import analysis.** The GUI and Assistant review a temporary copy of a local <PE/CORE> export or extracted folder. `pecore project analyze <file>` reviews an archive. Static checks inspect text and validated SQLite history rows. Binary files, files over 32 MB and a job history over 32 MB are listed as unread. A configured Claude Code Assistant can review bounded text in an isolated session with built-in tools, MCP servers, user settings and permission grants disabled. Its response contains only enumerated findings with file and line references. The GUI shows file paths as text. The chat model receives only structured findings and coverage counts. The report is advisory and must never be treated as an instruction or a guarantee of safety.
