# PeCore

*   **Author:** Antonio Colagreco
*   **Status:** Reviewed (EGM stages 5-9); UI specified, reviewed and approved in [ui-design.md](ui-design.md). Agents moved to ACP after the phase 0 spikes (section 5); that change had a targeted review ([report](reviews/design/acp_review_report.md)). A second full EGM run followed the move to normal and protected modes; the findings for phases 0 to 3 are applied ([triage](reviews/design/round2/triage.md)).
*   **Date:** 2026-11-18
*   **Replaces:** `docs/initial-brainstorm.md` (PeCore v0.5)
*   **Inputs:** [concepts-brief.md](concepts-brief.md): review findings B1-B8, M1-M16, N1-N9 and author decisions D1-D27. In this document, "Dn" always means a decision in that file, and "v0.5 Qn" an open question in [initial-brainstorm.md](initial-brainstorm.md).
*   **Changes to the brief's decisions:** see [Changes from the Concepts Brief](#changes-from-the-concepts-brief).

Naming rule: "PeCore" in prose; `pecore` for the command, packages, file names and `PECORE_HOME`.

Terms used throughout:

*   **Harness:** a vendor's own agent program (Claude Code, Codex, opencode, ...), installed and logged in by the user.
*   **ACP:** Agent Client Protocol, an open protocol between a client and a coding agent: JSON-RPC 2.0 over the agent's stdin and stdout. Zed uses it for its external agents. PeCore is an ACP client.
*   **Connector:** the program PeCore starts to talk ACP with a harness: the harness itself in ACP mode (for example `opencode acp`), or an ACP adapter that drives the harness (for example `claude-agent-acp` for Claude Code). A connector file (section 5) describes how to start it.
*   **Forge:** a git hosting service (GitHub, GitLab, Bitbucket, AWS CodeCommit, a private git server).
*   **App user:** the OS user that runs PeCore. `runsAs: engine` means "runs as the app user".
*   **Project user:** the OS user agents and checks run as. In normal mode (the default) it is the app user, as when the user runs Claude Code or Codex by hand. In protected mode it is `pecore-agent`, one OS user created by PeCore for all projects and the orchestrator, which cannot read the app user's files and logins (section 8).
*   **Workdir:** the job's git worktree, `work/<job-id>/`. "Work tree" appears only in git command contexts.
*   **Base branch** (a branch name, for example `dev`) and **base commit** (the commit a job branch starts from, `{job.base}`).

--------------------------------------------------------------------------------

## Overview

PeCore is an open source software factory, released under the MIT license. Work reaches PeCore as an order (in chat or as a ticket reference) or as a new ticket from a ticket source. The orchestrator, an AI agent that talks with the user and calls PeCore's tools, turns the order into one or more jobs. Each job changes the code of a project and delivers the result where the project's recipe says: a pull request on GitHub, a merge request on GitLab, a pull request on Bitbucket, a push to AWS CodeCommit or a private git server, or only a branch in the local repo.

An engine written in TypeScript runs the jobs. It executes recipes. A recipe is a graph of nodes and edges. Every operation on the code or on the outside world is a node: an agent with a role, a check, a human review, a commit, a rebase, a push, a pull request. Models do the work inside agent nodes; code decides transitions, retries, limits and the order of operations.

The engine contains no language-specific or forge-specific code. A toolchain (Rust, Go, TypeScript, ...) is supported by adding nodes that call its commands. A forge is supported by adding nodes that call its commands or API.

Nodes start as templates in a global library. To use one, the user instantiates it: the template is copied into the project and customised. A template and its copies are not linked. The user creates and edits templates and instances by hand, or asks the AI to create, correct or modify them.

Agent nodes run the original harness programs and talk to them through ACP: Claude Code (through the `claude-agent-acp` adapter), Codex (`codex-acp`), opencode (`opencode acp`), and any other harness with an ACP mode or adapter, such as GitHub Copilot CLI, Gemini CLI or pi. Each harness uses its own login and subscription. One job can use models from several providers. Claude Code is the first connector built; the others follow (Build order).

PeCore is a desktop app built with Electron and React. The user downloads it and opens it; there is no background service to install. The harnesses, forge CLIs and container runtime it uses are installed separately, and the first run checks them. The engine runs in a Node process started by the app, and every harness and command process is its child. Closing the window leaves the app running in the system tray, so jobs continue. Quitting the app (from the tray or the app menu, after a confirmation that lists the jobs it interrupts) terminates the engine, those processes and the job service containers (4.9). Every action is available in the app: chat with the orchestrator, recipe graph editor, live view of each job and node, template and instance editors, project settings, accounts and harness logins. A CLI uses the same local API while the app is open.

A project is self-contained: one directory holds its definitions, the history of its jobs, its artifacts and logs. A project can be exported and shared on its own.

PeCore runs on Linux and macOS, on one machine at a time. Today its only user is the author; later it will be published for public use.

## Problem Statement

The author wants to hand off software work and get a finished result back: a fix for a bug in a web app, a feature, or a new product such as a game for Linux and macOS. He does not want to write the code, and he wants several tasks running at the same time, using models from different providers.

According to the comparison in [initial-brainstorm.md](initial-brainstorm.md) Appendix A and the "Alternatives Weighed" section of the concepts brief (not re-verified for this design), each existing tool lacks at least one of the properties listed below:

*   Cockpit tools (Herdr, emdash, Claude Squad, T3 Code) run several agents, but the user drives each one. There is no pipeline, no gate and no recovery after a restart.
*   Issue-to-PR services (Copilot coding agent, Codex cloud, Claude Code GitHub Action) are each tied to one vendor's agent and run on the vendor's infrastructure.
*   zazencodes software-factory v2 has a pipeline, but uses one provider, lets an LLM drive the state, and has no isolation.

What none of them offers together:

1.  Several providers in one pipeline, through their original harnesses and subscriptions.
2.  A pipeline the user builds from nodes, where every step, including commit and delivery, can be customised.
3.  Checks run by code, bound to the exact content they checked.
4.  Parallel jobs across several projects, with waits on quotas and limits instead of failures.
5.  An engine with no built-in language or forge, extended by data, not by code.
6.  Orchestration, state, workdirs and checks on the user's own machine; only model calls, agents' own network use and deliveries leave it.

## Goals

*   **G1. Order to delivered result.** An order (chat text, a link, an image, or a ticket reference) becomes one or more jobs. Each job ends with the outcome of its last node (for example an open PR, a pushed branch, a local commit), with a failure reason from a fixed list (4.3) shown to the user, or because the user stopped it.
*   **G2. No built-in language.** Support for a new language or toolchain needs only new node templates, with no change to engine code. Verified by running the same recipe shape on a TypeScript project and on a Rust project, with different check nodes.
*   **G3. No built-in forge.** Support for a new delivery target needs only new node templates. Verified by delivering the same job to GitHub, to GitLab, and to the local repo only, changing only the delivery nodes.
*   **G4. Every operation is a node.** Agents, checks, human reviews, commit, rebase, push and PR/MR are nodes. A recipe can put a human review before the commit node. The engine handles only workdirs, job branches, and clone and fetch of the project's remote with the project's account: it creates workdirs and branches when a job needs them, removes workdirs when the job ends `succeeded` or `not_delivered` (or, for a failed or stopped job, when it is archived or deleted) and branches when the job is deleted.
*   **G5. Templates and instances.** Node and recipe definitions are JSON files validated by JSON Schema. Both nodes and recipes have templates in a global library and instances in the project. The user can create a template or an instance by hand or by asking the AI in chat; the AI can also correct or modify existing ones. A new or changed file passes schema validation and is usable at once.
*   **G6. Several providers at once.** One job can run agents from at least three different harnesses (for example Claude Code builder, Codex reviewer, opencode with a DeepSeek model for tests). Verified by an end-to-end test of the `feature` recipe with three harnesses.
*   **G7. Parallel jobs with waits, not failures.** The number of parallel jobs and agents is configuration. A job that hits a quota, rate limit, concurrency limit, budget limit, network outage or expired login enters a visible waiting state with a reason from a fixed list (4.3), and resumes when the cause clears. It does not fail for those reasons. Verified per built-in connector with recorded ACP traffic of quota, rate limit and auth errors (section 5).
*   **G8. Self-contained projects.** A project is one directory: project settings, node and recipe instances, knowledge base, its own SQLite database with the history of its jobs, artifacts and logs. `pecore project export` produces an archive another user can import; it contains no repo clone, no workdirs and, by default, no raw logs (section 8). A project points to at most one remote repo and one account for it, and runs its agents as one OS user. If the remote repo does not exist, PeCore creates it at project creation with the project's account, by running the project's repo creation node (section 2).
*   **G9. Stacked jobs.** An order larger than one ticket becomes a set of tickets with dependencies. A child ticket starts from its parent's last commit when the parent job completes, without waiting for the parent's merge. When the parent changes, the recipe's rebase node realigns the child, and the recipe decides which nodes run again. Verified by a test with a chain of three jobs in which the parent gets a new commit and then is merged.
*   **G10. No secrets kept by PeCore.** Each tool keeps its own login: harnesses (`claude`, `codex`, `agy`, ...), forge CLIs (`gh`, `glab`, AWS CLI) and git credential helpers. PeCore stores only references to those accounts. In protected mode, agents cannot read the app user's home, where forge logins live.
*   **G11. Rules live in recipes.** Checks, reviewers, approvals, what runs again after a rebase, providers, tiers and budget limits are recipe or project configuration. The empty recipe is valid: the job opens and closes.
*   **G12. Crash safety.** After a crash, or after the app quits during a delivery, no `runsAs: engine` node repeats an action its probe reports as done, and every job that existed before is present afterwards: `queued` jobs stay `queued`, the others are `paused` or in a final state. Verified by killing the engine during each delivery node in a test.
*   **G13. Diagnosis in under a minute.** For any job, the user can see in the GUI or the CLI which node is running, why the job waits, and open the raw harness log, in under one minute.
*   **G14. Installable by others.** On a fresh Linux or macOS machine, a guided first run in the GUI checks prerequisites, creates `PECORE_HOME`, adds accounts (the harness logins the user already has count as done) and creates the first project, without editing files by hand and without a new login.
*   **G15. Pluggable services runtime.** The container runtime for job services (Postgres, Kafka) is a setting: Podman, Docker, or on macOS Podman machine, Colima or OrbStack. Each needs Compose v2.
*   **G16. GUI first.** Every feature is usable from the React GUI; the only terminal step is the manual fallback for creating the protected user (CUJ 6). The GUI covers chat, recipe graph editor with drag and drop, live job graph with node state and logs one click away, template and instance editors with AI assistance, settings, account and harness logins. Harness logins for the protected user run from the GUI, which shows the harness's login URL or code.
*   **G17. Job controls.**
    *   Global pause and play. Per job: stop, pause, play, resume, realign, archive, delete. Global pause also keeps the scheduler from starting queued jobs.
    *   Stop and closing the app terminate all running processes (`SIGTERM`, then `SIGKILL` after 5 seconds).
    *   Pause waits for the running node to finish, then holds. On app start, interrupted jobs are paused until the user presses play.
    *   Resume restarts a `failed` or `stopped` job from the node that failed or was stopped, in the same workdir.
    *   Delete is allowed on a job in a final state (`succeeded`, `not_delivered`, `failed`, `stopped`) with no live children (4.6). It removes only local resources: the workdir, artifacts, logs, the local branch and the job's history. Nothing on the forge is touched: remote branches and open PRs/MRs stay; the project itself is untouched.
    *   Archive hides a job in a final state and keeps its history, branches and PR/MR.

## Non-Goals

*   **Automatic merge.** A job delivers; a human merges (D2). Auto-merge may be added in a later design.
*   **Windows**, as host or as product target.
*   **iOS, Android and console** targets.
*   **Deploy** to any environment.
*   **Agents in containers.** Agents run on the host as an OS user (D9). Containers are used only for services a job's tests need (Postgres, Kafka).
*   **Network control per node.** Agents have the network access of their OS user.
*   **Link between a template and its instances.** Changing a template never changes an existing instance.
*   **Checking the behaviour of new nodes** beyond schema validation.
*   **Several machines** running the same `PECORE_HOME` at the same time.
*   **Several human users** on one app, or a hosted service.
*   **A message broker.** Events live in SQLite.
*   **Parallel work inside one job.** The rule is in 4.5; several workdirs per job is a possible later evolution.
*   **Storing credentials.** Every login stays in the tool that owns it (D27).

## Open Questions

Each question must be answered before the build phase named in brackets (see Build order).

*   **Second full review, findings for later phases:** listed as entry gates under Build order.

*   **Quota and rate limit errors:** not provoked in any spike. Claude Code reports its quota windows on every turn (`_claude/rateLimit`), and a `rejected` window is handled by 5.4; what else an exhausted window sends, and what Codex and opencode send, is recorded the first time it happens, or by using up a 5-hour window on purpose (author's choice). Until then an unrecorded error message ends as `HARNESS_ERROR` with the node's `retry` (5.4). [Phase 3 for Claude Code, phase 6 for the others]
*   **Connector values for Codex and opencode:** Codex offers mode `agent-full-access` and option `reasoning_effort` in the recorded traffic; still open: the variable that points `codex-acp` at the installed Codex, its account notification without a login, its usage when resuming, the opencode config directory, and permission requests in practice. [Phase 6]
*   **Harness login storage:** answered for Claude Code and Codex on macOS ([spike report](spikes/macos-keychain.md)) and Linux ([Linux spike](spikes/linux-harnesses.md)). Still open: opencode; Antigravity, which keeps its login in the desktop keyring and cannot run as a project user. [Phase 6]
*   **Notification channel** outside the app (v0.5 Q2). [Phase 6]
*   **Log retention** defaults: how long raw harness logs are kept (v0.5 Q11). [Phase 6]

## Critical User Journeys (CUJs)

### CUJ 1: Bug fix from a GitHub issue

*   **Given**: project `progetto-1` points to `github.com/pappa/pippo` with account `account-1`. Its `bugfix` recipe uses instances of check templates for the project's toolchain and the nodes `git-commit`, `git-push`, `github-pr` and `github-issue-comment`. An issue labelled `factory` exists.
*   **When**: the user tells the orchestrator "fix issue 42 of progetto-1".
*   **Then**:
    1.  The orchestrator reads the issue, picks recipe `bugfix`, and starts a job.
    2.  The engine creates a workdir and branch.
    3.  The spec writer writes acceptance criteria; the tests node writes a failing test; the builder fixes the code.
    4.  Checks pass on the workdir content; the code reviewer approves; the user approves in the human review node.
    5.  `git-commit` commits; `git-push` pushes the commit with `account-1`; `github-pr` opens a PR; `github-issue-comment` posts the PR link on the issue.
    6.  The engine removes the workdir.

### CUJ 2: New game from a chat order

*   **Given**: the user created project `progetto-3` for `gitlab.com/ciccio/pimpo` with `account-3`. The remote repo did not exist, so at project creation `gitlab-create-repo` created it with `account-3`. The project's recipes deliver through a `gitlab-mr` node.
*   **When**: the user writes "make a 2D platform game for Linux and macOS".
*   **Then**: the orchestrator asks clarifying questions, then produces tickets with dependencies (scaffold, game loop, player movement, levels, menu, packaging). The scaffold job starts first. Each child job starts from its parent's last commit as soon as the parent job is `succeeded`. Each MR targets its parent's branch. When a parent changes, its children run the recipe's rebase node and then the nodes the recipe lists for that case.

### CUJ 3: New check for Rust, created with AI

*   **Given**: a Rust project with no node for `clippy`.
*   **When**: the user asks the orchestrator "create a check that runs clippy with warnings as errors, and add it to my Rust project".
*   **Then**: the orchestrator writes a `cargo-clippy` template to the global library, instantiates it into the project, and adds it to the project's recipe. The engine validates the new template, the new instance and the changed recipe; the user confirms the recipe change (section 8). The next job uses the new node.

### CUJ 4: Local-only project

*   **Given**: project `prova` has no remote repo. Its recipe ends with a `git-commit` node and no delivery node.
*   **When**: the user gives an order for `prova`.
*   **Then**: the job ends with a commit on branch `factory/<job>` in the project's local repo. PeCore sends nothing to a forge; only the agents' model calls and their own network use leave the machine.

### CUJ 5: Quota runs out during a job

*   **Given**: three jobs run in parallel; two use the same Claude subscription.
*   **When**: the harness reports a quota or rate limit error.
*   **Then**: the affected node runs enter state `waiting` with reason `quota` and the reset time if known. Their slots are released. `pecore job why <id>` shows the reason. When the reset time passes, the nodes start a new attempt. No job fails because of the limit.

### CUJ 6: Turn on protected mode

*   **Given**: PeCore runs in normal mode; the user is logged in to Claude Code and has projects.
*   **When**: the user turns on protected mode in settings.
*   **Then**: the system shows one admin permission prompt. PeCore creates `pecore-agent`, installs a sudo rule that lets the engine run processes only as that user, gives it access to the projects' workdirs, and walks the user through one login per harness account for that user in the GUI. From then on every agent, check and the orchestrator run as `pecore-agent`. If the automatic path fails, a guided procedure shows the exact commands to run.

### CUJ 7: Share one project

*   **Given**: project `progetto-1` with its instances, knowledge base and job history.
*   **When**: the user exports the project from the GUI (or `pecore project export progetto-1`), and another user imports the archive.
*   **Then**: the other user gets the project with its node and recipe instances and knowledge base, and history if it was included. No clone, workdirs or raw logs are in the archive. At import, the other user maps `account-1` to one of their own accounts and confirms every imported node, script and prompt in the confirmation queue before the project can run (section 8).

--------------------------------------------------------------------------------

## Proposed Architecture

### 1. Processes

```text
┌──────────────────────────── PeCore app (Electron) ────────────────────────────┐
│                                                                               │
│  main process          window, menus, native dialogs, notifications,          │
│                        starts and stops the engine process                    │
│                                                                               │
│  renderer (React)      the GUI; talks to the engine over the local API        │
│                                                                               │
│  engine (Node child)   local API (HTTP + WebSocket on 127.0.0.1)              │
│                        graph executor, scheduler, limits                      │
│                        project stores (one SQLite file per project)           │
│                        orchestrator tools (MCP server for the chat agent)     │
│                        ticket sources (definitions run as commands)           │
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

Rule: files describe what exists; SQLite records what happened.

```text
$PECORE_HOME/                         default ~/.pecore; its path is stored in Electron's userData (home.json), so a custom location is found at the next start; git repo for definitions
  settings.json                       limits, services runtime, project paths, UI prefs
  accounts.json                       model, forge and service accounts (references, no secrets)
  profiles.json                       agent profiles: connector + model + effort + account
  tiers.json                          tiers: ordered lists of profiles
  chats.db                            orchestrator conversations (SQLite)
  library/
    nodes/<template>.json             node templates
    nodes/<template>.md               prompt template, for agent node templates
    nodes/<template>.sh               script, for command node templates that use one
    recipes/<template>.json           recipe templates
  projects/<project-id>/              one self-contained project (path can be moved in settings)
    project.json                      repo, account, services, limits
    nodes/<instance>.json             node instances (copied from templates, customised)
    nodes/<instance>.md
    nodes/<instance>.sh
    recipes/<instance>.json           recipe instances
    knowledge/**.md                   knowledge base
    pecore.db                         events and views of this project's jobs (SQLite)
    repo.git/                         bare repo: clone of the remote, or local only
    work/<job-id>/                    workdir of a job (git worktree)
    artifacts/<job-id>/<run-id>/      prompt sent, output, diff, check log
    logs/<attempt-id>.jsonl.zst       raw ACP traffic of the attempt
  connectors/<name>.json              connectors added by the user (5.6); built-in ones are read from the app
  adapters/<package>@<version>/       ACP adapters shipped with the app, copied when the app version changes; readable by every user, no secrets
  schemas/*.json                      JSON Schemas, rewritten by the app at every start
  run/                                local to this machine: api.json (port, token), lock file
  themes/                             UI theme files (JSON tokens); tracked by git
```

*   All definition files are JSON validated by JSON Schema generated from Zod. Each file starts with `"$schema"`, a relative path to the matching file in `$PECORE_HOME/schemas/` (for example `../../../schemas/node.json` in a project node), so editors show field descriptions.
*   `PECORE_HOME` is a git repository. It tracks settings, accounts, profiles, tiers, the library, `connectors/` and each project's `project.json`, `nodes/`, `recipes/` and `knowledge/`. It ignores databases, `repo.git`, `work/`, `artifacts/`, `logs/`, `schemas/`, `adapters/` and `run/`. Every save from the GUI or the orchestrator is one commit whose message names the file and the action (for example `node github-pr: update`). A project moved outside `PECORE_HOME` gets its own git repository for the same files.
*   A project stores everything about itself under its directory. Global files hold only what belongs to the user: accounts, profiles, tiers, templates and chats.
*   `pecore.db` runs in WAL mode. Every engine operation writes its events and updates the views in one transaction on that one file. No transaction spans two files.
*   When a project is created and its remote does not exist yet, `repo.git` starts as an empty local repository with one empty initial commit on `baseBranch`. The engine then runs the project's repo creation node (`createRepo` in `project.json`, for example an instance of `gitlab-create-repo`) once, outside any job. The node creates the remote and pushes `baseBranch` to it; the engine then sets it as `origin`. The node has a probe, so running it again is safe.
*   Clone and fetch are engine operations: the engine runs them as the app user with `--git-dir=repo.git`, with the project's account selected by `forge-env.ts` as for `credentials` (3.1). It clones at project creation, fetches the job's base branch before every job starts, and fetches on merge detection (4.6).
*   `knowledge/` holds Markdown documents about the project: architecture, conventions, domain terms. The user writes them in the GUI, or asks the orchestrator to write them. Agents never write there. An agent node receives the files that match its `knowledge` globs, copied into `.pecore/context/`.

### 3. Definitions

#### 3.1 Node template and instance

A node template and a node instance use the same schema. An instance is a copy of a template saved in a project, with its values customised. The instance keeps no reference to the template.

Fields common to every node:

| Field | Meaning |
|---|---|
| `name` | unique in its library or project |
| `description` | what the node does; the orchestrator reads it to pick and build recipes |
| `kind` | `agent`, `command`, `human` or `source` (section 7; a source node is used by the project, not by recipes) |
| `params` | JSON Schema of the values a recipe can set |
| `inputs` | artifact types the node reads (see 3.3) |
| `optionalInputs` | artifact types the node reads when the job has them (for example the builder reads `findings` after a review asked for changes); the validator does not require them on every path |
| `outputs` | artifact types the node writes |
| `outcomes` | the outcome names the node can produce |
| `failOutcomes` | the outcomes that mean failure (for example `failed`); with no edge, they end the job as `failed` (4.2) |
| `changesFiles` | `true` if the node may modify the workdir; `false` makes it read-only (see 4.4) |
| `scratchPaths` | glob patterns of files the node may create and that are thrown away after it (for example `coverage/**`, `**/*.tmp`); default empty |
| `timeoutSec` | hard time limit for one attempt |
| `retry` | extra attempts after a process failure (not after a `failed` outcome), default 1 |

Fields by kind:

*   **`command`**
    *   `runsAs`: `project-user` (default) or `engine`. `engine` runs the command as the app user, where forge and service logins live.
    *   `command`: an argument array, run without a shell; placeholders are substituted into single arguments.
    *   `cleanCheckout`: `true` to run in a temporary worktree of the current content state with no ignored files (4.4); default `false`.
    *   `script`: instead of `command`, the name of a shell script stored next to the node file (`nodes/<instance>.sh`), run with `/bin/sh`. Use it when the logic needs conditions. Placeholders are not substituted into the script; they are passed as environment variables named after the placeholder in upper case with dots as underscores (`{job.branch}` becomes `PECORE_JOB_BRANCH`), so ticket text is never inserted into the script source; scripts must quote these variables. A node has exactly one of `command` and `script`.
    *   `credentials`: only for `runsAs: engine`; names of accounts the node uses, or `project.account` for the project's own account. The engine selects that account in the tool through environment variables (for example `GH_TOKEN` from `gh auth token --user <login>`, `GITLAB_HOST`, `AWS_PROFILE`).
    *   `outcomeRules`: how the outcome is computed: by exit code, or by a field of JSON printed on stdout.
    *   `outputRules`: how each output artifact is read: `{ "file": "<path>" }`, `{ "stdoutJson": "<field>" }`, or `{ "stdoutLastLine": "<name>" }` (the last line of stdout, saved in the artifact under that name, for example `url`).
    *   `probe`: a command that reports whether the action already happened (see 4.8): an argument array, or `{ "script": "<file>" }` for a script next to the node, run like `script`. Every `runsAs: engine` node acts outside the machine, so the validator requires a probe on it. `mergedCheck` takes the same two forms.
    *   `probeRules`: how the probe result is read. Default: exit code 0 and non-empty stdout means `done`, and stdout is read with `outputRules`; exit code 0 and empty stdout means `not_done`; any other exit code means `unknown`. A rule can instead read a JSON field on stdout, mapping its values to `done` and `not_done`.
    *   `mergedCheck`: for delivery nodes; a command that reports whether the delivery was merged (for example `gh pr view <url> --json state --jq 'select(.state=="MERGED") | .state'`, which prints `MERGED` only when merged). Read like a probe: `done` means merged. The engine runs it periodically on `succeeded` jobs that have children (4.6).
*   **`agent`**
    *   `prompt`: path of the Markdown prompt template.
    *   `agent`: `tier` (for example `strong`) or an ordered list of `profiles`; optional `providerNot`, a list of recipe node ids whose provider this node must not use.
    *   `outputSchema`: JSON Schema of the structured output the agent must write to `.pecore/output.json` (section 5); it contains a field `outcome` whose value must be one of `outcomes`.
    *   `knowledge`: glob patterns of knowledge base files the node receives.
    *   `resume`: `true` to resume the harness session when the node runs again in the same job.
*   **`human`**
    *   `show`: artifact types to display (summary, diff, check logs, `risk`). The approver's `risk` artifact exists for this: the human review shows risky hunks first.
    *   The outcomes are the buttons the user sees (for example `approve`, `changes`, `reject`).
    *   `answer`: whether the user can attach text, which becomes an artifact for the next node.

Placeholders in `command`, `probe` and prompts are plain substitution with no logic: `{params.<name>}`, `{job.id}`, `{job.title}`, `{job.branch}`, `{job.base}` (the base commit the job must be on now), `{job.oldBase}` (the base commit the job branch was last on), `{job.target}` (branch the delivery targets, see 4.6), `{job.commit}` (SHA in the latest `commit` artifact), `{ticket.id}` (the id of the job's ticket at its source, if any), `{workdir}`, `{project.repoDir}`, `{project.repo.url}`, `{project.repo.owner}`, `{project.repo.name}`, `{inputs.<type>.path}`. For nodes that run as the project user, the engine copies their input artifacts into `.pecore/inputs/` in the workdir, and `{inputs.<type>.path}` points there; `runsAs: engine` nodes read the originals under `artifacts/`.

Example instance of a delivery node. It runs after a `git-push` node, which pushes the job branch from `repo.git`:

```json
{
  "$schema": "../../../schemas/node.json",
  "name": "github-pr",
  "description": "Open a pull request on GitHub for the pushed job branch, or move an existing one to the job's target branch",
  "kind": "command",
  "runsAs": "engine",
  "credentials": ["project.account"],
  "inputs": ["commit", "spec"],
  "outputs": ["delivery"],
  "outcomes": ["opened", "failed"],
  "failOutcomes": ["failed"],
  "changesFiles": false,
  "script": "github-pr.sh",
  "outcomeRules": [{ "exitCode": 0, "outcome": "opened" }, { "exitCode": "other", "outcome": "failed" }],
  "outputRules": { "delivery": { "stdoutLastLine": "url" } },
  "probe": ["gh", "pr", "list", "--repo", "{project.repo.owner}/{project.repo.name}", "--head", "{job.branch}", "--base", "{job.target}", "--json", "url", "--jq", ".[0].url // empty"],
  "timeoutSec": 120
}
```

`nodes/github-pr.sh`, next to the node file:

```sh
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
url=$(gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --json url --jq '.[0].url // empty')
if [ -n "$url" ]; then
  gh pr edit "$url" --base "$PECORE_JOB_TARGET" >/dev/null && echo "$url"
else
  gh pr create --repo "$repo" --base "$PECORE_JOB_TARGET" --head "$PECORE_JOB_BRANCH" \
    --title "$PECORE_JOB_TITLE" --body-file "$PECORE_INPUTS_SPEC_PATH"
fi
```

#### 3.2 Recipe template and instance

A recipe is a graph. Recipe templates live in the library; a project uses recipe instances, which reference only node instances of the same project.

```json
{
  "$schema": "../../../schemas/recipe.json",
  "name": "feature",
  "description": "New feature on existing code: spec, tests, code, checks, review, commit, PR",
  "start": "spec",
  "onBaseChanged": "rebase",
  "maxNodeRuns": 60,
  "successOutcomes": ["pr:opened"],
  "nodes": {
    "spec":    { "use": "spec-writer" },
    "tests":   { "use": "tests-writer" },
    "tests-check": { "use": "typecheck" },
    "code":    { "use": "builder" },
    "lint":    { "use": "eslint" },
    "types":   { "use": "typecheck" },
    "test":    { "use": "vitest", "params": { "suite": "unit" } },
    "review":  { "use": "code-reviewer", "agent": { "providerNot": ["code"] } },
    "approve": { "use": "approver" },
    "human":   { "use": "human-review" },
    "commit":  { "use": "git-commit", "requires": ["lint", "types", "test", "human"] },
    "rebase":  { "use": "git-rebase" },
    "push":    { "use": "git-push" },
    "pr":      { "use": "github-pr" }
  },
  "edges": [
    { "from": "spec",    "on": "accepted",  "to": "tests" },
    { "from": "tests",   "on": "done",      "to": "tests-check" },
    { "from": "tests-check", "on": "failed", "to": "tests", "maxRounds": 3 },
    { "from": "tests-check", "on": "passed", "to": "code" },
    { "from": "code",    "on": "done",      "to": "lint" },
    { "from": "code",    "on": "tests_disputed", "to": "tests", "maxRounds": 2 },
    { "from": "lint",    "on": "passed",    "to": "types" },
    { "from": "types",   "on": "passed",    "to": "test" },
    { "from": "lint",    "on": "failed",    "to": "code", "maxRounds": 3 },
    { "from": "types",   "on": "failed",    "to": "code", "maxRounds": 3 },
    { "from": "test",    "on": "failed",    "to": "code", "maxRounds": 3 },
    { "from": "test",    "on": "passed",    "to": "review" },
    { "from": "review",  "on": "changes",   "to": "code", "maxRounds": 3 },
    { "from": "review",  "on": "approve",   "to": "approve" },
    { "from": "approve", "on": "done",      "to": "human" },
    { "from": "human",   "on": "approve",   "to": "commit" },
    { "from": "human",   "on": "changes",   "to": "code" },
    { "from": "commit",  "on": "done",      "to": "push" },
    { "from": "commit",  "on": "stale",     "to": "lint" },
    { "from": "push",    "on": "pushed",    "to": "pr" },
    { "from": "rebase",  "on": "clean",     "to": "lint" },
    { "from": "rebase",  "on": "conflict",  "to": "code" }
  ]
}
```

Recipe fields:

| Field | Meaning |
|---|---|
| `start` | the first node |
| `onBaseChanged` | the node the job re-enters when its base moves (D17, 4.2) |
| `maxNodeRuns` | cap on node runs per job (4.2) |
| `layout` | optional node positions for the graph editor (`{ "<node id>": { "x", "y" } }`, on a grid); ignored by the engine; a recipe without it is laid out automatically when opened |
| `successOutcomes` | the final outcomes, as `<node>:<outcome>`, that mean the work was delivered (for example `pr:opened`, `commit:done`); they end the job as `succeeded` (4.1, 4.2). The validator requires each to be an outcome of that node with no edge and not in its `failOutcomes`, and at least one in every recipe that has nodes |
| `nodes.<id>.use` | a node instance of the same project |
| `nodes.<id>.params`, `nodes.<id>.agent` | overrides of the instance's values. `params` overrides are not allowed on `runsAs: engine` nodes: their arguments are fixed by the confirmed instance (section 8) |
| `nodes.<id>.requires` | nodes whose latest outcome must be `passed` on the current content state (4.4) |
| `nodes.<id>.optional` | runs only if the `spec` names it (4.2) |
| `nodes.<id>.session` | a session group name for agent nodes. Agent nodes of the same job with the same group and the same profile share one harness session: each run resumes the session of the previous run in the group, so the fixed prompt is paid once. A node with no group gets a new session (or its own, with `resume`). A profile change (for example a fallback on quota) starts a new session for the group. Reviewers should have no group, so they judge the code without the builder's history |
| `nodes.<id>.skipWhenUnchanged` | after a base change, if the rebase was clean and the job's own changes are identical to before (same `git patch-id` of the job's diff), the node ends at once with its previous outcome instead of running, and that outcome is bound to the new content state (4.4): an approval of the same patch carries over. Used to avoid repeating reviews and human approvals; checks never use it |
| `edges` | `from`, `on` (outcome), `to`, optional `maxRounds` |

Notes on the example:

*   `git-rebase` stashes uncommitted changes including untracked files, runs `git rebase --onto {job.base} {job.oldBase}` and restores the changes. `--onto` moves only the job's own commits, so after a squash merge of the parent its original commits are not replayed. A conflict at any step gives the outcome `conflict`.
*   After a rebase the job runs again through `commit`, `push` and `pr`. `git-commit` with nothing new to commit ends with `done` on the current commit. `git-push` pushes `{job.commit}` with `--force-with-lease`; its probe compares the remote branch head with `{job.commit}`, so a rebased commit is always pushed. `github-pr` finds the existing PR through its probe and does not open a second one (4.8).
*   The spec lists the interfaces (function names and signatures). The tests node writes the tests and stubs of those interfaces that throw "not implemented". `tests-check` runs the type checker: it passes when tests and stubs are valid, while the tests still fail when run. Failures go back to the tests node. The builder fills the stubs and never edits tests, so it never receives failures in test files it may not change (concepts brief, finding M2).
*   `spec: rejected` means the spec writer found the ticket unclear or not feasible; the job ends and the reason is in the `spec` artifact. `code: tests_disputed` means the builder reports a test as wrong; the job goes back to the tests node with the builder's reason.
*   `human: reject` has no edge and is not in `successOutcomes`, so it ends the job as `not_delivered` with outcome `human:reject`. `pr: failed` is in `failOutcomes` of `github-pr`, so with no edge it ends the job as `failed` (4.2).

#### 3.3 Artifacts

Nodes pass files, not conversations. An artifact has a type, a path under `artifacts/<job-id>/<run-id>/`, a SHA-256 hash and the content state it refers to.

| Type | Written by (default templates) | Content |
|---|---|---|
| `ticket` | engine at job creation | the work item text and attachments, marked as untrusted data |
| `spec` | spec writer | acceptance criteria, what tests must check, interfaces, optional nodes to run |
| `findings` | reviewers | verdict, findings with file, line and severity |
| `risk` | approver | each hunk classified `safe` or `risky`, with reason |
| `check-log` | command nodes | stdout and stderr of the last run |
| `diff` | engine after any node with `changesFiles: true` | diff of the workdir against the job base |
| `user-note` | human nodes | text written by the user |
| `commit` | commit node | commit SHA and the content state it was made from |
| `delivery` | delivery nodes | URL or reference of the PR, MR or pushed branch |

A node receives the latest artifact of each type in its `inputs`. The recipe validator rejects a recipe in which a node needs an input type that is not produced on every path from `start` to that node (the engine's `ticket` artifact counts as produced at start).

#### 3.4 Accounts, profiles and tiers

*   PeCore keeps no secrets of its own. Each tool stores its login where it always does; `accounts.json` holds only references.
*   `accounts.json` lists accounts of three kinds:
    *   `model`: provider, connector, login type (`subscription` or `api-key`, both configured inside the harness), the account's `email` (compared with the logged-in account, below), `maxParallel`.
    *   `forge`: forge type, host, tool (`gh`, `glab`, `aws`, `git`), the tool's account name (for example the `gh` login, the AWS profile), commit author.
    *   `service`: external service (for example Atlassian), the tool or MCP server that holds its login, the account name.
*   There are no exceptions. A service is reached only through a tool that keeps its own login (for example Jira through `acli` or the Atlassian MCP server). A service with no such tool is not supported until one exists.
*   A harness keeps its login in a config directory, chosen through the variable named in the connector file (for example `CLAUDE_CONFIG_DIR`, `CODEX_HOME`).
    *   Normal mode: the first account of each harness uses the harness's own default directory (no variable set, so `~/.claude`, `~/.codex`): the login the user already has, with no login in PeCore. A second account of the same harness gets `~/.pecore-harness/<account-id>/` in the app user's home and needs one login there.
    *   Protected mode: every account gets `~/.pecore-harness/<account-id>/` in the home of `pecore-agent`, and needs one login there, once, for all projects and the orchestrator. Every agent can read all these logins, because they share one OS user (section 8).
    *   A harness whose connector names no such variable supports one account per OS user, and the GUI says so.
*   A login is one model account in one of these directories (5.9). Login state, `auth` waits and rechecks belong to the login; quota cooldowns (4.7) belong to the account.
*   The user logs in inside the harness, through the harness's own login command and the vendor's own flow. PeCore never reads, copies or moves a harness token: Anthropic's terms forbid apps to collect, store or intermediate Claude credentials ([ACP spike](spikes/acp.md), Terms).
*   In protected mode, `pecore-agent` has no desktop session, so it has no usable desktop keyring. On macOS its Keychain locks at every logout of the app user, and Codex in keyring mode then opens password dialogs on the user's desktop ([spike report](spikes/macos-keychain.md)). So, for `pecore-agent` only:
    *   Codex keeps its login in a file: connector `configDirFiles` writes `cli_auth_credentials_store = "file"` into a new config directory.
    *   Claude Code keeps its login in `$CLAUDE_CONFIG_DIR/.credentials.json` on Linux. On macOS `claude auth login` writes only to the Keychain. There, the Claude Code connector file creates a Keychain for `pecore-agent` with an empty password before the first login, and unlocks it as that user before every connector start (`beforeLogin`, `beforeStart`; Fixed choices). A locked Keychain shows no dialog: Claude Code only reports a missing login.
    *   Antigravity keeps its login in the desktop keyring and hangs without a desktop session ([Linux spike](spikes/linux-harnesses.md)). It works in normal mode, but not in protected mode until it can keep its login in a file.
*   In normal mode the harnesses store their logins as they always do, in the app user's session.
*   Each config directory holds its own login: two directories with copies of the same tokens invalidate each other at the first refresh.
*   ACP reports a missing login as JSON-RPC error `-32000` with a message starting with "Authentication required"; a run that ends with it waits with reason `auth`. A run that fails with an error no rule matches first gets a login check; if no account is logged in, it waits with reason `auth` too (5.4).
*   The connector reports the logged-in account (email and plan) when a session starts, before any prompt: Claude Code and Codex send it in an `auth/status_update` (Codex: `_auth/status_update`) notification during `session/new`. Claude Code also reports there that no account is logged in. A connector that does not names an `identityCommand` instead. After each harness login, and in the background after app start, the engine runs `checkLogin` for every login and compares the email, ignoring case, with the account's `email` in `accounts.json`; the plan is only shown. A mismatch shows a warning and blocks that login with waiting reason `auth`.
*   `profiles.json` defines agent profiles: model account (which names the connector), model, effort. The time limit is the node's `timeoutSec`. The GUI lists the models and efforts that the connector offers for the account (`listOptions`, 5.1).
*   `tiers.json` maps the four tier names (`frontier`, `strong`, `standard`, `cheap`) to ordered lists of profiles. The first profile that is available and satisfies the node's constraints is used; later profiles are backups used only when earlier ones are unavailable (quota, rate limit, harness error).
*   Recipes refer to tiers, not profiles, unless the user chooses otherwise. Tier names are the same on every machine, so a shared recipe works after import.

#### 3.5 Projects

`project.json`:

| Field | Meaning |
|---|---|
| `id`, `name` | identity |
| `repo` | `url` of the remote, or `null` for a local-only project; `account` from `accounts.json` |
| `baseBranch` | branch new jobs start from and deliver to, for example `dev` or a feature branch; the orchestrator or the user can set another one per job |
| `createRepo` | node instance that creates the remote repo when it does not exist (section 2); `null` if not needed |
| `defaultRecipe` | recipe instance used when no recipe is specified and the orchestrator finds none that fits the order |
| `services` | path of a compose file for job services, relative to the repo (4.9) |
| `limits` | parallel jobs for this project; budget per job and per day, in tokens for subscription accounts and in money for API key accounts |
| `source` | node instance of kind `source` that brings tickets into the project (section 7), with its `params` (for example the label), or `null` |

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
| `succeeded` | ended on an outcome listed in the recipe's `successOutcomes` (for example `pr:opened`); a base change can move it back to `running` |
| `not_delivered` | ended on an outcome with no edge that is neither a success nor a failure (for example `spec:rejected`, `human:reject`); the outcome is shown as the reason; a base change can move it back to `running` |
| `failed` | a node failed beyond its retries, an unrouted failure outcome ended the job (4.2), or the job hit `maxNodeRuns` and the user chose to end it |
| `stopped` | the user pressed stop |

Pause waits for the running node run to finish, then holds. Play moves a paused job back to `running` or `waiting`. On app start every job that was `running` or `waiting` is `paused` with reason `quit`; `queued` jobs stay `queued`; a pause by the user has reason `user`. A job is archived only from a final state. Archiving removes the workdir, so an archived `failed` or `stopped` job cannot be resumed; a `succeeded` or `not_delivered` job that re-enters `running` on a base change is first unarchived and its worktree recreated from its branch (4.5).

#### 4.2 Graph rules

*   **Start**: the job runs `start` first.
*   **One node at a time**: a job has one workdir and runs one node at a time (4.5).
*   **Edges**: when a node run ends with an outcome, the edge `from` that node `on` that outcome starts its target. The validator rejects two edges with the same `from` and `on`.
*   **No edge**: an outcome with no edge ends the job, with that node and outcome recorded. The job is `failed` if the outcome is in the node's `failOutcomes` or is the built-in `stale`; `succeeded` if `<node>:<outcome>` is in the recipe's `successOutcomes` (for example `pr:opened`); otherwise `not_delivered` (for example `human:reject`, `spec:rejected`). The empty recipe ends `succeeded`. The job's failure reason is `<node>:<outcome>`.
*   **Rounds**: an edge with `maxRounds: n` can send the job back to its target at most `n` times. A job-wide `maxNodeRuns` caps the total number of node runs. When a cap blocks an edge, the job enters `waiting` with reason `round_limit` and asks the user: allow more rounds, or end the job as `failed`.
*   **Optional nodes**: a recipe node with `optional: true` runs only if the `spec` artifact names it; otherwise it ends at once with the built-in outcome `skipped`, which the recipe must route.
*   **Base change**: a job's base and target change only through a request, recorded as `job.base_change_requested`, in exactly three cases: its parent job's branch gets a new commit (from a node of the parent job); its parent's delivery is detected as merged (4.6); the user or the orchestrator asks to realign it to a branch. A job inherits its base branch from the project when it is created (or from the branch chosen at creation), and its base never moves while it works. A request is applied at once when the job is `queued`, `succeeded`, `not_delivered`, `stopped` or `failed`; otherwise it waits and is applied when the job reaches one of those states. Requests that wait are merged into one, the latest. A realign asked by the user is refused while the job is `running`, `waiting` or `paused`. Applying a request records `job.base_changed`; a job that has started then re-enters `running` at `onBaseChanged` (its worktree recreated if needed), where the rebase node moves its commits and the delivery node moves its PR or MR. If the recipe has no `onBaseChanged`, the job only shows that its base moved. Commits pushed to a branch by hand on the forge, or new commits on `baseBranch`, are not detected; the user realigns by hand.

#### 4.3 Node run states

```text
pending ──▶ waiting(reason) ──▶ running ──▶ completed(outcome)
                  ▲                │
                  └────────────────┤        quota or rate limit: the attempt ends,
                                   │        the node run waits for a new attempt
                                   ├──▶ failed(reason)     process error after retries
                                   ├──▶ interrupted        stop, app quit
                                   └──▶ skipped            optional node not chosen
```

Node run waiting reasons: `concurrency`, `quota`, `rate_limit`, `budget`, `human`, `services`, `round_limit`, `network` (a probe or forge command could not reach the forge), `auth` (a harness or tool login expired or does not match the account; the user is notified and the run continues after a new login), `confirmation` (a `runsAs: engine` node, a recipe change or a new compose file version waits for the user's confirmation, sections 4.9 and 8), `disk` (free disk below the threshold, Risks & Limits). A `queued` job stores its own waiting reason on the job: `parent_job`, `parent_failed` (4.6), `concurrency`, `disk` (before its workdir is created), or `network` and `auth` (the fetch of its base branch at start failed; retried with the backoff of 4.7). An `auth` wait also records the account id, the OS user of the login (3.4), and whether the login belongs to a harness or to a forge or service tool. Failure reasons: `HARNESS_ERROR`, `TIMEOUT`, `INVALID_OUTPUT`, `READ_ONLY_VIOLATION`, `PROCESS_KILLED`, `COMMAND_NOT_FOUND`.

A job waiting for a human, a quota, a login or a confirmation releases its pool units (4.7) and takes them again before its next node run, so waiting jobs never block running ones.

#### 4.4 Content state and evidence

*   After every node run with `changesFiles: true`, the engine computes the workdir's **content state**: the git tree hash of all tracked and untracked files, built with a temporary index so the worktree's index is never touched. Files ignored by git and the `.pecore/` folder are not part of it.
*   Every node run records the content state before and after it. Every check result is bound to the content state it saw; a check whose before and after states differ binds to neither and counts as not `passed`. A human review is bound the same way to the content state of the diff it showed, and its `approve` counts as `passed` for `requires`.
*   The engine also recomputes the content state right before it evaluates `requires` and right before a commit node, because another job of the same project runs as the same OS user and could have changed the workdir in between.
*   `requires` on a recipe node is checked against the current content state. If one of the listed nodes has not `passed` on that exact state, the node does not run and produces the built-in outcome `stale`, which the recipe can route (for example back to the checks).
*   A commit node must produce a commit whose tree equals the content state checked by `requires`; otherwise it fails with `READ_ONLY_VIOLATION`. The `commit` artifact records the SHA, and delivery pushes that exact SHA (`{job.commit}`), never whatever the branch ref points to.
*   Files ignored by git (`node_modules/`, build caches, `.env`) are outside the content state, so a check can pass on ignored files the agent changed. A command node with `cleanCheckout: true` runs instead in a temporary worktree created from the current content state, with no ignored files, and removed afterwards. Final checks before commit should use it; it costs a fresh dependency install per run.
*   After every node run, the engine deletes new files that match the node's `scratchPaths`, before computing the content state.
*   A node with `changesFiles: false` must leave the content state unchanged. If it changed, the engine restores the previous state and fails the run with `READ_ONLY_VIOLATION`. Test output such as coverage reports therefore needs to be in `.gitignore` or in `scratchPaths`.
*   Before each node run the engine records the branch SHA, HEAD and `refs/stash`. When a node run is interrupted, the engine aborts any git operation in progress, resets the branch, HEAD and `refs/stash` to the recorded values, then restores the content state from before the run. A new attempt starts clean.

#### 4.5 Workdirs and branches

*   At job start the engine creates branch `factory/<job-id>` from the job's base commit (the head of its base branch, by default the project's `baseBranch`, or the parent job's last commit for stacked jobs) and a worktree under `work/<job-id>/`. The worktree is owned by the project user.
*   `repo.git` is shared with the project user through a group (`core.sharedRepository=group`), because commits made in a worktree write objects into it. Every git command that runs with a work tree under `work/` runs as the project user, reads included: computing and restoring the content state, creating and removing worktrees, rebase, commit. The app user never runs git with a work tree under `work/` and never uses `safe.directory` for it (section 8).
*   One job has exactly one workdir and runs one node at a time. Work that should run in parallel is split into separate jobs (sibling or stacked, 4.6). Several workdirs per job is a possible later evolution, not part of this design.
*   Node-run ids: `<job-id>/<node>#<round>`.
*   When a job ends `succeeded` or `not_delivered`, the engine removes its worktree. If the job later re-enters `running` (base change, 4.2), the engine first recreates its worktree from `factory/<job-id>`. When a job fails or is stopped, its worktree stays, so the user can see what the agents left; it is removed when the job is archived or deleted. Branches stay until the job is deleted.

#### 4.6 Stacked jobs

*   A job can have a `parentJobId`. It stays `queued` with waiting reason `parent_job` until the parent job ends as `succeeded`.
*   Its base is the last commit on the parent's branch. The recipe validator rejects a parent recipe that has no commit node.
*   When the parent's branch changes later, the engine requests a base change for every child that has started (4.2).
*   `{job.target}` is the parent job's branch while the parent is not merged, so the child's PR or MR shows only the child's changes. For a job with no parent it is the job's base branch.
*   Merge detection: for every job with a delivery not yet merged, the engine runs the `mergedCheck` of its delivery node at the interval set in settings (default 5 minutes). When it reports `done`, the engine records `job.delivery_merged` on the parent and notifies each child: it requests a base change with the parent's target as the child's new `{job.target}` (4.2). When the request is applied, the engine fetches that branch into `repo.git` (section 2) and sets the child's base to the fetched commit. The child's rebase node runs, and its delivery node moves the existing PR or MR to the new target (`gh pr edit --base` in `github-pr`). A delivery node with no `mergedCheck` gives no notification; the user realigns by hand.
*   The orchestrator creates a set of stacked jobs from one order through the tool `create_jobs`, which takes tickets with `dependsOn`.
*   Parent ends `not_delivered`, `failed` or `stopped`: its queued children move to waiting reason `parent_failed` and the user is notified. They start when the parent later ends `succeeded` (after a resume or a base change), or the user stops them.
*   Parent re-enters `running` after a base change and then does not succeed: its children keep their current base and show `parent_failed` until the parent succeeds again.
*   A parent with children that are not in a final state cannot be deleted; the GUI lists the children. Archiving a parent is allowed: merge detection continues while it has live children.

#### 4.7 Scheduler and limits

*   Limits are counters held in memory, organised in pools: `jobs` (global), `jobs:<project>`, `agents` (global), `provider:<name>`, `account:<id>` (from `maxParallel`). A node run takes one unit from every pool that applies, all at once, or waits with reason `concurrency`.
*   After an app restart the counters start at zero, after the leftover-process sweep of section 1.
*   When a connector reports a quota or rate limit error (section 5), the engine marks the account as cooling down until the reset time the connector reported, or for a backoff of 1, 2, 4, then 8 minutes if no time is known. All node runs on that account wait with reason `quota` or `rate_limit`. A node whose tier has another available profile switches to it as a new attempt.
*   Budget: each attempt records tokens and cost; budget tokens are input, output and cache writes (5.3). For API key accounts cost comes from the cost the connector reports, or else from the token counts and a price table in settings; for subscriptions only tokens are recorded. When a project or job budget limit is reached, node runs wait with reason `budget` and the user is asked to raise the limit or stop the job. The limit is checked when an attempt starts, against the usage of attempts already ended; attempts already running finish, so the overshoot is at most what they use. Orchestrator turns count toward the project's budget when they act for one project (an intake turn, or a chat message about one project).

#### 4.8 External effects and crash safety

*   Every `runsAs: engine` node acts outside the machine (push, PR/MR, ticket comment, repo creation) and has a probe (3.1). It is recorded in two steps: `effect.requested` before the command runs, `effect.completed` or `effect.failed` after.
*   Before running a node that has a `probe`, the engine always runs the probe first and reads it with `probeRules`. `done`: the node completes with the probe output and its command does not run. `not_done`: the command runs. `unknown` (for example the forge is unreachable): the node run waits with reason `network` and the probe is retried with the backoff of 4.7 (1, 2, 4, then every 8 minutes) until it gives `done` or `not_done`, or the user stops the job. The command never runs blind. This covers both a crash between `effect.requested` and its outcome, and a node that runs again after a rebase.
*   Delete is local only: it removes the job's local branch, worktree, artifacts, logs, services and rows in `pecore.db`. It never acts on the forge; remote branches and PRs/MRs the job created stay, and the user closes them on the forge if needed.
*   Project delete is local only too: it stops and deletes every job of the project as above, removes the project directory (`repo.git`, `work/`, `artifacts/`, `logs/`, `pecore.db`), its definitions in `PECORE_HOME` (one commit) and its `pecore-*` compose projects. The remote repository is never touched. Refused while a job of the project is `running`; the GUI asks to stop them first. Project delete never removes an OS user; `pecore-agent` is removed only when the user turns protected mode off.

#### 4.9 Job services

*   If `project.json` has `services`, the engine starts them when the job starts. Pause stops the containers and keeps their data (`compose stop`); play starts them again (`compose start`). A final state removes them with their data (`compose down -v`); a job that re-enters `running` starts them from scratch. Until they are healthy, node runs wait with reason `services`.
*   The container runtime runs as the app user, but the compose file lives in the repo, where agents can edit it. So the engine never reads it from the workdir. It reads it from the job's base commit (`git --git-dir=repo.git show <base>:<path>`), rejects `build:`, bind mounts of host paths, `privileged`, `cap_add`, `devices`, `network_mode: host` and `pid: host`, and puts each new version in the confirmation queue (section 8). It runs the confirmed copy with `-f <copy> --project-directory <empty temp dir>`.
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
  costUsd?: number;                        // only for a new session (Usage below)
  quota?: { status: string; resetAt?: number; windows?: Record<string, { utilization: number; resetAt: number }> };
  text: string;                            // the agent's text in this turn
};
```

`RawLine` is one item of the raw log format (section 9); the engine writes these lines to the raw log (section 9) unchanged, and redaction happens in `@pecore/agents` before a line is emitted. `AgentEvent` is `text {text}`, `tool_call {toolCallId, title, kind, status}`, `permission {toolCallId, optionId}`, `account {email, plan}`, `quota {...}`, `usage {...}`. Times are epoch milliseconds. `startSession` rejects with `{ kind, raw }` when the connector fails before the prompt; the engine classifies it like a turn error (5.4).

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
*   Budget tokens (4.7) are `input + output + cacheWrite`. `cacheRead` is recorded but not counted, because it is a fraction of the price and dominates long sessions.
*   `model` is the resolved model id when the reader finds it (Claude Code: `_meta["_claude/model"]` in `usage_update`), else the profile's model. Price lookups use it.
*   Cost: Claude Code sends the total cost of the session so far in `usage_update.cost` (`amount`, `currency`). It is reported as `costUsd` only for a new session, where the total is the attempt's cost. For a resumed session, and for any currency other than USD, cost comes from the tokens and the price table (4.7).
*   Quota: the Claude Code reader reads `_meta["_claude/rateLimit"]` in `usage_update`: `status` (`allowed`, `allowed_warning`, `rejected`), `resetsAt` (epoch seconds), `rateLimitType` (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included`, `overage`), and `unifiedWindows` with `utilization` (0 to 1) and `resetsAt` per window. These are the values of the Agent SDK's `SDKRateLimitInfo` type. Only `rejected` is an error. The latest values are kept per account and shown in the Usage screen when the connector reports them.
*   When a turn is refused for quota, the adapter ends it with a JSON-RPC error whose `data` is `{ "errorKind": "rate_limit", "rateLimit": <the same fields> }` (`claude-agent-acp` 0.108.0, `result-end.js`). The reader reads `data.errorKind` and `data.rateLimit.resetsAt`, never the error text. `errorKind` values from the SDK's `SDKAssistantMessageError` type: `rate_limit` is `quota` with its reset time; `billing_error` and `account_on_hold` are `quota` with no reset time; `authentication_failed` and `oauth_org_not_allowed` are `auth`; `overloaded` and `server_error` are `other`.

#### 5.4 End of a turn

The engine decides in this order:

1.  The engine itself cancelled the turn: `TIMEOUT` after a timeout, interrupted after a stop or quit.
2.  JSON-RPC error `-32000` whose message starts with "Authentication required" (seen with Claude Code and opencode): `auth`. Other `-32000` errors go on to step 4.
3.  `stopReason: end_turn` and a valid `.pecore/output.json` (Prompt and output below): the node run completes. A `rejected` quota seen during the turn still starts the account's cooldown for later attempts.
4.  A turn error with `data.errorKind` (5.3), or a `rejected` quota during the turn: the kind and reset time of 5.3.
5.  The connector's `errors` rules, applied to the JSON-RPC error message or to the turn's `text`: their kind, with the reset time if the rule reads one.
6.  `end_turn` with a missing or invalid output: the validation errors are sent as a new message in the same session, at most twice, each answer decided again from step 1; then `INVALID_OUTPUT`.
7.  `max_tokens`, `max_turn_requests`, `refusal`, a connector that exits without answering, or any other error: `checkLogin`; `logged_out` gives `auth`, anything else `HARNESS_ERROR`.

`quota` and `rate_limit` make the node run wait (4.7) and `auth` makes it wait for a new login (3.4); neither uses up the node's `retry`. `HARNESS_ERROR` and `TIMEOUT` use up `retry`; `INVALID_OUTPUT` is not retried, because it was already corrected twice. Every new attempt starts from the content state before the node run (4.4) with a new session.

Each built-in connector ships with recorded ACP traffic of these cases, used by its tests. A quota or rate limit error that cannot be provoked on purpose is recorded the first time it happens; until then a synthetic fixture (a recorded session with `status` changed to `rejected`, file name ending in `.synthetic.jsonl`) tests the reader, and an unrecorded error message reaches step 7.

#### 5.5 Resume and timeout

*   A node with `resume`, or in a `session` group (3.2), resumes the session of the latest attempt of the same job, with the same profile and the same node (for `resume`) or group, that ended with a completed node run. `attempts` stores the session id (event `attempt.session_started`) and the group.
*   If the connector cannot resume it, a new session starts with the same prompt, and the attempt records `resumed: false`. The prompt always contains the node's inputs, so a new session has what it needs; only the conversation history is lost.
*   The node's `timeoutSec` covers the whole attempt, correction messages included. `runners/agent.ts` owns it: `cancel()`, then `stop()` 5 seconds later.

#### 5.6 Connectors

*   A connector file says how to start a connector, which harness program it drives and which versions, the session options, the variables, the login command and the error rules (Detailed Implementation, Connector file). Built-in connector files are read from the app's resources, so an app update updates them. `PECORE_HOME/connectors/<name>.json` holds connectors added by the user; one with a built-in name overrides it, and the GUI shows that.
*   A connector file runs commands as a project user (`command`, `beforeLogin`, `beforeStart`, the version check). So a new or changed file in `PECORE_HOME/connectors/` waits in the confirmation queue like a `runsAs: engine` node, with its hash stored (section 8). The orchestrator has no tool that writes connector files.
*   Kinds: `native`, a harness with its own ACP mode, started directly (for example `opencode acp`); `adapter`, an ACP adapter shipped with PeCore (Fixed choices: Adapters), run with the Node runtime shipped with PeCore and pointed at the user's installed harness (for example `claude-agent-acp` with `CLAUDE_CODE_EXECUTABLE`). The user installs nothing besides the harness. The adapters ship without their bundled copies of the harness (350 to 450 MB): the user's own harness is used, the one the user logged into.
*   Built-in connectors: Claude Code (adapter `@agentclientprotocol/claude-agent-acp`), Codex (adapter `@agentclientprotocol/codex-acp`), opencode (native). A new harness that speaks ACP natively needs only a connector file; one that needs an adapter also needs that adapter installed where the project user can run it.
*   Readers: ACP leaves room for extensions in `_meta` fields, and adapters use them for data PeCore needs. A connector names a reader, code in `@pecore/agents`, that maps its usage, quota and account data (5.3). A reader treats missing or unknown fields as absent.
*   The Claude Code connector sets `ENABLE_CLAUDEAI_MCP_SERVERS=false`, so the MCP connectors of the user's claude.ai account (mail, calendar, drive) never join an agent's session; with it the claude.ai servers disappear from the session ([ACP spike](spikes/acp.md)). In protected mode it also sets `DISABLE_AUTOUPDATER=1`, because `pecore-agent` cannot write the app user's installation. Its `sessionMeta` sets the SDK option `strictMcpConfig`, so the session has only the MCP servers PeCore passes in `mcpServers`: without it the repository's `.mcp.json` servers start with the session, as do the user's own and plugin MCP servers ([sudo spike](spikes/sudo.md)). The adapter loads the harness's user, project and local settings: in normal mode agents work with the user's own Claude Code configuration (instructions, plugins, hooks, but no MCP servers), as when the user runs it by hand; the repository's `CLAUDE.md` is read in both modes.

#### 5.7 Process

*   The engine runs a connector or command as the project user with `sudo -n -H -u <user> -- env -i <variables> <program> ...` (Fixed choices: Process groups), in the given `cwd`. `sudo` resets the environment, so every variable is passed through `env`: those built by `@pecore/agents` plus those the engine adds (5.1). The sudo rule is limited to that user and needs no `SETENV`. In normal mode processes are spawned directly, without `sudo`, with the same variables.
*   Program paths: the harness program is looked up in this order: a path set in `settings.json` (`programPaths`), then `command -v <program>` run by the app user's login shell with the name passed as an argument, then the engine's `PATH`. A desktop-launched app often lacks the shell's `PATH`, hence the login shell. Node is the runtime shipped in `PECORE_HOME/adapters/node/` (Fixed choices: Adapters).
*   In protected mode `pecore-agent` runs the app user's installed harness. Its files are readable by others in the usual installations (for example `~/.local/share/claude`); `pecore-agent` gets traverse-only access on each directory on the path that it cannot otherwise traverse, like `work/` (section 8). `checkPrerequisites` verifies, as the project user, that the harness and Node run and that the harness version is in range.

#### 5.8 Prompt and output

*   The engine sends the prompt as the text of `session/prompt` and saves it to `artifacts/.../prompt.md`. Selected knowledge files are copied into `.pecore/context/`, input artifacts into `.pecore/inputs/`, and the node's `outputSchema` into `.pecore/output.schema.json`. `.pecore/` is listed in `repo.git/info/exclude`, so it is never committed.
*   ACP has no structured output option. The prompt asks the agent to write its result to `.pecore/output.json`, valid against `.pecore/output.schema.json`. The engine deletes `.pecore/output.json` before every turn, correction messages included, so a result left by an earlier attempt or turn is never read. When the turn ends, the engine reads the file as the project user (section 8) and validates it (5.4).

#### 5.9 Logins

*   A login is a model account in one config directory (3.4). In normal mode the first account of each harness is the login the user already has, so PeCore asks for no login; it only runs `checkLogin`. A second account of the same harness, or protected mode, needs one login per account, done once.
*   The GUI starts a login with `prepareLogin`. The engine creates the config directory and writes the returned files as the target user through `workdir/fs-as.ts`, runs `before` and then `command` through `spawn`, and streams the output to the GUI. The GUI shows the first match of `urlPattern`; when `readsCode` is true it shows a field, and the code goes to the command's stdin (`POST /logins/:id/code`). Then the engine runs `checkLogin`.
*   `checkLogin` and `listOptions` run `initialize` and `session/new` with no prompt, so no tokens are spent, in an empty directory `<configDir>/probe/`, then `close()`. The account comes from the last account notification before the `session/new` answer: for Claude Code `auth/status_update` with `state` (`authenticated`, `unauthenticated`) and the entry of `accounts` with `active: true`, which gives `email` and `_meta.claudeCode.plan`. With no notification and no `identityCommand` the state is `unknown`: runs are allowed and the GUI shows the login as not verified. `listOptions` returns the values of the config options with category `model` and `thought_level`, and `null` when not `logged_in`.

### 6. Orchestrator

*   The orchestrator is an agent run through a connector, like any agent node, with a profile chosen in settings. It runs as the project user: the app user in normal mode, `pecore-agent` in protected mode, where it cannot read the app user's files although it reads untrusted tickets and links.
*   It reaches PeCore only through an MCP server provided by the engine, with its own token, generated at app start and passed to the orchestrator's connector in the `mcpServers` field of `session/new`, `session/resume` or `session/load` (HTTP transport, which the Claude Code and Codex adapters support). The token changes at every app start, so it is passed again at every resume. The raw log replaces it with `***`.
*   Each chat has a fixed working directory, `~/.pecore-chats/<chat-id>/` in the project user's home, because harnesses store sessions by directory. Messages of one chat run one at a time: a message sent while the previous one runs waits for it. That token reaches only the tools below. It cannot choose the outcome of a human node, confirm a `runsAs: engine` node, change settings, or stop or delete jobs: those need the user token of the GUI and CLI. Tools: `list_projects`, `list_recipes`, `read_ticket`, `create_jobs` (with `dependsOn` and an optional `baseBranch` per job), `job_status`, `read_artifact` (an artifact or the log of a node run of a job, by job id and node-run id; size-capped), `answer_question`, `list_templates`, `write_template`, `instantiate`, `write_instance`, `write_knowledge`, `validate`, `comment_ticket`, `read_replies`.
*   `write_*` tools validate the file before saving and return the validation errors; a saved file is committed to `PECORE_HOME`.
*   The orchestrator reads untrusted tickets, so its changes to a recipe instance and its writes of a `runsAs: engine` or `source` node do not take effect until the user confirms them in the confirmation queue (section 8). Until then, jobs that need them wait with reason `confirmation`.
*   Artifacts and logs are written by agents and can carry prompt injection, like tickets. `read_artifact` gives the orchestrator nothing beyond its existing tools: what it writes still goes through the confirmation queue.
*   A chat message can carry a context: references only (project id, job id, node-run id, recipe, node or template name), never content. The GUI shows it as a removable chip; the orchestrator reads what it needs through its tools.
*   Chats are stored in `chats.db`. Attachments are stored as files next to it.

### 7. Sources

*   A ticket source is a node of kind `source`, with a template in the library and an instance in the project, named by `source` in `project.json`. The engine contains no code for any tracker.
*   A source node declares four commands, each with `command` or `script`, `outputRules` and `credentials` like a `command` node: `list` (open tickets that match its params, JSON array of ids and titles on stdout), `read` (one ticket as JSON: title, body, attachment URLs), `comment` (post text), `replies` (comments after a given time). Placeholders add `{ticket.id}` and `{comment.path}`.
*   Its `params` are set per project: for example `label` (default `factory`, any label the user wants), repo, `pollSec` (default 300) and `trusted` (list of tracker user names; default the project account's user).
*   `read` returns the ticket's author and, where the tracker exposes it, who applied the label. Trust rule: a new ticket starts automatically only if the author or the user who applied the label is in `trusted`. Any other ticket goes into the confirmation queue (section 8) and is not shown to the orchestrator until confirmed.
*   Source nodes run as the app user (they need forge logins), so they follow the same confirmation rule as `runsAs: engine` nodes (section 8).
*   Intake: every `pollSec` the engine runs `list` and keeps the ids already seen in `pecore.db`. For each new ticket it runs `read`, applies the trust rule, and hands a trusted or confirmed ticket to the orchestrator, which picks the recipe, splits it into stacked jobs if needed, and starts them without asking the user. The user gets a notification. If the ticket is unclear, the orchestrator asks on the ticket (`comment`) and reads the answer later (`replies`) before starting.
*   A ticket the user names in chat (for example "fix issue 42") skips polling: the orchestrator reads it with `read_ticket`.
*   Shipped templates: `github-issues` (through `gh`), `gitlab-issues` (through `glab`), `jira` (through the tool that holds the Jira login, see 3.4), `markdown-folder` (reads `*.md` files from a folder). A new tracker such as Linear or Bitbucket needs only a new template.
*   Agents never hold source credentials. Writing back to a ticket at the end of a job is a recipe node (for example template `github-issue-comment`).

### 8. Security

*   Normal mode (the default) works like running Claude Code or Codex by hand: agents run as the app user, with access to its files and logins and to `pecore.db`. The rest of this section, except the confirmation of `runsAs: engine` and `source` nodes, connector files and orchestrator recipe changes, applies to protected mode. The GUI shows which mode is on and offers protected mode.
*   Protected mode: agents, checks and the orchestrator run as `pecore-agent`, which cannot read the app user's files unless those files are readable by others (see the check below). All projects share this user, so protected mode separates agents from the user, not projects from each other.
*   The project directory is owned by the app user. Only `work/` and `repo.git/` are writable by the project user (shared group); `knowledge/`, databases, artifacts and logs are not readable by it.
*   Inside `repo.git/`, only `objects/`, `refs/`, `logs/`, `worktrees/` and `packed-refs` are group-writable. `config`, `hooks/` and `info/` belong to the app user and are read-only for the group. Otherwise an agent could add a hook or a config key such as `core.fsmonitor` or `core.sshCommand`, and the next git command run as the app user (for example in `git-push`) would execute it. As a second barrier, every git command the engine or a `runsAs: engine` node runs gets `-c core.hooksPath=/dev/null`. `extensions.worktreeConfig` stays off, so per-worktree config files are ignored.
*   The agent controls the worktree's `.git` file and `repo.git/worktrees/<id>/`, so it can point git at a config file it wrote. Therefore the app user never runs git with a work tree under `work/`. Git work in a workdir runs as the project user and returns plain values (a tree hash, a commit SHA). The app user runs git only with `--git-dir=<project>/repo.git` and no work tree (for example `git push` in `git-push`). `runsAs: engine` nodes start in an empty temporary directory, never in a workdir.
*   The same holds for plain files. The engine never opens, creates or deletes a file under `work/` as the app user, because the agent could replace it with a symlink to one of the app user's files (for example a forge login). Every file operation in a workdir (copying `.pecore/` inputs, reading `outputRules.file`, deleting `scratchPaths`, writing the prompt) runs standard POSIX tools as the project user through `runners/process.ts`: `cat` to read or write through stdin and stdout, `find -P ... -type f -delete` to delete. The project user cannot read or write the app user's files, so a symlink gives the agent nothing; refusing symlinks (`test -L`) is a second barrier. The engine writes what it receives into `artifacts/` itself. A test plants symlinks in every such path.
*   The project user gets traverse-only access (execute, no read) on the directories on the path to `work/`, through ACLs (`setfacl` on Linux, `chmod +a` on macOS). It can reach `work/` but cannot list the app user's home.
*   At project creation and at every app start, PeCore checks that the app user's home and the tools' login files are not readable by others, and offers to fix the permissions.
*   In protected mode, harness logins (subscriptions and API keys) live in `pecore-agent`'s home, stored by each harness. All of them belong to the same OS user, so an agent can read every protected login, not only the one of the harness it runs in: a prompt-injected agent in one project can take the logins of every account used in protected mode. Protected mode protects the app user's files and logins, not the protected logins from each other.
*   `PECORE_HOME/adapters/` holds only code shipped with the app. It is readable by every user, so `pecore-agent` can run the adapters and the shipped Node; it gets traverse-only access on the directories on the path to it, like `work/`, and on the directories on the path to the harness program (5.7). Only the app user can write any of them.
*   Connector files added by the user run commands as the project user, so they are confirmed like `runsAs: engine` nodes (5.6). The Claude Code connector keeps the MCP connectors of the user's claude.ai account out of agents' sessions (5.6), because those act with the user's account outside the project user's reach.
*   Forge and service logins live in the app user's home, stored by their tools. Only `command` nodes with `runsAs: engine` run as the app user, and the engine selects only the accounts they declare.
*   Whoever can write a `runsAs: engine` or `source` node can run any command as the app user. So the user must confirm every such node before it runs: when it is created or changed by AI or by hand, when a template is instantiated, and when a project is imported. The GUI shows its command or script, `probe`, `mergedCheck` and `credentials`. Recipes cannot override `params` of these nodes (3.2), so the confirmed instance fixes their arguments. The engine stores the hash of the confirmed definition and script in `pecore.db`; a node whose hash differs waits with reason `confirmation`, so a file edited outside the GUI also needs a new confirmation.
*   Recipe changes written by the orchestrator need the user's confirmation (section 6), so a ticket cannot make it remove a human review, a `requires` list or a check.
*   Confirmation queue: one queue holds everything that waits for the user's confirmation: new or changed `runsAs: engine` and `source` nodes, new or changed connector files in `PECORE_HOME/connectors/`, recipe changes written by the orchestrator, every node, script and prompt of an imported project (project-user nodes can read the project user's harness logins), and tickets from authors who are not trusted (section 7). It is the `human_queue` table with a `kind` column, shown in the same GUI screen as human review nodes.
*   Export: raw logs are excluded by default, because agents may have printed tokens in them. History can be included; artifacts are scanned with gitleaks' default rules before export, and matches are listed for the user to confirm.
*   Ticket text, links, images and repo content are data. Prompts mark them as untrusted input.

### 9. Observability

*   `pecore.db` holds the job views: `jobs`, `node_runs` (with state, waiting reason, content states), `attempts` (profile, harness version, model, tokens, cost, log path), `human_queue` (human nodes and the confirmation queue, by `kind`), `usage_daily`. External effects are events (`effect.requested`, `effect.completed`, `effect.failed`) with no separate view.
*   Raw logs are files under `logs/`, named by attempt id (a ULID). For an agent node, one line per item: `{ "dir": "in" | "out", "msg": <JSON-RPC message>, "at" }` for ACP traffic and `{ "dir": "err", "line", "at" }` for the connector's stderr. For a command node, its output. Each attempt row stores its log path.
*   The GUI shows the job graph with each node's state, round, waiting reason, duration, tokens and cost. One click opens the node's attempts, artifacts and raw log. `pecore job why <id>` prints the same blocking reasons.
*   Notifications: job finished, job needs the user, budget reached, harness or tool login expired, parent job failed, job started from a ticket, orchestrator replied. Each is also stored in the notification log of `chats.db`. Native notifications through Electron, with optional sound and a quiet-hours setting.

### 10. Stack

| Area | Choice |
|---|---|
| App shell | Electron, packaged as AppImage and deb (Linux) and dmg (macOS), with auto-update |
| UI | React, Vite; Base UI components styled with CSS Modules and theme CSS variables; React Flow for graphs; CodeMirror 6 for editors and diffs (see `ui-design.md`) |
| Engine | Node.js (the version bundled with Electron), TypeScript strict |
| Local API | Fastify with WebSocket |
| Schemas | Zod, with JSON Schema generated for every definition file |
| SQLite | `better-sqlite3`, rebuilt for Electron |
| Ids | ULID |
| Agents | ACP client written in `@pecore/agents` (JSON-RPC over stdin and stdout); ACP adapters `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, run with the Node runtime shipped with the app |
| Credentials | none stored by PeCore; tools keep their own logins |
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
*   **The Claude Agent SDK called by the engine.** Rejected. It works with a subscription login, because it drives the installed Claude Code binary ([ACP spike](spikes/acp.md)), but it serves only Claude Code. The Claude Code ACP adapter is built on it and gives the same control (sessions, permission requests, usage) through the protocol PeCore uses for every harness.
*   **One JSON manifest per harness, run in non-interactive mode (`claude -p`, `codex exec`).** Rejected after the phase 0 spikes; it was the previous version of this design. It allows one message per process and no permission requests. Each harness also needed code beyond what a manifest could describe: usage reported per session instead of per turn, ten retries before a missing login is reported, a process that never exits after a login error ([Linux spike](spikes/linux-harnesses.md)). Lost: a harness with no ACP mode and no adapter cannot be added.
*   **Our own adapter per harness, on each vendor's protocol (`claude` stream JSON, `codex app-server`).** Rejected. ACP adapters for Claude Code and Codex already exist, and opencode, Copilot CLI and Gemini CLI speak ACP natively. Lost: control over adapter releases; PeCore pins the versions it ships.
*   **Adapter binaries from the ACP registry (the archives Zed downloads).** Rejected. The Claude Code archive also holds a copy of Claude Code (about 460 MB in all), and a download at first use adds a network step and checksums to manage. The npm packages and a Node runtime, shipped with the app, add about 40 MB per platform and no download. Lost: nothing.
*   **A container per agent, with runner images and a token proxy.** Rejected (D9). Each harness would need its own login flow inside a container, plus runner images, file ownership mapping and a network proxy per container. PeCore runs agents on the host as the project user (the app user, or `pecore-agent` in protected mode). Lost: network limits per node. Containers remain only for job services such as Postgres, with the runtime set in settings (D22).
*   **A proxy that injects tokens or filters traffic (TLS-intercepting, or a CONNECT allowlist such as Squid).** Rejected. Without containers there is nothing to route through it, and each harness keeps its own login (D27).
*   **An LLM gateway such as LiteLLM for budgets and rate limits.** Rejected. It needs API keys, and subscriptions do not provide them. PeCore reads token and cost figures from each harness's output and enforces budgets in the scheduler.

### App and storage

*   **An always-on daemon managed by systemd or LaunchAgent.** Rejected (D23). The author wants an app that is downloaded and opened, with nothing to install as a service. Closing the window keeps the app in the tray with jobs running; only Quit stops them. Lost: jobs do not run after Quit, after logout or while the machine is off.
*   **A web app or PWA.** Rejected (D23). PeCore must start processes, create OS users and write to the disk, and a browser cannot.
*   **No GUI: PeCore as an MCP server used from an existing harness, with recipes rendered as Mermaid.** Rejected. The author wants a full React GUI with a graphical recipe editor (D23).
*   **One global SQLite database, or one database partitioned by project.** Rejected (D18). SQLite has no partitions. A project must be one directory that can be copied or shared, so each project has its own `pecore.db`.
*   **A durable workflow engine (Temporal, Restate, DBOS) or LangGraph.js.** Rejected. They need a separate server or their own workflow SDK, and they do not store state inside the project directory. PeCore needs only a graph executor, a scheduler and one SQLite file per project.
*   **State tables plus a separate audit log, instead of events.** Rejected. Each engine operation writes its event and updates the views in one transaction, so the history and the current state cannot drift apart. Duplicate pushes and PRs are stopped by the probe either way (4.8).
*   **A separate telemetry database with W3C trace spans.** Deferred. Diagnosis (G13) needs only `pecore.db` and the raw logs. Spans are useful only for export to tools such as Grafana or Jaeger, which is not a goal; they can be added later.
*   **An encrypted secrets file (`secrets.enc`).** Rejected (D27). Harnesses and CLIs such as `gh`, `glab` and the AWS CLI keep their own logins. PeCore stores only references.
*   **Encrypted storage for credentials no tool keeps (Electron `safeStorage`).** Rejected. Its only uses were a Jira token and a GitHub App key, and Jira has tools that keep their own login. It would add a decrypt service in the main process and a credentials file.
*   **Parallel work inside a job (subtasks with their own workdirs, joins, a merge node).** Deferred. It needed per-subtask branches, join rules, a merge node and conflict routing, while separate jobs already run in parallel. Lost: parallelism inside one ticket.

### Definitions

*   **JSONC files.** Rejected (D14). Files are written by the GUI and by AI as well as by hand; a program rewriting JSONC loses or misplaces comments, and JSON Schema tooling expects plain JSON. Explanations go in `description` fields. Lost: free-form comments.
*   **Built-in support for languages and forges (a closed list of check types, a `Forge` interface).** Rejected (D3, D13). Every operation is a node written as data: checks, commit, rebase, push, PR or MR, repo creation. A new language or forge needs new nodes, created by hand or with AI, not engine code.
*   **Workdirs and branches as nodes.** Rejected (D15). Content states (4.4), crash recovery and permissions (section 8) assume the engine controls the workdir's whole life; a recipe that skipped or reordered these steps would break them.
*   **Commit and rebase done by the engine.** Rejected (D16, D17). Commit is a node, so a recipe can put a human review before it. Rebase is a node, because conflicts need an agent.
*   **A link from each instance to its template.** Rejected (D19, D21). An instance is a copy. Changing a template never changes the nodes and recipes already copied into projects.

### Existing tools

*   **Issue-to-PR tools (Copilot coding agent, Codex cloud, Claude Code GitHub Action, OpenHands, Vibe Kanban).** Rejected. As reported in the concepts brief (not re-verified), each is tied to one vendor's agent, or is a cockpit where the user steers each agent; OpenHands supports several model providers but not several vendor harnesses with their subscriptions. PeCore runs several harnesses in one job, runs checks as recipe nodes, and delivers to any forge that has delivery nodes, or to a local repo only.

## Risks & Limits

### Risks

| Risk | Category | Impact | Mitigation | Where |
|---|---|---|---|---|
| An agent reaches the app user's forge logins through git config or symlinks in its workdir | security | forge account takeover | the app user never runs git with a work tree under `work/` and never touches files there; file operations run as the project user | 4.5, 8 |
| A recipe or orchestrator change removes a human review or retargets an engine node | security | unreviewed code delivered with the user's account | user confirmation of engine and source nodes and of orchestrator recipe changes; no `params` overrides on engine nodes | 3.2, 6, 8 |
| An agent reads the login of the harness it runs in | security | subscription token theft by a prompt-injected agent | accepted; in protected mode the damage stays within that harness account | 8 |
| Normal mode: agents run as the app user | security | a prompt-injected agent can read the user's files and forge logins, as when the user runs a harness by hand | author decision: normal mode is the default, for zero setup; the GUI shows the mode and offers protected mode in one step | 8 |
| Protected mode: all protected harness logins share `pecore-agent` | security | a prompt-injected agent can read the protected logins of every account | accepted: the app user's files and logins stay out of reach; per-account OS users would multiply logins (D9) | 8 |
| Automatic intake starts jobs from anyone who can set the label | security | untrusted tickets drive agents | trust rule of section 7 | 7 |
| An agent edits the compose file to mount the app user's home or run a privileged container | security | forge login theft, root on rootful Docker | compose file read from the base commit, forbidden keys rejected, each version confirmed | 4.9 |
| One job's agent changes another job's workdir or refs in the same project | integrity | unchecked content delivered | content state recomputed before `requires` and commit; push of the exact checked SHA | 4.4 |
| Checks pass on modified ignored files | integrity | a check result that does not hold for the commit | `cleanCheckout`, set in the shipped test templates (`vitest`, `cargo-test`); opt-in for other nodes | 4.4 |
| An adapter or harness changes its `_meta` fields or error messages | failure mode | quota errors become failures | adapter versions pinned with the app; harness version range checked at start; recorded ACP traffic tests per connector; a reader treats missing fields as absent; an unknown error ends as `HARNESS_ERROR` after a login check (5.4), so the job fails visibly instead of waiting on a wrong reason | 5 |
| The claude.ai account's MCP connectors (mail, calendar, drive) join an agent's session | security | a prompt-injected agent acts on the user's mail or files with the user's account, outside the project user's reach | `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the Claude Code connector (5.6), checked in phase 0 | 5, 8 |
| Anthropic treats automated use of a Claude subscription as a breach of its consumer terms | policy | the user's Claude account is restricted | the unmodified Claude Code binary, logged in by the user through Anthropic's flow; PeCore never handles tokens; API key accounts are supported. Anthropic's legal page allows an end user to sign in to the unmodified binary, says that developers of products, including those built on the Agent SDK, "should use API key authentication", and does not name automation; the consumer terms forbid automated access except where Anthropic permits it ([ACP spike](spikes/acp.md), Terms). Before the public release, ask Anthropic, or make API keys the default for Claude | 3.4, 5 |
| A crash during a git operation | failure mode | inconsistent repo state | recorded branch, HEAD and stash; abort and reset on interruption | 4.4 |
| A crash during a delivery | failure mode | double PR or push | probe before every engine node | 4.8 |
| Parent changes re-run every descendant | cost | tokens, quota and repeated human reviews | base change requests merged while a job works; `skipWhenUnchanged` | 4.2, 3.2 |
| Forge outages or expired logins during long jobs | failure mode | lost work | waits with reasons `network` and `auth` instead of failures; resume control | 4.3, G17 |

### Limits

*   **Disk:** each job holds one workdir (repo size plus installed dependencies, often several GB for Node or Rust projects) until it ends `succeeded` or `not_delivered`, or until a failed or stopped job is archived or deleted. Before a job starts, the engine checks free disk space; below the threshold in settings (default 10 GB) the job waits with reason `disk`.
*   **Parallel jobs:** the default `jobs` limit is the number of CPU cores divided by 2, and `agents` is 4; both are settings. The real limit is usually the providers' quotas.
*   **Polling:** each project with a source runs one `list` command every `pollSec` (default 300 s); merge detection runs one `mergedCheck` per `succeeded` parent with live children every 5 minutes. Both count against forge API rate limits.
*   **Storage growth:** `pecore.db` grows with events; raw logs grow fastest. Retention is an open question.
*   **One machine, one user:** `PECORE_HOME` is used by one app instance (lock file); no multi-user access.

## Changes from the Concepts Brief

| Decision | Brief said | Design says | Reason |
|---|---|---|---|
| D9 | each project picks its OS user: the author's own or a dedicated one | one global mode: normal (agents run as the app user, the default) or protected (all projects and the orchestrator run as `pecore-agent`) | one login per account is already friction; a per-project user would multiply logins |
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
*   **Accounts per tool:** `gh auth token --user <login> --hostname <host>` (gh 2.40 or later). `glab` keeps one token per host, so PeCore supports one GitLab account per host and sets `GITLAB_TOKEN` from `glab config get token --host <host>`.
*   **Compose:** Compose v2 is required and its version is checked at first run. Runtime to command: Docker, Colima and OrbStack use `docker compose`; Podman uses `podman compose` with the docker-compose v2 provider. Apple `container` is not supported (no compose). Project name `pecore-<job id in lower case>`. Orphans are found with `compose ls --all --filter name=pecore- --format json`.
*   **Harness permissions:** agents get full permission inside their harness, with network access (author decision). Each connector file's `sessionConfig` selects the most permissive mode: Claude Code `mode` = `bypassPermissions` (run as `pecore-agent` in the [sudo spike](spikes/sudo.md)), Codex `mode` = `agent-full-access` (offered in the recorded traffic). The engine answers any remaining `session/request_permission` as in 5.2. The security boundary is the project user (section 8).
*   **ACP:** protocol version 1. The client is written in `@pecore/agents` on `node:child_process` and `node:readline`, about 80 lines in the spike (`docs/spikes/acp/client.mjs`); the `@agentclientprotocol/sdk` types are used for message shapes only. Requests used: `initialize`, `session/new`, `session/resume`, `session/load`, `session/set_config_option`, `session/prompt`, `session/cancel`; client methods answered: `session/request_permission`; any other request from the agent is answered with error `-32601`. `initialize` declares no file system and no terminal capability, so the harness reads and writes files and runs commands itself, as the project user.
*   **Libraries:** `@modelcontextprotocol/sdk` for the MCP server; `@fastify/websocket`; `ulid`; Node's `zlib` zstd if Electron's Node supports it (Node 22.15 or later), otherwise `@mongodb-js/zstd`; `tar` for export archives (`.tar.zst`); gitleaks is a prerequisite checked at first run, not bundled; `electron-updater` with GitHub Releases as the feed.
*   **Tests and native modules:** Vitest runs under Electron's Node (`ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs`), so `better-sqlite3` loads with one build. `.npmrc` sets `node-linker=hoisted`, which electron-builder needs with pnpm.
*   **macOS release:** targets `dmg` and `zip` (auto-update needs `zip`), signed with a Developer ID and notarized in `release.yml`; certificates come from GitHub Actions secrets.
*   **Package names:** `@pecore/schemas`, `@pecore/agents`, `@pecore/engine`, `@pecore/app`, `@pecore/cli`.
*   **Adapters:** `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, at versions pinned in `packages/agents/adapters.json`. They are not workspace dependencies: pnpm hoists dependencies to the root, so a copied package would not find its own. `packages/agents/scripts/build-adapters.mjs` creates `out/adapters/<package>@<version>` (npm does not create a nested prefix such as `@agentclientprotocol/...`) and runs `npm install --omit=optional --no-package-lock --prefix out/adapters/<package>@<version> <package>@<version>` for each, so each directory holds the package with its own `node_modules` and without the bundled harness copies. The same script downloads the official Node LTS archive for the target platform from nodejs.org, checks its SHA-256 against the published `SHASUMS256.txt`, and unpacks it to `out/adapters/node/`. electron-builder ships `out/adapters` as extra resources. The Electron binary is not used to run adapters, because in an AppImage it is readable only by the app user. When the app version differs from the one in `PECORE_HOME/adapters/version`, `home/layout.ts` copies the adapters there keeping their file modes, removes directories of versions no longer pinned, and writes the new version.
*   **Claude Code version:** the adapter's Agent SDK expects a Claude Code at least as new as the one it bundles. The connector's `versionRange` is therefore a lower bound only (`>=` that version), and newer releases are accepted.

### Data model

Events (`src/events.ts`). Each row of `events` has `id` (ULID), `job_id`, `type`, `payload` (JSON), `at`. Every event updates the listed views in the same transaction.

| Event | Payload | Views changed |
|---|---|---|
| `job.created` | recipe, ticket artifact, parent, base branch, base commit, target | `jobs` insert |
| `job.state_changed` | state, reason | `jobs.state`, `jobs.waiting_reason` |
| `job.base_change_requested` | cause, base commit (null: the head of the target when applied), target | none; the latest request after the last `job.base_changed` is pending |
| `job.base_changed` | cause (`parent_commit`, `parent_merged`, `realign`), new base commit, old base commit, new target | `jobs.base`, `jobs.old_base`, `jobs.target` |
| `job.delivery_merged` | delivery URL | `jobs.merged_at` |
| `job.archived`, `job.unarchived` | | `jobs.archived` |
| `node_run.created` | node, round, the index of the edge that started it (null for `start` and `onBaseChanged`) | `node_runs` insert |
| `node_run.state_changed` | state, waiting reason, reset time, queue item id (for reasons `human`, `confirmation`, `round_limit`, `budget`), account id, OS user and login type (for `auth`) | `node_runs` |
| `node_run.git_recorded` | branch SHA, HEAD, `refs/stash` | `node_runs.git_before` |
| `node_run.completed` | outcome, content state after, artifacts | `node_runs` |
| `node_run.failed` | failure reason | `node_runs` |
| `attempt.started` | profile, connector, harness and connector versions, OS user, session group, log path | `attempts` insert |
| `attempt.session_started` | ACP session id, `resumed` | `attempts.session_id`, `attempts.resumed` |
| `attempt.ended` | end reason (outcome, waiting reason or failure reason), resolved model, tokens (input, output, cache read, cache write), cost | `attempts`, `usage_daily` |
| `effect.requested`, `effect.completed`, `effect.failed` | node, command hash, result | none |
| `queue.added`, `queue.resolved` | kind, subject, choice, note | `human_queue` |
| `confirmation.recorded` | path, sha256 | `confirmed_hashes` |
| `ticket.seen` | source, ticket id | `tickets_seen` |

Tables (`src/store/migrations/001-init.sql`):

| Table | Columns |
|---|---|
| `jobs` | `id` pk, `title`, `recipe` (copy of the recipe instance at job start), `state`, `waiting_reason`, `failure_reason`, `parent_job_id`, `base_branch`, `base`, `old_base`, `target`, `branch`, `archived`, `merged_at`, `created_at`, `updated_at`; index on `state`, `parent_job_id` |
| `node_runs` | `id` pk (`<job>/<node>#<round>`), `job_id`, `node`, `round`, `via_edge`, `state`, `outcome`, `waiting_reason`, `reset_at`, `queue_item_id`, `auth_account`, `auth_os_user`, `auth_kind`, `failure_reason`, `content_before`, `content_after`, `git_before` (JSON), `pgid`, `os_user`, `started_at`, `ended_at`; index on `job_id` |
| `attempts` | `id` pk (ULID), `node_run_id`, `profile`, `connector`, `harness_version` (first semver in the version check output), `connector_version` (`agentInfo.version` from `initialize`), `model` (resolved id, 5.3), `account`, `os_user`, `session_group`, `session_id` (the ACP session id), `resumed`, `tokens_in`, `tokens_out`, `cache_read`, `cache_write`, `cost`, `end_reason`, `log_path`, `started_at`, `ended_at` |
| `human_queue` | `id` pk, `job_id` (nullable), `kind` (`human-node`, `agent-question`, `engine-node`, `source-node`, `connector`, `recipe-change`, `import`, `ticket`, `services`, `round-limit`, `budget`), `subject` (JSON: a snapshot of everything the user must see to decide, for example the full node definition and script, never re-read from disk at decision time), `subject_hash` (sha256 of `subject`), `state` (`open`, `resolved`, `cancelled`), `choices` (JSON), `choice`, `note`, `created_at`, `resolved_at` |
| `confirmed_hashes` | `path` pk, `sha256`, `confirmed_at` |
| `tickets_seen` | `source`, `ticket_id`, `seen_at`; pk on both |
| `usage_daily` | `day` (local time), `account`, `tokens_in`, `tokens_out`, `cache_read`, `cache_write`, `cost`; pk on `day`, `account` |
| `schema_version` | `version` |

`chats.db`: `chats` (`id`, `title`, `last_read_at`, `created_at`), `messages` (`id`, `chat_id`, `role`, `text`, `context` (JSON references), `created_at`), `attachments` (`id`, `message_id`, `path`, `mime`), `actions` (`id`, `message_id`, `tool`, `target` (JSON reference: job, definition path or queue item), `created_at`; written by the MCP tool handlers, read by the GUI for the chat cards), `notifications` (`id`, `kind`, `title`, `body`, `target`, `created_at`; the last 500 are kept).

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
| `reader` | name of the reader in `@pecore/agents` (`claude-code`, `codex`), or `null` (5.3) |
| `errors` | list of `{ "pattern": <regex>, "in": "error" \| "text", "kind": "quota" \| "rate_limit" \| "auth" \| "other", "resetAt": <regex group name or null>, "resetFormat": "epoch" \| "iso" \| "seconds" }`; `error` is a JSON-RPC error message, `text` the agent's text of the turn (5.4); `seconds` counts from when the message arrived |
| `loginCommand` | the harness's interactive login command, per platform; for Claude Code `["{harnessPath}", "auth", "login", "--claudeai"]` |
| `loginUrlPattern`, `loginReadsCode` | regex of the URL the GUI shows; whether the command then reads a code on stdin (5.9) |
| `beforeLogin`, `beforeStart` | optional lists of argument arrays per platform, run as the project user before the first login and before every connector start, only for logins in a `~/.pecore-harness/` directory (3.4), never for the harness's own default one; for example the Claude Code Keychain steps on macOS (Fixed choices) |
| `identityCommand`, `identityField` | used only when the connector reports no account at session start (5.9) |

Recorded ACP traffic for tests lives in `packages/agents/fixtures/<connector>/<case>.jsonl`, in the raw log format (section 9). Each case has a `<case>.expected.json` with the events and the `TurnResult` it must give. The five files recorded in phase 0 (`claude-code/two-turns`, `claude-code/permission`, `claude-code/auth-missing`, `codex/tool-call`, `opencode/auth-missing`) have no `at` field; the test loader accepts lines without it, and their `expected.json` files are written in phase 3. The three files of the sudo spike (`claude-code/protected-new`, `protected-resume`, `protected-stop`) have it.

### Local API, WebSocket and MCP

*   The engine binds `127.0.0.1` on port 0 and writes `run/api.json` (`{ "port", "token" }`, mode 0600). The token is a random 32-byte value made by the engine at each start. The engine also sends port and token to the main process in `ready`; the main process gives them to the renderer through preload and never reads the file. The CLI reads the file.
*   Every request carries `Authorization: Bearer <token>`, except `/live`, which authenticates with its first message. The server also checks `Host` and `Origin` (Phase 5 decisions).

| Method and path | Purpose |
|---|---|
| `GET/POST /projects`, `GET /projects/:id` | list, create (Project creation below; the body lists the starting recipes to instantiate), read; a project is edited by saving its `project.json` through `PUT /definitions/projects/<id>/project.json` |
| `POST /projects/:id/export`, `POST /projects/import` | share |
| `GET /jobs`, `GET /jobs/:id`, `GET /jobs/:id/why` | list and read |
| `POST /jobs` | create (Job creation below) |
| `POST /jobs/:id/{stop,pause,play,resume,archive,delete,realign,check-merge}` | controls; `check-merge` runs merge detection for the job now (decision 10) |
| `POST /pause`, `POST /play`, `POST /play-interrupted` | global controls; `play-interrupted` plays every job paused by the app quit |
| `GET /projects/:id/creation`, `POST /projects/:id/creation/{retry,cancel}` | an unfinished project creation: the state of each task of "Project creation", the error, the open confirmation item of the repo creation node; Retry and Cancel (decision 13) |
| `GET /status` | app version, home check warnings, global pause, jobs paused by the quit, Inbox count |
| `GET /first-run` | the check of each first run step (ui-design.md First run) |
| `POST /prerequisites/check` | runs the checks of decision 12 for the features in use; each result names the setting it points to |
| `GET /usage?from&to` | tokens per account, project and day; cost of API key accounts; budgets with their use; cooldowns; the last quota seen per account (5.3) |
| `GET /themes` | the theme files of `PECORE_HOME/themes/`, each with its tokens or its validation error |
| `GET /queue`, `POST /queue/:id` | waiting items and the user's choice; the body carries `{choice, note, input, hash}`, where `hash` is the sha256 of the item's `subject` the GUI showed; the engine refuses the choice (409) if the item changed, was resolved or was cancelled since |
| `GET /definitions?dir`, `GET/PUT /definitions/*path`, `POST /definitions/validate`, `POST /definitions/instantiate` | templates and instances, by path under the `PECORE_HOME` layout (`library/...`, `projects/<id>/...` even for a moved project, `connectors/...`); `GET` returns the file's sha256, `PUT` carries it as `baseSha256` (null for a new file) and is refused (409) when the file changed since; saving or instantiating an engine or source node returns the ids of its confirmation items |
| `DELETE /projects/:id` | project delete (4.8) |
| `POST /protected-mode` | `{on: true}` creates `pecore-agent` if missing and switches every project to it; `{on: false}` switches back; `{on: false, removeUser: true}` also removes the user (admin prompt) |
| `POST /accounts/:id/recheck` | re-runs the identity check of a forge or service account, or of every login of a model account, and releases runs waiting with `auth` on them |
| `POST /chats/:id/read` | sets `last_read_at` |
| `GET /notifications` | the notification log |
| `GET/PUT /settings`, `/accounts`, `/profiles`, `/tiers` | global files; `GET` returns the value and its sha256, `PUT` carries `baseSha256` (409 when the file changed since); `protectedMode` changes only through `POST /protected-mode` |
| `GET /logins`, `POST /logins` | harness logins (account and OS user, 3.4) with their state; start one (`{account, osUser}`); progress and the URL over WebSocket |
| `POST /logins/:id/code`, `POST /logins/:id/recheck` | send the code the login command reads on stdin (5.9); re-run `checkLogin` and release runs waiting with `auth` on that login |
| `POST /accounts/:id/login` | start a forge or service tool login; progress over WebSocket |
| `GET /accounts/:id/options` | the models and efforts the account's connector offers (`listOptions` through any logged-in login of the account), for the profile editor |
| `GET/POST /chats`, `POST /chats/:id/messages` | orchestrator chat; a message has text, attachments and an optional `context` of references (section 6) |
| `GET /artifacts/:job/:run/:name`, `GET /logs/:attempt?view=events\|raw` | files; `events` returns the normalised events of the attempt (the shape of `log.line`), `raw` the JSONL lines; 410 when retention removed the log |

*   WebSocket `/live` sends a union of `job.updated`, `node_run.updated`, `queue.updated`, `project.updated` (a creation step changed), `definition.changed` (path, new hash), `log.line` (one normalised event), `login.progress`, `chat.message`, `chat.action`, `notify`. `log.line` is sent only for attempts the client subscribed to (`{subscribe: attempt id}`, `{unsubscribe: attempt id}`), so the GUI receives the lines of the log it shows and nothing else.
*   MCP: HTTP transport (streamable HTTP) on a second `127.0.0.1` port, header `Authorization: Bearer <orchestrator token>`. The token is made at each start and passed in the `mcpServers` field of the orchestrator's `session/new`, with the URL and the header.

### Engine and main process messages

Over `parentPort`: engine to main `ready {port, token}`, `error {message}` (the engine could not start; main shows it and quits), `notify {title, body, kind}`, `admin {script}` (main runs the admin prompt and replies `admin.result`), `active {jobs}` (reply to `active?`), `shutdown.done`. Main to engine: `active?`, `shutdown`.

Window and tray: closing the window hides it; the app, the engine and the jobs keep running. A tray icon (Electron `Tray`) shows the number of running jobs and items in the Inbox, and has "Open PeCore" and "Quit". The app holds a single-instance lock (`app.requestSingleInstanceLock()`): launching it again shows the existing window, so the window can be reopened on a Linux desktop with no tray. The first time the window is hidden, a notification says that jobs keep running and how to quit.

Quit (tray, app menu, Cmd+Q): main asks the engine `active?`. If jobs are `running` or `waiting`, a dialog says how many jobs will be interrupted and that they will be `paused` at the next start; the user confirms or cancels. Then on `before-quit` the main process calls `event.preventDefault()` once, sends `shutdown`, and waits for `shutdown.done` for at most 15 seconds. The engine stops every process group (TERM, then KILL after 5 seconds), runs the leftover sweep of section 1, runs `compose down -v` for its `pecore-*` projects, closes the databases and replies. Then main calls `app.exit()`. At the next start, if jobs were paused by the quit, Factory shows "Play interrupted jobs", which plays all of them.

### Project creation

`src/projects/create.ts`, in order. A step that fails undoes the steps before it and reports which step failed.

1.  Validate the id. With a `repo`, also validate its URL and account and check the account belongs to the repo's forge and host; with `repo: null` there is no forge account to check.
2.  Nothing to create for the OS user: in normal mode the project runs as the app user; in protected mode `pecore-agent` already exists.
3.  Create the project directory, `project.json`, `pecore.db`; set ownership and permissions (section 8).
4.  With `repo: null`: create `repo.git` with one empty initial commit on `baseBranch`; no `createRepo`, no clone. If the remote exists: clone into `repo.git`. Otherwise create the empty repo and run the `createRepo` node once, as a job-less node run recorded under the pseudo-job id `project-setup` with the usual probe, confirmation and `effect.*` events.
5.  Configure `repo.git` (Fixed choices), run the home check, commit the definitions to `PECORE_HOME`.
6.  In protected mode, give `pecore-agent` access to the new project (group and ACLs, Fixed choices). No login is needed: logins belong to the user, not to the project.

### Job creation

`src/jobs/create.ts` is used by `POST /jobs`, the orchestrator's `create_jobs` and ticket intake. It validates the recipe, writes the `ticket` artifact, fetches the base branch (not for a `repo: null` project, whose base branch lives only in `repo.git`), and sets base commit, target and branch. A job with an unfinished parent is created `queued` with reason `parent_job`; otherwise it waits for the scheduler and the disk check. When the job starts, the engine fetches its target branch again (unless the target is a `factory/` branch of a parent) and creates the worktree from the fetched head, recorded as `job.base_changed` with cause `fetched`; if that fetch fails, the job stays `queued` with reason `network` or `auth` and never starts on an old base.

### Tests

| File | Scenario | Runs |
|---|---|---|
| `graph/rules.test.ts` | property tests of 4.2 | CI |
| `workdir/fs-as.test.ts` | symlinks at every engine file path | CI (Linux, with a test user) |
| `workdir/git-as.test.ts` | hooks, `core.fsmonitor`, `core.sshCommand` and a forged `commondir` do not run as the app user | CI (Linux, test user) |
| `workdir/content-state.test.ts` | `READ_ONLY_VIOLATION` restore; `requires` gives `stale`; interrupted rebase is undone | CI |
| `definitions/confirm.test.ts` | a changed engine node waits for `confirmation`; untrusted ticket path | CI |
| `agents: src/connectors.test.ts` | for each built-in connector, the incoming messages of each fixture go through the reader and the classifier, and the result must equal `<case>.expected.json`: auth, quota and rate limit errors (synthetic until recorded, 5.4), usage, account (G7) | CI |
| `agents: src/session.test.ts` | ACP session with the fake agent: options applied in order and checked, a mismatching `currentValue`, permission answered, resume and fallback to a new session, a request past 30 seconds, connector exit without answer | CI |
| `engine: runners/agent.test.ts` | agent node with the fake agent: the order of 5.4, invalid output corrected twice then `INVALID_OUTPUT`, timeout with cancel then stop, `retry` use, quota and auth waits, resume lookup (5.5) | CI |
| `phase 0: Claude Code through sudo` | done ([sudo spike](spikes/sudo.md)); by hand, with the spike client `docs/spikes/sudo/client.mjs`, the adapter installed with `npm install` into a directory `pecore-agent` can read, and a Node LTS from nodejs.org in the same kind of directory (the real build of phase 3 is not needed); recorded as fixtures: the adapter, that Node and the user's Claude Code run as `pecore-agent` (protected mode) with a new config directory; a session in `bypassPermissions`; a resume in a new process; no claude.ai MCP servers and no repository `.mcp.json` servers in the session; stopping the process group stops the harness | manual, real login |
| `jobs/crash.test.ts` | kill during each delivery node, restart, no double delivery (G12) | CI with the fake forge |
| `jobs/stacked.test.ts` | three-job chain: parent recommit, parent merge, parent failure (G9) | CI with the fake forge |
| `e2e/languages.test.ts` | same recipe shape on a TypeScript and a Rust fixture project (G2) | CI |
| `e2e/forges.test.ts` | delivery to GitHub, GitLab, local only (G3) | manual, sandbox accounts |
| `e2e/providers.test.ts` | `feature` with three connectors: Claude Code, Codex, opencode (G6) | manual, real logins |
| `e2e/why.test.ts` | `why` output for every waiting reason (G13) | CI |

The fake forge (`test/fake-forge/`) is a local bare repo plus scripts that imitate the `gh` commands used by the GitHub templates. The fake agent (`test/fake-agent/agent.mjs`, outside the build) is an ACP agent that follows a script named by the variable `FAKE_AGENT_SCRIPT`: a JSONL file of steps `{ "expect": <method> }`, `{ "send": <JSON-RPC message> }`, `{ "write": { "path", "content" } }`, `{ "sleep": <ms> }`, `{ "exit": <code> }`. Tests use it through a connector file of kind `native` with `harness.program` `node` and reader `claude-code`.

### Root

| File | What and why |
|---|---|
| `package.json` | pnpm workspace root; scripts `build`, `test`, `lint`, `typecheck`, `dist` |
| `pnpm-workspace.yaml` | lists `packages/*` |
| `tsconfig.base.json` | shared TypeScript strict settings |
| `vitest.config.ts` | `test.projects` lists every package; run under Electron's Node (Fixed choices) |
| `.npmrc` | `node-linker=hoisted` for electron-builder |
| `eslint.config.js` | lint rules for all packages |
| `.gitignore` | ignores `node_modules/`, `dist/`, `out/` |
| `LICENSE` | MIT (D8) |
| `README.md` | what PeCore is, install, first run, build from source |
| `.github/workflows/ci.yml` | lint, typecheck and tests on Linux and macOS for every push |
| `.github/workflows/release.yml` | on tags: builds AppImage, deb, dmg and zip; signs and notarizes the macOS build; publishes to GitHub Releases for auto-update |

### `packages/schemas`: Zod definitions

Every file exports a Zod schema and the TypeScript type inferred from it. The engine, the app and the CLI import types only from here.

| File | What and why |
|---|---|
| `src/node.ts` | node schema of 3.1: common fields, fields by kind (including `source`), `failOutcomes`, `probeRules`, `mergedCheck`, `scratchPaths`, placeholder syntax check |
| `src/recipe.ts` | recipe schema of 3.2: `start`, `onBaseChanged`, `maxNodeRuns`, `successOutcomes`, nodes, edges, `requires`, `optional`, `skipWhenUnchanged`, `maxRounds` |
| `src/project.ts` | `project.json` of 3.5 |
| `src/accounts.ts` | `accounts.json` with the kinds `model`, `forge`, `service` |
| `src/profiles.ts` | `profiles.json` |
| `src/tiers.ts` | `tiers.json`, with the four tier names fixed |
| `src/settings.ts` | `settings.json` with defaults: `limits.jobs` (CPU cores / 2), `limits.agents` (4), `limits.providers` (per provider, none), `servicesRuntime`, `projectPaths`, `minFreeDiskGb` (10), `mergeCheckSec` (300), `prices` (per resolved model id, per million tokens of input, output, cache read and cache write), `programPaths` (optional absolute paths of harness programs and Node, 5.7), `quietHours`, `orchestrator` (profile), `protectedMode` (false), `firstRunDone` (false until the first run ends; while false the GUI opens the first run), UI preferences |
| `src/connector.ts` | connector file (Connector file above) |
| `src/artifacts.ts` | artifact types of 3.3. `spec`: `criteria[]`, `tests[]`, `interfaces[] {name, signature}`, `optionalNodes[]`. `findings`: `verdict`, `items[] {file, line, severity, text}`. `risk`: `hunks[] {file, hunkIndex, level: safe \| risky, reason}` |
| `src/events.ts` | the events of Data model |
| `src/api.ts` | request and response bodies of the API table and the WebSocket union |
| `src/errors.ts` | waiting reasons and failure reasons of 4.3 |
| `src/index.ts` | exports |
| `src/json-schema.ts` | builds the JSON Schemas from the Zod schemas; the engine writes them to `$PECORE_HOME/schemas/` at every start (section 2) |

### `packages/agents`: ACP client and connectors

Everything that knows ACP or a harness lives here (section 5). It imports only `@pecore/schemas`; the engine imports only `src/index.ts`.

| File | What and why |
|---|---|
| `src/index.ts` | the interface of 5.1: functions, `Login`, `Spawn`, `Session`, `TurnResult`, `AgentEvent` |
| `src/acp/client.ts` | JSON-RPC 2.0 over the `Spawn` streams, one message per line; requests with ids and the 30-second limit before the prompt, notifications, answers to agent requests (Fixed choices: ACP); emits every message and stderr line in the raw log format (section 9), with the MCP token replaced by `***` |
| `src/session.ts` | `startSession` and `Session` (5.2, 5.5): `beforeStart`, `initialize`, resume or new session, `sessionConfig` in order with the `currentValue` check, `session/prompt`; maps notifications to `AgentEvent`; answers permission requests; builds `TurnResult` |
| `src/connectors.ts` | loads built-in connector files from the app's resources and user ones from `PECORE_HOME/connectors/`; fills the placeholders of `command` and `env`; resolves `{adapter:<package>}` from `adapters.json` |
| `src/prerequisites.ts` | `checkPrerequisites`: runs the harness's `versionArgs` and the shipped `node --version` through `spawn` as the project user, checks `versionRange` |
| `src/errors.ts` | sets `TurnResult.error` for steps 2, 4 and 5 of 5.4: `-32000` with "Authentication required" is `auth`, a `rejected` quota is `quota`, then the connector's `errors` rules, else `other` when the turn did not end with `end_turn`; the engine applies the order of 5.4 |
| `src/readers/claude-code.ts` | usage with side models, resolved model, cost and `_claude/rateLimit` from the prompt answer and `usage_update` (5.3); `auth/status_update` to `account` (5.9) |
| `src/readers/codex.ts` | usage without double-counted cache (5.3); `_auth/status_update` to `account` |
| `src/login.ts` | `prepareLogin` and `checkLogin` (5.9) |
| `src/options.ts` | `listOptions` (5.9) |
| `src/connectors.test.ts`, `src/session.test.ts` | Tests |
| `fixtures/<connector>/<case>.jsonl`, `<case>.expected.json` | recorded ACP traffic and the expected result (Connector file) |
| `adapters.json` | the adapter packages and versions this app pins (Fixed choices: Adapters) |
| `scripts/build-adapters.mjs` | installs each pinned adapter into `out/adapters/<package>@<version>/` (Fixed choices: Adapters) |

### `packages/engine`: the engine process

| File | What and why |
|---|---|
| `src/main.ts` | entry point, in order: reads `PECORE_HOME`; takes the lock file; writes `schemas/`; kills processes left from a previous run (section 1); removes orphan `pecore-*` compose projects (4.9); runs the home check (section 8); opens the projects; sets interrupted jobs to `paused`; starts the API and the MCP server and writes `run/api.json`; sends `ready`; then, in the background, runs `checkLogin` for every harness login (3.4); handles `shutdown` (Engine and main process messages) |
| **home/** | |
| `src/home/layout.ts` | paths of section 2; on first run creates `PECORE_HOME` and `run/` (0700), runs `git init` with the `.gitignore` of section 2, and copies the shipped `library/` into it; when the app version changed, copies the bundled adapters to `adapters/` (Fixed choices: Adapters) |
| `src/home/git-commit.ts` | commits every definition change to `PECORE_HOME` (or to the project's own repo if it was moved) with the message `<kind> <name>: <created\|edited\|deleted>` |
| `src/home/lock.ts` | one engine per `PECORE_HOME`; a lock whose pid is not running is taken over |
| `src/home/prerequisites.ts` | first-run and start checks: git, sudo, setfacl (Linux), Compose v2, gitleaks; when an account needs them: gh 2.40 or later, glab; for each harness login, `checkPrerequisites` as its OS user (5.1), after adding the traverse ACLs of 5.7 |
| **projects/** | |
| `src/projects/create.ts` | Project creation above |
| `src/projects/defaults.ts` | a new project gets instances of the shipped `feature`, `bugfix` and `local-only` recipes the user selected (all by default) with the nodes they use (instantiate rules below); delivery nodes match the project's forge (`github-pr` and `github-issue-comment`, or `gitlab-mr` and `gitlab-issue-comment`); a local-only project (`repo: null`) gets only `local-only` |
| **definitions/** | |
| `src/definitions/load.ts` | reads and validates definition files; returns typed errors with file and field |
| `src/definitions/recipe-check.ts` | recipe rules beyond the schema: `use` exists in the project, every edge outcome exists on its node, inputs producible before use (3.3), a parent recipe has a commit node (4.6), `providerNot` targets exist |
| `src/definitions/instantiate.ts` | copies a template into a project; no link kept (D19). Instantiating a recipe also instantiates every node template it uses that the project lacks; a node instance with the same name is kept, and the GUI shows that the recipe uses the existing one |
| `src/definitions/confirm.ts` | the confirmation queue of section 8: adds `human_queue` rows of kind `engine-node`, `source-node`, `connector`, `recipe-change`, `import`, `ticket`, `services`, each with a snapshot `subject` of the definition and script; items are immutable: a definition that changes while its item is open cancels that item and adds a new one; on confirmation it stores the hash computed from the confirmed `subject`, never from the file on disk; before each use recomputes the hash of the file, and on a mismatch the job waits with reason `confirmation` |
| **store/** | |
| `src/store/project-db.ts` | opens `pecore.db` in WAL mode; one transaction per engine operation; applies migrations by `schema_version` |
| `src/store/migrations/001-init.sql` | the tables of Data model |
| `src/store/chats-db.ts` | `chats.db` for orchestrator chats |
| `src/store/migrations/chats-001-init.sql` | the `chats.db` tables of Data model |
| **graph/** | |
| `src/graph/job-machine.ts` | job states and transitions of 4.1 |
| `src/graph/node-run-machine.ts` | node run states of 4.3 |
| `src/graph/rules.ts` | one node at a time, edges, rounds, `maxNodeRuns`, optional nodes, base change (4.2); pure functions |
| `src/graph/rules.test.ts` | property tests with fast-check: a job never runs two nodes at once, rounds never exceed `maxRounds`, every job reaches a final state or `waiting` |
| `src/graph/executor.ts` | applies the rules to a job: picks the next node, applies `skipWhenUnchanged` (`git diff <base> <commit> \| git patch-id --stable`), asks the scheduler for pool units, hands the node to its runner, records the outcome, writes the `diff` artifact after `changesFiles: true` nodes; answers to `round-limit` and `budget` queue items |
| **scheduler/** | |
| `src/scheduler/pools.ts` | in-memory pools of 4.7; takes all units at once or none; releases them while a job waits for a human, quota, login or confirmation (4.3) |
| `src/scheduler/disk.ts` | before job start, checks free disk against `minFreeDiskGb`; below it the job waits with reason `disk` |
| `src/scheduler/cooldown.ts` | per-account cooldown after quota or rate limit errors; backoff 1, 2, 4, then every 8 minutes |
| `src/scheduler/tiers.ts` | picks the first available profile of a tier that satisfies `providerNot` |
| `src/scheduler/budget.ts` | sums tokens and cost per attempt; at the job or project budget in `project.json` the job waits with reason `budget`; one `budget` queue item per limit reached, shared by every job that limit blocks |
| **workdir/** | |
| `src/workdir/repo.ts` | creates and configures `repo.git` (Fixed choices); adds `.pecore/` to `info/exclude`; clones and fetches with the project account and the forge's credential helper; deletes `factory/*` branches with `--git-dir` |
| `src/workdir/worktrees.ts` | as the project user, with `--git-dir`: creates, recreates (job re-entering `running`) and removes job worktrees |
| `src/workdir/content-state.ts` | as the project user: tree hash with a temporary index, excluding ignored files and `.pecore/`; deletes `scratchPaths` matches; restores a previous state; records branch SHA, HEAD and stash list per node run and undoes interrupted git operations (4.4); recomputes before `requires` and commit; creates `cleanCheckout` worktrees |
| `src/workdir/fs-as.ts` | the only way the engine reads, writes or deletes files under `work/` or in another user's home (harness config directories, 5.9): runs `test`, `cat` and `find -P` as the project user through `runners/process.ts`, refusing symlinks (section 8) |
| `src/workdir/git-as.ts` | the only entry point for git: work-tree commands go through `sudo -n -u <project user>`; app-user commands get `--git-dir` and no work tree; both get `core.hooksPath=/dev/null` |
| **runners/** | |
| `src/runners/process.ts` | spawns a process as a given OS user and records its pgid (Fixed choices: Process groups); applies the timeout of command nodes; to stop, sends `TERM` to the group through `sudo -n -u <user> kill`, then `KILL` after 5 s; gives `runners/agent.ts`, `accounts/` and the orchestrator a `Spawn` (5.1) bound to one OS user |
| `src/runners/placeholders.ts` | substitutes placeholders into argument arrays; builds `PECORE_*` environment variables for `script` nodes and probes |
| `src/runners/command.ts` | runs `command` nodes: probe, command, `outcomeRules`, `outputRules`, `check-log` artifact |
| `src/runners/probe.ts` | runs the probe and applies `probeRules`: `done`, `not_done`, `unknown`; on `unknown` the node run waits with reason `network` and retries (4.8) |
| `src/runners/agent.ts` | runs `agent` nodes through `@pecore/agents`: writes `.pecore/` (context, inputs, `output.schema.json`) and the prompt artifact; looks up the session to resume (5.5); calls `startSession` with a `Spawn` from `process.ts`; sends the prompt; writes the raw log; applies the order of 5.4 to each `TurnResult`, reading `.pecore/output.json` through `fs-as.ts`; owns the attempt timeout (5.5); records tokens, cost and the end reason. It knows no connector-specific detail |
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
| `src/jobs/effects.ts` | writes the events `effect.requested`, `effect.completed`, `effect.failed` around engine nodes (4.8) |
| **osuser/** | |
| `src/osuser/script.ts` | builds the privileged script that creates or removes `pecore-agent` (user, group, sudo rule); the same text is shown in the guided procedure |
| `src/osuser/protected-mode.ts` | turns protected mode on and off (Fixed choices): admin prompt, group and ACLs on every project, logins of `pecore-agent` |
| `src/osuser/acl.ts` | traverse-only ACLs on the path to `work/` (`setfacl` on Linux, `chmod +a` on macOS) |
| `src/osuser/home-check.ts` | checks that the app user's home and tool login files are not readable by others; returns the fix commands |
| **services/** | |
| `src/services/compose-file.ts` | reads the compose file from the base commit with `git show`, rejects forbidden keys (4.9), stores the confirmed copy, puts changes in the confirmation queue |
| `src/services/runtime.ts` | lifecycle of 4.9 with the runtime command map (Fixed choices): starts, stops and cleans up `pecore-<job id>` compose projects; reads ports into `PECORE_SERVICE_*` variables; waits with reason `services` until healthy |
| **api/** | |
| `src/api/server.ts` | Fastify on `127.0.0.1` port 0; writes `run/api.json`; token, `Origin` and `Host` checks |
| `src/api/routes/projects.ts` | project routes of the API table |
| `src/api/routes/jobs.ts` | job routes and global controls |
| `src/api/routes/queue.ts` | queue routes: human nodes and confirmations |
| `src/api/routes/definitions.ts` | definition routes |
| `src/api/routes/settings.ts` | settings, accounts, profiles, tiers, protected mode, logins |
| `src/api/routes/chats.ts` | chat routes; a new message starts an orchestrator turn |
| `src/api/routes/files.ts` | artifacts and raw logs |
| `src/api/ws.ts` | the WebSocket union |
| **orchestrator/** | |
| `src/orchestrator/mcp-server.ts` | MCP over streamable HTTP on `127.0.0.1` with its own token; the tools of section 6 only |
| `src/orchestrator/tools.ts` | tool handlers; the `write_*` handlers validate input before saving; `read_artifact` returns at most 200 KB, the end of a log when it is longer; `answer_question` resolves a question an agent asked through the chat (an `agent-question` item), never a review or confirmation |
| `src/orchestrator/session.ts` | one `startSession` per user message, as the orchestrator's OS user, in the chat's fixed directory, resuming the chat's ACP session id, so the conversation continues; one message at a time per chat; the MCP server goes in `mcpServers` at every start or resume (section 6); if the session cannot be resumed, the new session gets the chat's earlier messages from `chats.db` in its prompt; attachments are copied into the chat's directory and listed in the prompt; the message's `context` references are listed in the prompt |
| **sources/** | |
| `src/sources/run.ts` | runs the four commands of a source definition through `runners/command.ts`, and parses their JSON output |
| `src/sources/poll.ts` | calls `list` on each project's source node every `pollSec`, stores seen ids in `pecore.db`, and hands new tickets to the orchestrator (section 7) |
| **share/** | |
| `src/share/export.ts` | `.tar.zst` archive of a project without clone, workdirs or raw logs; history is optional; when included, artifacts are scanned with `gitleaks` default rules before export (section 8) |
| `src/share/import.ts` | account mapping; puts every imported node, script and prompt in the confirmation queue (section 8) |
| **observability/** | |
| `src/observability/logs.ts` | writes raw logs (ACP traffic of agent attempts, output of command nodes) as `.jsonl.zst` (library in Fixed choices) |
| `src/observability/why.ts` | blocking reasons of a job, used by GUI and `pecore job why` |

### `packages/app`: Electron and React

The screens below come from G16. Their layout is designed in [ui-design.md](ui-design.md), which must be approved before phase 5.

| File | What and why |
|---|---|
| `electron-builder.yml` | AppImage, deb, dmg, zip; auto-update from GitHub Releases; rebuilds `better-sqlite3` for Electron; bundles `library/`, `connectors/` and the adapters (Fixed choices: Adapters) as extra resources |
| `electron.vite.config.ts` | builds main, preload and renderer |
| `src/main/index.ts` | window, menus, tray and single-instance lock; if `userData/home.json` is missing, asks for the `PECORE_HOME` location (default `~/.pecore`) in a small main-process window and writes `home.json`, before the engine starts; then starts the engine; the quit confirmation and the shutdown sequence on `before-quit` (Engine and main process messages) |
| `src/main/engine.ts` | `utilityProcess.fork` of the engine with `PECORE_HOME`; handles `parentPort` messages |
| `src/main/admin.ts` | runs the privileged script text with `pkexec` or `osascript` (Fixed choices) |
| `src/main/notifications.ts` | native notifications for `notify` messages; optional sound; quiet hours |
| `src/main/updater.ts` | auto-update |
| `src/preload/index.ts` | exposes only the API port and token (from the `ready` message) to the renderer |
| `src/renderer/main.tsx` | React root and routes |
| `src/renderer/api/client.ts` | typed HTTP client from `@pecore/schemas` |
| `src/renderer/api/live.ts` | WebSocket subscription |
| `src/renderer/shell/` | navigation, top bar (project filter, global pause, New job, notifications), command palette (`cmdk`), disconnected banner ([ui-design.md](ui-design.md) Proposed Design, Cross-cutting behaviour) |
| `src/renderer/theme/` | theme tokens as CSS variables, loading of `PECORE_HOME/themes/*.json` with schema and fallback (UI4, UI16) |
| `src/renderer/screens/FirstRun.tsx` | first run steps with their done-checks (ui-design.md First run) |
| `src/renderer/screens/Factory.tsx` | home: counters, unfinished jobs, "Play interrupted jobs" |
| `src/renderer/screens/Jobs.tsx` | every job, filters, stacked jobs as a tree, controls by state |
| `src/renderer/screens/JobView.tsx` | header and controls, Graph and History tabs, node run detail, log, artifact viewer, result view |
| `src/renderer/screens/Inbox.tsx` | open `human_queue` items by kind (ID1-ID8), snapshot and hash, lock on cancel |
| `src/renderer/screens/Orchestrator.tsx` | conversations, unread markers, action cards, agent questions |
| `src/renderer/components/MiniChat.tsx` | the mini chat with the context chip (UI2b, UI14) |
| `src/renderer/screens/Projects.tsx` | project list, New project and Import project entry points |
| `src/renderer/screens/ProjectPage.tsx` | project configuration sections, export, delete |
| `src/renderer/screens/NewProjectWizard.tsx`, `ImportProject.tsx` | wizard pages Inputs, Create, Confirm; import pages |
| `src/renderer/screens/RecipeEditor.tsx` | recipe graph editor on a grid, `layout` saving, instance and template modes |
| `src/renderer/screens/NodeEditor.tsx` | node template and instance editor, JSON tab, save with `If-Match` |
| `src/renderer/screens/Library.tsx` | templates, instantiate into a project |
| `src/renderer/screens/Usage.tsx` | observed tokens and cost, budgets, cooldowns |
| `src/renderer/screens/Settings.tsx` | accounts and logins, profiles and tiers, orchestrator, limits, runtime, prices, paths, connectors, updates, notifications, appearance |
| `src/renderer/components/NewJobModal.tsx` | New job form |
| `src/renderer/components/ConfirmItem.tsx` | one confirmation, from the item's `subject` snapshot, sending its hash; used by the Inbox and by inline confirmations (UI17, UI18) |

### `packages/cli`

| File | What and why |
|---|---|
| `src/index.ts` | `pecore` command; reads `run/api.json` and calls the local API; when the API is unreachable, exits with code 1 and prints `PeCore is not running: open the app` |
| `src/commands/project.ts` | `project list`, `export`, `import` (creation is GUI only, because it needs the admin prompt and harness logins) |
| `src/commands/job.ts` | `job list`, `why`, `stop`, `pause`, `play`, `resume`, `realign`, `archive`, `delete` |
| `src/commands/validate.ts` | validates definition files |

### Shipped templates and connectors

Stored in the repository under `packages/app/resources/` and bundled with the app. Templates are copied into `PECORE_HOME/library/` on first run (`home/layout.ts`); connector files are read from the app's resources (5.6). They are data, so adding one needs no engine change (G2, G3). `{project.repo.owner}` and `{project.repo.name}` are the last two path segments of the repo URL (for GitLab subgroups, owner is everything before the last segment).

| File | What and why |
|---|---|
| `library/nodes/spec-writer.json` + `.md` | writes `spec` with criteria and interfaces |
| `library/nodes/tests-writer.json` + `.md` | writes tests and stubs that throw "not implemented" |
| `library/nodes/builder.json` + `.md` | fills the stubs; never edits tests |
| `library/nodes/code-reviewer.json` + `.md` | writes `findings` |
| `library/nodes/approver.json` + `.md` | writes `risk` per hunk |
| `library/nodes/human-review.json` | buttons `approve`, `changes`, `reject` |
| `library/nodes/git-commit.json` | commit; `done` also when there is nothing to commit |
| `library/nodes/git-rebase.json` + `.sh` | `git stash push --include-untracked`, `git rebase --onto {job.base} {job.oldBase}`, `git stash pop` |
| `library/nodes/git-push.json` + `.sh` | push of Fixed choices; probe script: `h=$(git --git-dir="$PECORE_PROJECT_REPODIR" ls-remote origin "refs/heads/$PECORE_JOB_BRANCH" \| cut -f1); [ "$h" = "$PECORE_JOB_COMMIT" ] && echo "$h"; exit 0` |
| `library/nodes/github-pr.json` + `.sh` | 3.1 example; `mergedCheck`: `gh pr view <url> --json state --jq 'select(.state=="MERGED") \| .state'` |
| `library/nodes/github-issue-comment.json`, `github-create-repo.json` | comment with `gh issue comment {ticket.id} --body-file`; probe `gh issue view --json comments` searching the PR URL. Repo creation with `gh repo create {project.repo.owner}/{project.repo.name} --private`, then push of `baseBranch`; probe `gh repo view` |
| `library/nodes/gitlab-mr.json` + `.sh` | probe `glab mr list --source-branch <b> --target-branch <t> -R <repo> --output json`; create `glab mr create --source-branch --target-branch --title --description -R --yes`; retarget `glab mr update <id> --target-branch <t> -R`; `mergedCheck` `glab mr view <id> -R --output json` with a JSON rule on `state == "merged"`. Flags verified against the pinned glab version in phase 4 |
| `library/nodes/gitlab-issue-comment.json`, `gitlab-create-repo.json` | `glab issue note`, `glab repo create`, each with a probe |
| `library/nodes/typecheck.json`, `eslint.json`, `vitest.json` | TypeScript project checks; `vitest` has `cleanCheckout: true` |
| `library/nodes/cargo-check.json`, `cargo-clippy.json`, `cargo-test.json` | Rust checks, for G2; `cargo-test` has `cleanCheckout: true` |
| `library/nodes/github-issues.json`, `gitlab-issues.json`, `markdown-folder.json` | ticket source nodes of section 7, with `label` and `trusted` params. `markdown-folder`: tickets are `*.md` files; `comment` appends to `<ticket>.comments.md`; `replies` reads lines added there after a time |
| `library/nodes/jira.json` | ticket source through `acli` (Atlassian CLI), which keeps its own login |
| `library/recipes/empty.json` | only `start` and end, no nodes (D7) |
| `library/recipes/feature.json` | the recipe of 3.2 |
| `library/recipes/bugfix.json` | the `feature` recipe of 3.2 plus a `github-issue-comment` node after `pr` (outcome `opened`), with `successOutcomes` on the comment node's `done`; its spec writer prompt asks for a failing test that reproduces the bug (CUJ 1) |
| `library/recipes/local-only.json` | the nodes of `feature` up to `git-commit`, with `successOutcomes` `commit:done` (CUJ 4); its reviewer has no `providerNot`, so it runs with a single provider |
| `connectors/claude-code.json` | Claude Code connector (Connector file above), the reference example; built in phase 3 |
| `connectors/codex.json`, `opencode.json` | Codex and opencode connectors; built in phase 6, for G6 |

### Docs

| File | What and why |
|---|---|
| `docs/design.md` (exists) | this design |
| `docs/ui-design.md` (exists) | UI inventory and layout |
| `docs/initial-brainstorm.md` (changed) | a first line pointing to the design that replaces it |
| `docs/nodes.md` | how to write a node: fields, placeholders, probe, `runsAs` |
| `docs/recipes.md` | how to write a recipe: edges, rounds, optional nodes, `onBaseChanged` |
| `docs/connectors.md` | how to add a connector file for a harness with an ACP mode or adapter, and how to record its fixtures |

### Build order

Phases fix the build order only. No phase is a release; the first release contains all six (D1). Each phase ends when its gate passes.

Phases 1-6 target Linux first. The macOS parts (`osuser/` with `dscl` and `sysadminctl`, `chmod +a` ACLs, the `osascript` admin prompt, Keychain logins, dmg signing and notarization) follow in a macOS pass after phase 6, before the first release. Phase 0 still runs the Keychain spike on macOS, because its result can change how harness logins are stored.

| Phase | Files | Gate |
|---|---|---|
| 0. Spikes | none (results go into connector files, fixtures and Open Questions) | done: ACP sessions with Claude Code (two turns, permission, missing login), one Codex tool call, opencode's missing login ([ACP spike](spikes/acp.md)); macOS Keychain behaviour; the "Claude Code through sudo" check of Tests, with its fixtures ([sudo spike](spikes/sudo.md)) |
| 1. Definitions and storage | `schemas`; engine `home/` (except `prerequisites.ts`), `definitions/`, `store/`; root files; the library templates that use no forge or agent | done: every template present validates (each later phase adds its templates, and its gate re-runs the validation); migrations apply; `PECORE_HOME` initialises. `git-rebase` moves to phase 4 with its entry gate (rebase checkpoints), `markdown-folder` with the source templates |
| 2. Engine core | `graph/`, `scheduler/`, `runners/process.ts`, `placeholders.ts`, `command.ts`, `probe.ts`, `human.ts`, `workdir/`, `jobs/create.ts`, `controls.ts`, `delete.ts`, `effects.ts`, `main.ts` (without API), `observability/logs.ts`, `projects/create.ts` for `repo: null` only; test fake forge | done: `rules.test`, `content-state.test`, `fs-as.test`, `git-as.test` pass; command-only recipes run end to end on a local-only project, with the app user as project user (`test/e2e/local-commands.test.ts`). Job controls and delete live in `graph/executor.ts`; the fake forge moves to phase 4, its first user |
| 3. Agents | `packages/agents` with the Claude Code connector only, `adapters.json`, `build-adapters.mjs`; engine `accounts/` (harness logins only), `runners/agent.ts`, `scheduler/tiers.ts`, `cooldown.ts`, `budget.ts`, the `checkLogin` step of `main.ts`; test fake agent | done: `connectors.test`, `session.test` and `agent.test` pass; a `local-only` job on a `repo: null` project runs end to end to its commit with Claude Code as the only provider, with the app user as project user, in normal mode, with the user's existing Claude Code login (`test/e2e/claude-local.test.ts` with `PECORE_REAL=1`: 4 minutes with Sonnet, 2026-11-18) |
| 4. Isolation and delivery | `osuser/`, the rest of `projects/`, `home/prerequisites.ts`, `services/`, `runners/forge-env.ts`, `definitions/confirm.ts`, `jobs/stacked.ts`, `merge-watch.ts`, delivery and source templates | done: `crash.test`, `stacked.test`, `confirm.test` pass with the fake forge; `e2e/forges` passes against real GitHub and GitLab sandbox repositories with `gh` and `glab` (`test/e2e/forges.test.ts` with `PECORE_E2E_GITHUB_REPO`/`_USER` and `PECORE_E2E_GITLAB_REPO`/`_USER`: repo creation on an empty repository, one PR or MR per job, one push and one request after a kill during push, 2026-11-19) |
| 5. API, GUI, CLI | `api/`, `observability/why.ts`, `packages/app`, `packages/cli` (requires approved `ui-design.md`) | done: `why.test` passes; every action of G16 works from the GUI, chat and AI assistance excepted (phase 6): `packages/app/test/gui.test.ts` with `PECORE_GUI=1` drives the built app headless, with the fake `gh` for the forge account login, repository creation, PR delivery and merge check (2026-11-19); harness logins for the user and for the protected user, and protected mode on and off, verified by hand on Linux (2026-11-19) |
| 6. Orchestrator, sharing and more connectors | `orchestrator/`, `sources/`, `share/`, `api/routes/chats.ts`; Codex and opencode connectors with their readers and fixtures | CUJ 1-7 run by hand; `e2e/providers` and `e2e/languages` pass |

Entry gates: a phase does not start until these open findings of the second full review are resolved in this document ([triage](reviews/design/round2/triage.md), table "Later", with sources). Each one is closed by a design change or by a recorded decision to accept it.

| Phase | Must be resolved before it starts |
|---|---|
| 4 | resolved below (Phase 4 decisions) |
| 5 | resolved below (Phase 5 decisions) |
| 6 | ticket intake persisted through job creation, with a stable intake id and no-source projects; how an agent creates an `agent-question` and how the answer reaches its next turn; images in orders; protected orchestrator after restart with the new MCP token; that token reaches `claude` on its command line (`--mcp-config`, when `CLAUDE_CODE_EXECUTABLE` is set), readable by every local user in `/proc` ([sudo spike](spikes/sudo.md)) |
| macOS pass | Keychain with an empty password: path, creation and unlock after logout; pass criteria of the macOS gate |

#### Phase 4 decisions

Each line closes one entry gate of phase 4 and overrides the earlier text it contradicts.

1.  **Rebase checkpoint.** `git-rebase.sh` never uses `refs/stash`, which all worktrees of `repo.git` share. With uncommitted changes it makes a checkpoint commit on the job branch (`git add -A`, `git commit --no-verify -m "pecore checkpoint"`), runs `git rebase --onto {job.base} {job.oldBase}`, then `git reset --mixed HEAD~1` to turn the checkpoint back into uncommitted changes. A conflict runs `git rebase --abort`, `git reset --mixed` to the recorded head, and gives `conflict`. The engine no longer records or restores `refs/stash`.
2.  **Push probe.** The `git-push` probe prints JSON `{"state": "absent" | "same" | "other", "head": "<sha or empty>"}` and exits non-zero when `ls-remote` fails (`unknown`). `probeRules`: `done` on `same`, `not_done` on `absent` and `other`. The engine passes the probe's stdout to the command as `PECORE_PROBE_STDOUT`; the push script uses its `head` as the expected value of `--force-with-lease`, so a remote branch moved by someone else after the probe makes the push fail instead of overwriting it.
3.  **Repo creation probe.** `done` only when the remote repository exists and has `baseBranch`. The creation script creates the repository if missing, then pushes `baseBranch`; running it on an existing empty repository only pushes.
4.  **Auth versus network.** When a probe gives `unknown` or a `runsAs: engine` command fails with no matching outcome rule, the engine runs the account tool's identity check (`gh auth token --user <login> --hostname <host>`, `glab config get token --host <host>`). A failed check makes the node run wait with reason `auth` (kind `tool`); a passing check means `network`.
5.  **Compose.** Allowed service keys: `image`, `environment`, `ports` (only `127.0.0.1::<port>`), `healthcheck`, `command`, `entrypoint`, `tmpfs`, `depends_on`, and `volumes` with named volumes only; any other key refuses the file. The check runs on the output of `compose config --format json` of the confirmed copy, so anchors, `extends` and variables are resolved before the check. Before that command runs, the engine parses the file with the `yaml` package (one document, no duplicate keys, merge keys resolved, no parse warnings) and refuses `include`, `services.*.env_file`, `services.*.label_file` and `services.*.extends.file`, because `compose config` would already read the files they name. The engine is the only owner of services: on quit it runs `compose stop` (data kept), not `down -v`, and the main process runs nothing; a final job state runs `down -v`; Play starts stopped services with `compose start`; the start-up sweep removes `pecore-*` projects whose job is final or missing.
6.  **Protected `repo.git`.** `repo.git/` is mode 3775 (setgid and sticky) with group `pecore-agent`: the project user can create `packed-refs` and lock files but cannot rename or delete the app user's `config`, `HEAD`, `hooks/` and `info/`, which stay owned by the app user and not group-writable. Protected mode is switched only when no job is `running`; running jobs are paused first. The admin prompt that switches also changes the owner of every `work/<job>/` to the new project user.
7.  **Confirmation store.** Confirmed hashes of project definitions live in `pecore.db`; those of global connector files in `chats.db` (table `confirmed_hashes`, same columns). The hash is the sha256 of the canonical JSON of the definition followed by the bytes of every file it runs (`script`, probe and `mergedCheck` scripts). The engine reads those bytes once, hashes them, and runs exactly those bytes (`/bin/sh -c`), so a file changed between check and run cannot run.
8.  **Forge choices as data.** `library/forges/<forge>.json` names, per forge, the clone credential helper, the delivery, comment, repo creation and source node templates. `projects/defaults.ts` reads it; the engine has no `if github`.
9.  **Slots while waiting.** A node run holds pool units only while its process runs. Waits for `network`, `auth`, `quota`, `rate_limit`, `budget`, `human` and `confirmation` hold none.
10. **Stacked jobs.** A child's target while the parent is not merged is the parent's branch; after the merge, the parent's own target. A queued child gets its base when the parent ends `succeeded`: the SHA of the parent's latest `commit` artifact. Merge detection runs, while the app runs, for every job that has a `delivery` artifact not yet merged, whatever the state of the job and of its children, using the URL in that artifact; the API also runs it on demand for one job.
11. **Bugfix proof.** `bugfix` runs `tests-fail-check` after the tests node: a `vitest` variant whose outcome is `failed_as_expected` when the tests fail and `unexpected_pass` when they pass; `unexpected_pass` goes back to the tests node.
12. **Prerequisites by feature.** First run checks git, and on Linux sudo and setfacl only when protected mode is turned on. `gh`, `glab` and `aws` are checked when an account uses them, Compose when a project has `services`, gitleaks at the first export.
13. **Project creation across a restart.** `projects/<id>/creating.json` records the last finished step. At start, an unfinished creation is shown in the Inbox with Retry (continue from the next step) and Cancel (undo the finished steps). The `createRepo` node run waits like any node run (`network`, `auth`, `confirmation`).
14. **Group before relogin.** The admin prompt that turns protected mode on also runs the group and ACL steps for every existing project as root. A project created later, while the app user's session does not have the group yet (`id -Gn`), gets its group step through an admin prompt too; the GUI suggests logging out and in to avoid it.
15. **Base changes only on a job that does not work.** A base change is a request (4.2): applied at once on a `queued`, `succeeded`, `not_delivered`, `stopped` or `failed` job, otherwise applied when the job reaches one of those states. The user cannot realign a `running`, `waiting` or `paused` job. A job therefore re-enters at `onBaseChanged` only after its `start` node has completed, and the recipe validator counts the ticket and the outputs of `start` as available at `onBaseChanged`.
16. **Detached processes on job stop.** Every process the engine starts for a job, agent or command, gets `PECORE_JOB_ID=<job id>` in its environment, and its children inherit it. After stopping the group, the engine kills, as the project user, every process of that user whose environment holds that exact variable (`/proc/<pid>/environ` on Linux; macOS in the macOS pass). The user's own shells and editors in the workdir lack it and survive; a process that removes the variable on purpose escapes. The `kill -KILL -1` sweep stays only for app start and quit in protected mode.

#### Phase 5 decisions

Each line closes one entry gate of phase 5 and overrides the earlier text it contradicts.

1.  **Renderer origin.** The packaged app loads the renderer from the custom scheme `app://pecore/` (Electron `protocol.handle`, registered as standard and secure), not from `file://`: a `file://` page sends `Origin: null`, which a sandboxed iframe on any website also sends. The development app loads it from the electron-vite dev server; the main process passes that origin to the engine in `PECORE_DEV_ORIGIN`, only when the app is not packaged. The renderer's Content-Security-Policy allows `connect-src` only to `http://127.0.0.1:<port>` and `ws://127.0.0.1:<port>`, so a script injected through rendered agent output cannot send the token elsewhere.
2.  **Host and Origin.** Every HTTP request and the `/live` upgrade are checked before the token. `Host` must be exactly `127.0.0.1:<port>`, which blocks DNS rebinding (a website whose name resolves to 127.0.0.1 still sends its own name as `Host`). `Origin` must be absent (the CLI and other non-browser clients; a browser always sends it on a cross-origin request and on a WebSocket) or equal to `app://pecore` or `PECORE_DEV_ORIGIN`. Any other value gives 403. The renderer's origin differs from the API's, so its requests with `Authorization` are preflighted: the server answers `OPTIONS` for an allowed origin without the token, with that origin in `Access-Control-Allow-Origin` and the headers `authorization` and `content-type`.
3.  **`/live` authentication.** A browser `WebSocket` cannot send headers. Every client opens `/live` without a token and sends `{"auth": "<token>"}` as its first message. The server sends nothing before it, and closes the socket with code 4401 when the token is wrong or does not arrive within 5 seconds. A token in the query string would end up in logs; header injection by the main process (`webRequest`) would work only for the renderer.
4.  **Typed operations.** `packages/schemas/src/api.ts` holds one table of routes: method, path, and the Zod schemas of params, query, body and response. The server registers its routes from the table and validates every input (400 with the Zod issues); tests also validate the responses. The renderer client and the CLI call routes through one typed function built from the same table, so a changed route breaks the build of both. An error body is `{error, message}`, with `error` one of `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `gone` (410), `conflict` (409), `engine_error` (500). The routes the GUI needed and the API table lacked (wizard progress, Retry and Cancel of a creation, status, first run, prerequisite recheck, usage, themes, normalised log history, on-demand merge check, play interrupted jobs) are in the API table above.
5.  **Owner of `run/api.json`.** Only the engine writes `run/api.json`: after the API listens, mode 0600, written to a temporary file and renamed. It deletes the file at shutdown. The main process gets port and token from `ready` and never reads the file. A file left by a crash points to a closed port, so the CLI prints `PeCore is not running: open the app`. When `shutdown.done` does not arrive within 15 seconds, the main process kills the engine process and exits; the next start runs the sweep of section 1 and the services sweep of 4.9.
