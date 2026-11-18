# PeCore

*   **Author:** Antonio Colagreco
*   **Status:** Draft
*   **Date:** 2026-11-17
*   **Replaces:** `docs/pecore-v0.5.md`
*   **Inputs:** `concepts_brief.md` (review findings B1-B8, M1-M16, N1-N9 and decisions D1-D27)

Naming rule: "PeCore" in prose; `pecore` for the command, packages, file names and `PECORE_HOME`.

--------------------------------------------------------------------------------

## Overview

PeCore is an open source software factory, released under the MIT license. A person gives it an order, in chat or as a ticket reference. PeCore turns the order into one or more jobs. Each job changes the code of a project and delivers the result where the project's recipe says: a pull request on GitHub, a merge request on GitLab, a pull request on Bitbucket, a push to AWS CodeCommit or a private git server, or only a branch in the local repo.

An engine written in TypeScript runs the jobs. It executes recipes. A recipe is a graph of nodes and edges. Every operation on the code or on the outside world is a node: an agent with a role, a check, a human review, a commit, a rebase, a push, a pull request. Models do the work inside agent nodes; code decides transitions, retries, limits and the order of operations.

The engine knows no programming language and no forge. Rust, Go, TypeScript or any other toolchain is supported by nodes that call that toolchain's commands. GitHub, GitLab or any other host is supported by nodes that call that host's commands or API.

Nodes start as templates in a global library. To use one, the user instantiates it: the template is copied into the project and customised. A template and its copies are not linked. The user creates and edits templates and instances by hand, or asks the AI to create, correct or modify them.

Agent nodes run the original harness programs in non-interactive mode: Claude Code (`claude -p`), Codex (`codex exec`), Antigravity CLI (`agy -p`), opencode (`opencode run`), pi (`pi -p`) and GitHub Copilot CLI (`copilot -p`). Each harness uses its own login and subscription. One job can use models from several providers.

PeCore is a desktop app built with Electron and React. The user downloads it, opens it, and it runs: no service to install, no terminal. Everything lives inside the app: the engine runs in a Node process started by the app, and every harness process is a child of it. Closing the app stops everything, including running harnesses. Every action is available in the app: chat with the orchestrator, recipe graph editor, live view of each job and node, template and instance editors, project settings, accounts and harness logins. A CLI uses the same local API while the app is open.

A project is self-contained: one directory holds its definitions, the history of its jobs, its artifacts and logs. A project can be exported and shared on its own.

PeCore runs on Linux and macOS, on one machine at a time. Today its only user is the author; later it will be published for anyone.

## The Problem

The author wants to hand off software work and get a finished result back: a fix for a bug in a web app, a feature, or a new product such as a game for Linux and macOS. He does not want to write the code, and he wants several tasks running at the same time, using models from different providers.

Existing tools do not cover this combination (facts from `docs/pecore-v0.5.md` Appendix A, not re-checked):

*   Cockpit tools (Herdr, emdash, Claude Squad, T3 Code) run several agents, but the user drives each one. There is no pipeline, no gate and no recovery after a restart.
*   Issue-to-PR services (Copilot coding agent, Codex cloud, Claude Code GitHub Action) work with one provider and one forge each, and run on the vendor's infrastructure.
*   zazencodes software-factory v2 has a pipeline, but uses one provider, lets an LLM drive the state, and has no isolation.

What none of them offers together:

1.  Several providers in one pipeline, through their original harnesses and subscriptions.
2.  A pipeline the user builds from nodes, where every step, including commit and delivery, can be customised.
3.  Checks run by code, bound to the exact content they checked.
4.  Parallel jobs across several projects, with waits on quotas and limits instead of failures.
5.  An engine with no built-in language or forge, extended by data, not by code.
6.  Everything running on the user's own machine.

## Goals

*   **G1. Order to delivered result.** An order (chat text, a link, an image, or a ticket reference) becomes one or more jobs. Each job ends with the outcome of its last node (for example an open PR, a pushed branch, a local commit), with a typed failure reason shown to the user, or because the user stopped it.
*   **G2. No built-in language.** Support for a new language or toolchain needs only new node templates, with no change to engine code. Verified by running the same recipe shape on a TypeScript project and on a Rust project, with different check nodes.
*   **G3. No built-in forge.** Support for a new delivery target needs only new node templates. Verified by delivering the same job to GitHub, to GitLab, and to the local repo only, changing only the delivery nodes.
*   **G4. Every operation is a node.** Agents, checks, human reviews, commit, rebase, push and PR/MR are nodes. A recipe can put a human review before the commit node. The engine handles only workdirs and job branches: it creates them when a job needs them, removes workdirs when the job completes (or, for a failed or stopped job, when it is archived or deleted) and branches when the job is deleted.
*   **G5. Templates and instances.** Node and recipe definitions are JSON files validated by JSON Schema. Both nodes and recipes have templates in a global library and instances in the project. The user can create a template or an instance by hand or by asking the AI in chat; the AI can also correct or modify existing ones. A new or changed file passes schema validation and is usable at once.
*   **G6. Several providers at once.** One job can run agents from at least three different harnesses (for example Claude Code builder, Codex reviewer, opencode with a DeepSeek model for tests).
*   **G7. Parallel jobs with waits, not failures.** The number of parallel jobs and agents is configuration. A job that hits a quota, rate limit, concurrency limit or budget limit enters a visible waiting state with a typed reason, and resumes when the limit clears. It does not fail for that reason.
*   **G8. Atomic projects.** A project is one directory: project settings, node and recipe instances, knowledge base, its own SQLite database with the history of its jobs, artifacts and logs. `pecore project export` produces an archive another user can import; it contains no secrets, no repo clone and no workdirs. A project points to at most one remote repo and one account for it, and runs its agents as one OS user. If the remote repo does not exist, PeCore creates it automatically with the project's account.
*   **G9. Stacked jobs.** An order larger than one ticket becomes a set of tickets with dependencies. A child ticket starts from its parent's last commit when the parent job completes, without waiting for the parent's merge. When the parent changes, the recipe's rebase node realigns the child, and the recipe decides which nodes run again.
*   **G10. No secrets kept by PeCore.** Each tool keeps its own login: harnesses (`claude`, `codex`, `agy`, ...), forge CLIs (`gh`, `glab`, AWS CLI) and git credential helpers. PeCore stores only references to those accounts. When a project uses a dedicated OS user, agents cannot read the app user's home, where forge logins live.
*   **G11. Rules live in recipes.** Checks, reviewers, approvals, what runs again after a rebase, providers, tiers and budget limits are recipe or project configuration. The empty recipe is valid: the job opens and closes.
*   **G12. Crash safety.** After a crash, or after the app is closed during a delivery, no job delivers twice, and no job is lost. Nodes that act on the outside world declare a probe command that tells whether the action already happened. Verified by killing the engine during each delivery node in a test.
*   **G13. Diagnosis in under a minute.** For any job, the user can see in the GUI or the CLI which node is running, why the job waits, and open the raw harness log, in under one minute.
*   **G14. Installable by others.** On a fresh Linux or macOS machine, a guided first run in the GUI (or `pecore init`) checks prerequisites, creates `PECORE_HOME`, adds accounts and creates the first project, without editing files by hand.
*   **G15. Pluggable services runtime.** The container runtime for job services (Postgres, Kafka) is a setting: Podman, Docker, or on macOS Podman machine, Colima, OrbStack or Apple `container`.
*   **G16. GUI first.** Every feature is usable from the React GUI without the terminal: chat, recipe graph editor with drag and drop, live job graph with node state and logs one click away, template and instance editors with AI assistance, settings, account and harness logins. Harness logins for a project's OS user run from the GUI, which shows the harness's login URL or code.
*   **G17. Job controls.** Global pause and play. Per job: stop, pause, play, archive, delete. Stop and closing the app kill all running processes at once. Pause waits for running nodes to finish, then holds. On app start, interrupted jobs are paused until the user presses play. Delete is allowed only on a job in a final state (completed, failed or stopped) and removes everything: workdirs, artifacts, logs, local and remote branch, open PR/MR, and the job's history; the project itself is untouched. Archive hides a job in a final state and keeps its history, branches and PR/MR. Remote cleanup runs through a cleanup command declared by the delivery node.

## Non-Goals

*   **Automatic merge.** A job delivers; a human merges (D2). Auto-merge returns in a later design.
*   **Windows**, as host or as product target. **iOS, Android and console** targets.
*   **Deploy** to any environment.
*   **Agents in containers.** Agents run on the host as an OS user (D9). Containers are used only for services a job's tests need (Postgres, Kafka).
*   **Network control per node.** Agents have the network access of their OS user.
*   **Link between a template and its instances.** Changing a template never changes an existing instance.
*   **Checking the behaviour of new nodes** beyond schema validation.
*   **Several machines** running the same `PECORE_HOME` at the same time.
*   **Several human users** on one app, or a hosted service.
*   **A message broker.** Events live in SQLite.

## Open Questions

*   **Copilot CLI** model discovery and effort flags; **opencode** effort flags (v0.5 Q9, Q13).
*   **Notification channel** outside the app (v0.5 Q2).
*   **Telemetry retention** defaults (v0.5 Q11).

## Critical User Journeys (CUJs)

### CUJ 1: Bug fix from a GitHub issue

*   **Given**: project `progetto-1` points to `github.com/pappa/pippo` with account `account-1` and OS user `pecore-progetto-1`. Its `bugfix` recipe uses instances of check templates for the project's toolchain and the nodes `git-commit`, `git-push`, `github-pr` and `github-issue-comment`. An issue labelled `factory` exists.
*   **When**: the user tells the orchestrator "fix issue 42 of progetto-1".
*   **Then**: the orchestrator reads the issue, picks recipe `bugfix`, and starts a job. The engine creates a workdir and branch. The spec writer writes acceptance criteria; the tests node writes a failing test; the builder fixes the code; checks pass on the workdir content; the code reviewer approves; the user approves in the human review node; `git-commit` saves; `git-push` pushes the branch with `account-1`; `github-pr` opens a PR; `github-issue-comment` posts the PR link on the issue. The engine removes the workdir.

### CUJ 2: New game from a chat order

*   **Given**: project `progetto-3` is set to `gitlab.com/ciccio/pimpo` with `account-3`; the remote repo does not exist yet. Its recipes deliver through a `gitlab-mr` node.
*   **When**: the user writes "make a 2D platform game for Linux and macOS".
*   **Then**: the orchestrator asks clarifying questions, then produces tickets with dependencies (scaffold, game loop, player movement, levels, menu, packaging). The scaffold job starts first; its recipe begins with a `gitlab-create-repo` node that creates the remote repo with `account-3`. Each child job starts from its parent's branch as soon as the parent's job ends. Each MR targets its parent's branch. When a parent changes, its children run the recipe's rebase node and then the nodes the recipe lists for that case.

### CUJ 3: New check for Rust, created with AI

*   **Given**: a Rust project with no node for `clippy`.
*   **When**: the user asks the orchestrator "create a check that runs clippy with warnings as errors, and add it to my Rust project".
*   **Then**: the orchestrator writes a `cargo-clippy` template to the global library, instantiates it into the project, and adds it to the project's recipe. The engine validates all three files. The next job uses the new node.

### CUJ 4: Local-only project

*   **Given**: project `prova` has no remote repo. Its recipe ends with a `commit` node and no delivery node.
*   **When**: the user gives an order for `prova`.
*   **Then**: the job ends with a commit on branch `factory/<job>` in the project's local repo. Nothing leaves the machine except model API calls.

### CUJ 5: Quota runs out during a job

*   **Given**: three jobs run in parallel; two use the same Claude subscription.
*   **When**: the harness reports a quota or rate limit error.
*   **Then**: the affected node runs enter state `waiting` with reason `quota` and the reset time if known. Their slots are released. `pecore job why <id>` shows the reason. When the reset time passes, the nodes start a new attempt. No job fails because of the limit.

### CUJ 6: New project with a dedicated OS user

*   **Given**: PeCore is installed; account `account-1` and a Claude subscription exist.
*   **When**: the user creates a project, enters the repo URL, picks `account-1`, and in the OS user dropdown picks "create new user".
*   **Then**: the system shows one admin permission prompt. PeCore creates `pecore-<project>`, installs a sudo rule that lets the engine run processes only as that user, creates the project directory, clones the repo, and walks the user through each harness login for that user in the GUI. If the automatic path fails, a guided procedure shows the exact commands to run.

### CUJ 7: Share one project

*   **Given**: project `progetto-1` with its instances, knowledge base and job history.
*   **When**: the user exports the project from the GUI (or `pecore project export progetto-1`), and another user imports the archive.
*   **Then**: the other user gets the project with its node and recipe instances and knowledge base, and history if it was included. No secrets, clone or workdirs are in the archive. At import, the other user maps `account-1` to one of their own accounts, picks an OS user, and confirms the commands of nodes that run as the app user (section 8).

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

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
│                        source adapters (read tickets, write comments)         │
│                        accounts (references to tools' own logins)             │
│        │                                                                      │
│        ├── harness processes   claude -p, codex exec, ... run as the          │
│        │                       project's OS user, one process group each      │
│        ├── command processes   check, commit, rebase nodes: project OS user   │
│        │                       push, PR/MR nodes: app user, with the          │
│        │                       account the node declares                      │
│        └── service containers  Postgres, Kafka for a job's tests, through     │
│                                the runtime set in settings                    │
└───────────────────────────────────────────────────────────────────────────────┘
        ▲
        │ same local API, only while the app is open
     pecore CLI
```

*   The engine runs in a separate Node process so that long work never blocks the window. It is a child of the app: closing the app ends it.
*   Every process the engine starts gets its own process group. Stop and app close send `SIGTERM` to every group, then `SIGKILL` after 5 seconds.
*   The local API listens only on `127.0.0.1`, requires the token stored in `PECORE_HOME/run/api-token` (permissions 0600), and checks `Origin` and `Host`. The renderer and the CLI use the same API.

### 2. Files and databases

Rule: files describe what exists; SQLite records what happened.

```text
$PECORE_HOME/                         default ~/.pecore; git repo for definitions
  settings.json                       limits, services runtime, project paths, UI prefs
  accounts.json                       model, forge and service accounts (references, no secrets)
  profiles.json                       agent profiles: harness + model + effort + account
  tiers.json                          tiers: ordered lists of profiles
  chats.db                            orchestrator conversations (SQLite)
  library/
    nodes/<template>.json             node templates
    nodes/<template>.md               prompt template, for agent node templates
    recipes/<template>.json           recipe templates
  projects/<project-id>/              one atomic project (path can be moved in settings)
    project.json                      repo, account, OS user, services, limits
    nodes/<instance>.json             node instances (copied from templates, customised)
    nodes/<instance>.md
    recipes/<instance>.json           recipe instances
    knowledge/**.md                   knowledge base
    pecore.db                         events and views of this project's jobs (SQLite)
    telemetry.db                      spans and log index; can be deleted
    repo.git/                         bare repo: clone of the remote, or local only
    work/<job-id>/                    workdir of a job (git worktree)
    work/<job-id>-<subtask>/          workdir of a subtask
    artifacts/<job-id>/<run-id>/      prompt sent, output, diff, check log
    logs/<attempt-id>.jsonl.zst       raw harness output
  run/                                local to this machine: api-token, lock file,
                                      credentials.json (see 3.4)
```

*   All definition files are JSON validated by JSON Schema generated from Zod. Each file starts with `"$schema"` pointing to a schema file shipped with the app, so editors show field descriptions.
*   `PECORE_HOME` is a git repository. It tracks settings, accounts, profiles, tiers, the library and each project's `project.json`, `nodes/`, `recipes/` and `knowledge/`. It ignores databases, `repo.git`, `work/`, `artifacts/`, `logs/` and `run/`. Every save from the GUI or the orchestrator is one commit with a readable message.
*   A project stores everything about itself under its directory. Global files hold only what belongs to the user: accounts, profiles, tiers, templates and chats.
*   `pecore.db` runs in WAL mode. Every engine operation writes its events and updates the views in one transaction on that one file. No transaction spans two files.
*   When a project is created and its remote does not exist yet, `repo.git` starts as an empty local repository with one empty initial commit. A repo creation node (for example `gitlab-create-repo`) creates the remote later and sets it as `origin`.

### 3. Definitions

#### 3.1 Node template and instance

A node template and a node instance use the same schema. An instance is a copy of a template saved in a project, with its values customised. The instance keeps no reference to the template.

Fields common to every node:

| Field | Meaning |
|---|---|
| `name` | unique in its library or project |
| `description` | what the node does; the orchestrator reads it to pick and build recipes |
| `kind` | `agent`, `command` or `human` |
| `params` | JSON Schema of the values a recipe can set |
| `inputs` | artifact types the node reads (see 3.3) |
| `outputs` | artifact types the node writes |
| `outcomes` | the outcome names the node can produce |
| `changesFiles` | `true` if the node may modify the workdir; `false` makes it read-only (see 4.4) |
| `scratchPaths` | glob patterns of files the node may create and that are thrown away after it (for example `coverage/**`, `**/*.tmp`); default empty |
| `timeoutSec` | hard time limit for one attempt |
| `retry` | extra attempts after a process failure (not after a `failed` outcome), default 1 |

Fields by kind:

*   **`command`**
    *   `runsAs`: `project-user` (default) or `engine`. `engine` runs the command as the app user, where forge and service logins live.
    *   `command`: an argument array, run without a shell; placeholders are substituted into single arguments. `shell: true` allows a shell string; then placeholders are not substituted into the string but passed as environment variables named after the placeholder in upper case with dots as underscores (`{job.branch}` becomes `PECORE_JOB_BRANCH`), so ticket text can never become shell code.
    *   `credentials`: only for `runsAs: engine`; names of accounts the node uses. The engine selects that account in the tool through environment variables (for example `GH_TOKEN` from `gh auth token --user <login>`, `GITLAB_HOST`, `AWS_PROFILE`).
    *   `outcomeRules`: how the outcome is computed: by exit code, or by a field of JSON printed on stdout.
    *   `outputRules`: how outputs are read: a file path, or a field of JSON on stdout.
    *   `probe`: for nodes that act outside the machine; a command that reports whether the action already happened (see 4.8).
    *   `probeRules`: how the probe result is read. Default: exit code 0 and non-empty stdout means `done`, and stdout is read with `outputRules`; exit code 0 and empty stdout means `not_done`; any other exit code means `unknown`. A rule can instead read a JSON field on stdout, mapping its values to `done` and `not_done`.
    *   `cleanup`: for delivery nodes; a command that undoes the delivery when the job is deleted (close the PR/MR, delete the remote branch).
*   **`agent`**
    *   `prompt`: path of the Markdown prompt template.
    *   `agent`: `tier` (for example `strong`) or an ordered list of `profiles`; optional `providerNot`, a list of recipe node ids whose provider this node must not use.
    *   `outputSchema`: JSON Schema of the structured output the harness must return; it contains a field `outcome` whose value must be one of `outcomes`.
    *   `knowledge`: glob patterns of knowledge base files the node receives.
    *   `services`: external service tools the node may call through the engine (for example `jira.read`).
    *   `resume`: `true` to resume the harness session when the node runs again in the same job.
*   **`human`**
    *   `show`: artifact types to display (summary, diff, check logs).
    *   The outcomes are the buttons the user sees (for example `approve`, `changes`, `reject`).
    *   `answer`: whether the user can attach text, which becomes an artifact for the next node.

Placeholders in `command`, `probe`, `cleanup` and prompts are plain substitution with no logic: `{params.<name>}`, `{job.id}`, `{job.title}`, `{job.branch}`, `{job.base}` (commit the job must be based on now), `{job.oldBase}` (commit the job branch was last based on), `{job.target}` (branch the delivery targets, see 4.6), `{workdir}`, `{project.repoDir}`, `{project.repo.url}`, `{project.repo.owner}`, `{project.repo.name}`, `{inputs.<type>.path}`.

Example instance of a delivery node. It runs after a `git-push` node, which pushes the job branch from `repo.git`:

```json
{
  "$schema": "pecore://schemas/node.json",
  "name": "github-pr",
  "description": "Open a pull request on GitHub for the pushed job branch, or move an existing one to the job's target branch",
  "kind": "command",
  "runsAs": "engine",
  "credentials": ["project.account"],
  "inputs": ["commit", "spec"],
  "outputs": ["delivery"],
  "outcomes": ["opened", "failed"],
  "changesFiles": false,
  "shell": true,
  "command": "repo=\"$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME\"; url=$(gh pr list --repo \"$repo\" --head \"$PECORE_JOB_BRANCH\" --json url --jq '.[0].url'); if [ -n \"$url\" ]; then gh pr edit \"$url\" --base \"$PECORE_JOB_TARGET\" >/dev/null && echo \"$url\"; else gh pr create --repo \"$repo\" --base \"$PECORE_JOB_TARGET\" --head \"$PECORE_JOB_BRANCH\" --title \"$PECORE_JOB_TITLE\" --body-file \"$PECORE_INPUTS_SPEC_PATH\"; fi",
  "outcomeRules": [{ "exitCode": 0, "outcome": "opened" }, { "exitCode": "other", "outcome": "failed" }],
  "outputRules": { "delivery": { "stdoutLastLine": "url" } },
  "probe": ["gh", "pr", "list", "--repo", "{project.repo.owner}/{project.repo.name}", "--head", "{job.branch}", "--base", "{job.target}", "--json", "url", "--jq", ".[0].url"],
  "cleanup": ["gh", "pr", "close", "{job.branch}", "--repo", "{project.repo.owner}/{project.repo.name}", "--delete-branch"],
  "timeoutSec": 120
}
```

#### 3.2 Recipe template and instance

A recipe is a graph. Recipe templates live in the library; a project uses recipe instances, which reference only node instances of the same project.

```json
{
  "$schema": "pecore://schemas/recipe.json",
  "name": "feature",
  "description": "New feature on existing code: spec, tests, code, checks, review, commit, PR",
  "start": "spec",
  "onBaseChanged": "rebase",
  "maxNodeRuns": 60,
  "nodes": {
    "spec":    { "use": "spec-writer" },
    "tests":   { "use": "tests-writer", "perSubtask": true },
    "tests-check": { "use": "typecheck", "perSubtask": true },
    "code":    { "use": "builder", "perSubtask": true },
    "merge":   { "use": "subtask-merge" },
    "lint":    { "use": "eslint" },
    "types":   { "use": "typecheck" },
    "test":    { "use": "vitest", "params": { "suite": "unit" } },
    "review":  { "use": "code-reviewer", "agent": { "providerNot": ["code"] } },
    "approve": { "use": "approver" },
    "human":   { "use": "human-review" },
    "commit":  { "use": "git-commit", "requires": ["lint", "types", "test"] },
    "rebase":  { "use": "git-rebase" },
    "push":    { "use": "git-push" },
    "pr":      { "use": "github-pr" }
  },
  "edges": [
    { "from": "spec",    "on": "accepted",  "to": "tests" },
    { "from": "tests",   "on": "done",      "to": "tests-check" },
    { "from": "tests-check", "on": "failed", "to": "tests", "maxRounds": 3 },
    { "from": "tests-check", "on": "passed", "to": "code" },
    { "from": "code",    "on": "done",      "to": "merge" },
    { "from": "code",    "on": "tests_disputed", "to": "tests", "maxRounds": 2 },
    { "from": "merge",   "on": "clean",     "to": "lint" },
    { "from": "merge",   "on": "conflict",  "to": "code", "maxRounds": 2 },
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
    { "from": "push",    "on": "pushed",    "to": "pr" },
    { "from": "rebase",  "on": "clean",     "to": "lint" },
    { "from": "rebase",  "on": "conflict",  "to": "code" }
  ]
}
```

*   `use` names a node instance in the project. A recipe node can override `params` and `agent`.
*   `perSubtask: true` runs the node once per subtask (see 4.5).
*   `requires` lists nodes whose latest outcome must be `passed` on the current workdir content (see 4.4).
*   `onBaseChanged` names the node the job re-enters when its base branch moves (D17). The `git-rebase` template stashes uncommitted changes, runs `git rebase --onto {job.base} {job.oldBase}` and restores the changes. `--onto` moves only the job's own commits: if the parent was squash-merged, the parent's original commits are not replayed on top of their squashed copy; a conflict at any step gives the outcome `conflict`.
*   After a rebase the job runs again through `commit`, `push` and `pr`. `git-commit` with nothing new to save ends with `done` on the current commit; `github-pr` finds the existing PR through its probe and does not open a second one (see 4.8).
*   The spec lists the interfaces (function names and signatures). The tests node writes the tests and stubs of those interfaces that throw "not implemented". The `tests-check` node then runs the type checker: it passes when tests and stubs are valid, while the tests still fail when run. Failures go back to the tests node. The builder fills the stubs and never edits tests. This closes the loop found in review (M2): the builder never receives errors in tests it cannot change.
*   `human: reject` has no edge, so it ends the job (see 4.2).

#### 3.3 Artifacts

Nodes pass files, not conversations. An artifact has a type, a path under `artifacts/<job-id>/<run-id>/`, a SHA-256 hash and the content state it refers to.

| Type | Written by (default templates) | Content |
|---|---|---|
| `ticket` | engine at job creation | the work item text and attachments, marked as untrusted data |
| `spec` | spec writer | acceptance criteria, what tests must check, interfaces, subtasks, optional nodes to run |
| `findings` | reviewers | verdict, findings with file, line and severity |
| `risk` | approver | each hunk classified `safe` or `risky`, with reason |
| `check-log` | command nodes | stdout and stderr of the last run |
| `diff` | engine after any node with `changesFiles: true` | diff of the workdir against the job base |
| `user-note` | human nodes | text written by the user |
| `commit` | commit node | commit SHA |
| `delivery` | delivery nodes | URL or reference of the PR, MR or pushed branch |

A node receives the latest artifact of each type in its `inputs`. The recipe validator rejects a recipe in which a node needs an input type that no node before it can produce.

#### 3.4 Accounts, profiles and tiers

*   PeCore keeps no secrets of its own. Each tool stores its login where it always does; `accounts.json` holds only references.
*   `accounts.json` lists accounts of three kinds:
    *   `model`: provider, harness, login type (`subscription` or `api-key`, both configured inside the harness), `maxParallel`.
    *   `forge`: forge type, host, tool (`gh`, `glab`, `aws`, `git`), the tool's account name (for example the `gh` login, the AWS profile), commit author.
    *   `service`: external service (for example Atlassian), the tool or MCP server that holds its login, the account name.
*   Exception: a credential that no tool stores (for example the private key of a GitHub App, or a Jira API token with no CLI) is encrypted with Electron `safeStorage`, whose key is held by the OS keychain, and saved in `run/credentials.json` (permissions 0600). On Linux without a running keychain, `safeStorage` cannot protect it; the file is still readable only by the app user, and the GUI shows a warning.
*   `profiles.json` defines agent profiles: harness, model, effort, model account, timeout.
*   `tiers.json` maps the four tier names (`frontier`, `strong`, `standard`, `cheap`) to ordered lists of profiles. The first profile that is available and satisfies the node's constraints wins; later profiles are backups used only when earlier ones are unavailable (quota, rate limit, harness error).
*   Recipes refer to tiers, not profiles, unless the user chooses otherwise. Tier names are the same on every machine, so a shared recipe works after import.

#### 3.5 Projects

`project.json`:

| Field | Meaning |
|---|---|
| `id`, `name` | identity |
| `repo` | `url` of the remote, or `null` for a local-only project; `account` from `accounts.json` |
| `baseBranch` | branch new jobs start from and deliver to, for example `dev` or a feature branch; the orchestrator or the user can set another one per job |
| `osUser` | the OS user agents run as: the app user (marked risky in the GUI) or a dedicated user |
| `defaultRecipe` | recipe instance used when the orchestrator has no better match |
| `services` | path of a compose file for job services, relative to the repo |
| `limits` | parallel jobs for this project, budget per job and per day |
| `source` | where tickets come from (for example GitHub Issues with label `factory`) and its account |

### 4. Engine

#### 4.1 Job states

```text
queued ──▶ running ◀──▶ waiting
              │ ▲
              ▼ │
            paused
              │
              ▼
   completed | failed | stopped        (final: can be archived or deleted)
       │
       └──▶ running                    only on a base change (4.6)
```

| State | Meaning |
|---|---|
| `queued` | created, waiting for a parent job (stacked) or for the scheduler |
| `running` | at least one node run is running |
| `waiting` | no node runs; at least one waits for a limit or a human; the reason is shown |
| `paused` | the user paused it, globally or per job, or the app was closed while it ran |
| `completed` | ended on an outcome with no edge, from a node that did not fail; a base change can move it back to `running` |
| `failed` | a node failed beyond its retries, or the job hit `maxNodeRuns` and the user chose to end it |
| `stopped` | the user pressed stop |

Pause waits for running node runs to finish, then holds. Play moves a paused job back to `running` or `waiting`. On app start every job that was `running` or `waiting` is `paused`.

#### 4.2 Graph rules

*   **Start**: the job runs `start` first.
*   **Edges**: when a node run ends with an outcome, every edge `from` that node `on` that outcome activates its target. Several edges on the same outcome start their targets in parallel.
*   **No edge**: an outcome with no edge ends the job as `completed`, with that node and outcome recorded (for example `pr:opened`, `human:reject`, `spec:rejected`).
*   **Join**: a node with several incoming edges starts when every node that was activated in the same step and has an edge to it has ended. A node that was skipped (optional and not chosen) counts as ended.
*   **Diverging back edges**: if parallel nodes produce outcomes that lead to different earlier nodes, the edge listed first in the file wins; its target receives the artifacts of all of them.
*   **Rounds**: an edge with `maxRounds: n` can send the job back to its target at most `n` times. A job-wide `maxNodeRuns` caps the total number of node runs. When a cap blocks an edge, the job enters `waiting` with reason `round_limit` and asks the user: allow more rounds, or end the job as `failed`.
*   **Optional nodes**: a recipe node with `optional: true` runs only if the `spec` artifact names it; otherwise it is skipped.
*   **Base change**: when the job's base branch moves (a parent job changed, or the user asks to realign on the job's base branch), the job re-enters at `onBaseChanged` after its running nodes end. If the recipe has no `onBaseChanged`, the job only shows that its base moved.

#### 4.3 Node run states

```text
pending ──▶ waiting(reason) ──▶ running ──▶ completed(outcome)
                  ▲                │
                  └────────────────┤        quota or rate limit: the attempt ends,
                                   │        the node run waits for a new attempt
                                   ├──▶ failed(reason)     process error after retries
                                   ├──▶ interrupted        stop, app close
                                   └──▶ skipped            optional node not chosen
```

Waiting reasons: `concurrency`, `quota`, `rate_limit`, `budget`, `human`, `parent_job`, `services`. Failure reasons: `HARNESS_ERROR`, `AUTH_ERROR`, `TIMEOUT`, `INVALID_OUTPUT`, `READ_ONLY_VIOLATION`, `PROCESS_KILLED`, `COMMAND_NOT_FOUND`, `PROBE_ERROR`, `ENGINE_NODE_NOT_CONFIRMED`.

#### 4.4 Content state and evidence

*   After every node run with `changesFiles: true`, the engine computes the workdir's **content state**: the git tree hash of all tracked and untracked files, built with a temporary index so the worktree's index is never touched. Files ignored by git and the `.pecore/` folder are not part of it.
*   Every node run records the content state before and after it. Every check result is bound to the content state it saw.
*   `requires` on a recipe node is checked against the current content state. If one of the listed nodes has not `passed` on that exact state, the node does not run and produces the built-in outcome `stale`, which the recipe can route (for example back to the checks).
*   After every node run, the engine deletes new files that match the node's `scratchPaths`, before computing the content state.
*   A node with `changesFiles: false` must leave the content state unchanged. If it changed, the engine restores the previous state and fails the run with `READ_ONLY_VIOLATION`. Test output such as coverage reports therefore needs to be in `.gitignore` or in `scratchPaths`.
*   When a node run is interrupted, its workdir is restored to the content state before the run, so a new attempt starts clean.

#### 4.5 Workdirs, branches and subtasks

*   At job start the engine creates branch `factory/<job-id>` from the job base (the job's base branch, by default the project's `baseBranch`, or the parent job's last commit for stacked jobs) and a worktree under `work/<job-id>/`. The worktree is owned by the project's OS user.
*   `repo.git` is shared with the project's OS user through a group (`core.sharedRepository=group`), because commits made in a worktree write objects into it. Engine operations that write in a workdir (restoring a content state, creating a subtask worktree) run as the project's OS user; engine git commands that only read a workdir use `-c safe.directory=<workdir>`.
*   A node with `perSubtask: true` runs once per subtask listed in the `spec` artifact. Each subtask gets branch `factory/<job-id>/<n>` and worktree `work/<job-id>-<n>/`, created from the same content state. Subtasks run in parallel within the limits.
*   An edge between two `perSubtask` nodes connects the same subtask. An edge from a `perSubtask` node to a normal node waits for every subtask (join).
*   A subtask merge is a node (template `subtask-merge`): it merges the subtask branches into the job branch and has outcomes `clean` and `conflict`. After it, a back edge into a `perSubtask` node runs that node once, in the job workdir.
*   If the `spec` lists no subtasks, `perSubtask` nodes run once in the job workdir and `subtask-merge` ends at once with `clean`.
*   Node-run ids include the subtask: `<job-id>/<node>#<round>` or `<job-id>/<node>/<n>#<round>`.
*   When a job completes, the engine removes its worktrees. When a job fails or is stopped, its worktrees stay, so the user can see what the agents left; they are removed when the job is archived or deleted. Branches stay until the job is deleted.

#### 4.6 Stacked jobs

*   A job can have a `parentJobId`. It stays `queued` with waiting reason `parent_job` until the parent job ends as `completed`.
*   Its base is the last commit on the parent's branch. The recipe validator rejects a parent recipe that has no commit node.
*   When the parent's branch changes later, the engine records `job.base_changed` for every child and applies the base change rule (4.2).
*   `{job.target}` is the parent job's branch while the parent is not merged, so the child's PR or MR shows only the child's changes. For a job with no parent it is the job's base branch.
*   After the parent is merged, the user (or the orchestrator) realigns the child onto the job's base branch. The engine sets `{job.target}` to that branch and records `job.base_changed`; the rebase node runs, and the delivery node moves the existing PR or MR to the new target (`gh pr edit --base` in `github-pr`).
*   The orchestrator creates a set of stacked jobs from one order through the tool `create_jobs`, which takes tickets with `dependsOn`.

#### 4.7 Scheduler and limits

*   Limits are counters held in memory, organised in pools: `jobs` (global), `jobs:<project>`, `agents` (global), `provider:<name>`, `account:<id>` (from `maxParallel`). A node run takes one unit from every pool that applies, all at once, or waits with reason `concurrency`.
*   After an app restart the counters start at zero, because closing the app killed every process.
*   When a harness reports a quota or rate limit error, the engine marks the account as cooling down until the reset time the harness reported, or for a backoff of 1, 2, 4, then 8 minutes if no time is known. All node runs on that account wait with reason `quota` or `rate_limit`. A node whose tier has another available profile switches to it as a new attempt.
*   Budget: each attempt records tokens and cost. For API key accounts cost comes from the token counts and a price table in settings; for subscriptions only tokens are recorded. When a project or job budget limit is reached, node runs wait with reason `budget` and the user is asked to raise the limit or stop the job.

#### 4.8 External effects and crash safety

*   A node that acts outside the machine (push, PR/MR, ticket comment, repo creation) is recorded in two steps: `effect.requested` before the command runs, `effect.completed` or `effect.failed` after.
*   Before running a node that has a `probe`, the engine always runs the probe first and reads it with `probeRules`. `done`: the node completes with the probe output and its command does not run. `not_done`: the command runs. `unknown` (for example the forge is unreachable): the probe is retried with the backoff of 4.7; after the node's `retry` count the node run fails with `PROBE_ERROR`, and the command never runs blind. This covers both a crash between `effect.requested` and its outcome, and a node that runs again after a rebase.
*   Delete runs the `cleanup` command of every delivery node that completed in the job, then removes the job's branches, worktrees, artifacts, logs and rows in `pecore.db` and `telemetry.db`.

### 5. Agents and harnesses

*   Each harness has a manifest (JSON, shipped with the app, editable): version command and tested range, run command template, event mapping from its JSON stream to normalised events, structured output flag, resume flag, model discovery command, effort values, login command.
*   Built-in manifests: Claude Code, Codex, Antigravity CLI, opencode, pi, Copilot CLI. A new harness needs only a manifest if its output fits the generic mapping (levels L0 to L2 of v0.5 §10).
*   The engine runs a harness as the project's OS user (`sudo -n -u <user> -- env TRACEPARENT=... <harness> ...`, with a sudo rule limited to that user), in the node's workdir. The harness uses its own login stored in that user's home; the engine passes only model, effort and `TRACEPARENT`.
*   The engine writes the prompt to `artifacts/.../prompt.md` and a copy into the workdir's `.pecore/`, readable by the agent. Selected knowledge files are copied into `.pecore/context/`. `.pecore/` is listed in `repo.git/info/exclude`, so it is never committed.
*   Success needs the exit code and a valid structured output; exit code 0 without it is `INVALID_OUTPUT`.
*   Harness logins: the GUI runs each harness's login command as the project's OS user and shows its URL or code.

### 6. Orchestrator

*   The orchestrator is an agent run through a harness, like any agent node, with a profile chosen in settings. It runs in an empty directory as the OS user chosen in settings; the default is a dedicated user, because it reads untrusted tickets and links.
*   It reaches PeCore only through an MCP server provided by the engine, with its own token, generated at app start and passed to the orchestrator's harness in the MCP server configuration. That token reaches only the tools below. It cannot choose the outcome of a human node, confirm a `runsAs: engine` node, change settings, or stop or delete jobs: those need the user token of the GUI and CLI. Tools: `list_projects`, `list_recipes`, `read_ticket`, `create_jobs` (with `dependsOn` and an optional `baseBranch` per job), `job_status`, `answer_question`, `list_templates`, `write_template`, `instantiate`, `write_instance`, `validate`.
*   `write_*` tools validate the file before saving and return the validation errors; a saved file is committed to `PECORE_HOME`.
*   Chats are stored in `chats.db`. Attachments are stored as files next to it.

### 7. Sources

*   A source has four operations: list new tickets, read a ticket, post a comment, read replies.
*   Source adapters ship with the app for GitHub Issues, GitLab Issues, a local folder of Markdown files and Jira. They are used by the orchestrator tools and by the engine; agents never hold their credentials.
*   Writing back to a ticket at the end of a job is a node (for example template `github-issue-comment`).

### 8. Security

*   Agents run as the project's OS user. With a dedicated user, they cannot read the app user's files, if those files are not readable by others.
*   The project directory is owned by the app user. Only `work/` and `repo.git/` are writable by the project's OS user (shared group); `knowledge/`, databases, artifacts and logs are not readable by it.
*   Inside `repo.git/`, only `objects/`, `refs/`, `logs/`, `worktrees/` and `packed-refs` are group-writable. `config`, `hooks/` and `info/` belong to the app user and are read-only for the group. Otherwise an agent could add a hook or a config key such as `core.fsmonitor` or `core.sshCommand`, and the next git command run as the app user (for example in `git-push`) would execute it. As a second barrier, every git command the engine or a `runsAs: engine` node runs gets `-c core.hooksPath=/dev/null`. `extensions.worktreeConfig` stays off, so per-worktree config files are ignored.
*   The project's OS user gets traverse-only access (execute, no read) on the directories on the path to `work/`, through ACLs (`setfacl` on Linux, `chmod +a` on macOS). It can reach `work/` but cannot list the app user's home.
*   At project creation and at every app start, PeCore checks that the app user's home and the tools' login files are not readable by others, and offers to fix the permissions.
*   Harness logins (subscriptions and API keys) live in the project OS user's home, stored by each harness. An agent can read the login of the harness it runs in.
*   Forge and service logins live in the app user's home, stored by their tools. Only `command` nodes with `runsAs: engine` run as the app user, and the engine selects only the accounts they declare.
*   A project that runs agents as the app user gives agents access to every login of the app user. The GUI marks this choice as risky.
*   Whoever can write a `runsAs: engine` node can run any command as the app user. So the user must confirm every such node before it runs: when it is created or changed by AI or by hand, when a template is instantiated, and when a project is imported. The GUI shows its command, `probe`, `cleanup` and `credentials`. The engine stores the hash of the confirmed definition in `pecore.db` and refuses to run a node whose hash differs (`ENGINE_NODE_NOT_CONFIRMED`), so a file edited outside the GUI also needs a new confirmation.
*   Ticket text, links, images and repo content are data. Prompts mark them as untrusted input.

### 9. Observability

*   `pecore.db` holds the job views: `jobs`, `node_runs` (with state, waiting reason, content states), `attempts` (profile, harness version, model, tokens, cost, log path), `human_queue`, `effects`, `usage_daily`.
*   `telemetry.db` holds spans (job, node run, attempt, tool call) with W3C trace ids, and an index into the raw logs. Deleting it loses detail, not state.
*   The GUI shows the job graph with each node's state, round, waiting reason, duration, tokens and cost. One click opens the node's attempts, artifacts and raw log. `pecore job why <id>` prints the same blocking reasons.
*   Notifications: job finished, job needs the user, budget reached, harness login expired. Native notifications through Electron, with sounds and a night mode.

### 10. Stack

| Area | Choice |
|---|---|
| App shell | Electron, packaged as AppImage and deb (Linux) and dmg (macOS), with auto-update |
| UI | React, Vite; React Flow for the recipe and job graph |
| Engine | Node.js (the version bundled with Electron), TypeScript strict |
| Local API | Fastify with WebSocket |
| Schemas | Zod, with JSON Schema generated for every definition file |
| SQLite | `better-sqlite3`, rebuilt for Electron |
| Ids | ULID |
| Credentials | none stored by PeCore; tools keep their own logins; Electron `safeStorage` for the exceptions |
| Tests | Vitest, fast-check for graph rules |
| Monorepo | pnpm workspace |

## Alternatives Considered

### Scope

*   **A reduced first version.** Rejected (D1). The goal is the whole product; phases only set the build order.
*   **Automatic merge by an approver agent.** Deferred (D2). It needs acceptance evidence that can be trusted. Until then every job ends with an open PR or MR and the author merges.
*   **Windows support.** Rejected (D5). Linux and macOS only, for hosts and for product targets.

### Running agents

*   **Agent SDKs or direct API calls instead of the vendor harnesses.** Rejected (D4). Subscriptions work only through the vendor harnesses (Claude Code, Codex, Gemini CLI and others), and those harnesses already handle tools, files and context.
*   **A container per agent, with runner images and a token proxy.** Rejected (D9). Logins, file permissions and network setup inside containers add a large amount of work. PeCore runs agents on the host as an OS user chosen per project. Lost: network limits per node. Containers remain only for job services such as Postgres, with the runtime set in settings (D22).
*   **A proxy that injects tokens or filters traffic (TLS-intercepting, or a CONNECT allowlist such as Squid).** Rejected. Without containers there is nothing to route through it, and each harness keeps its own login (D27).
*   **An LLM gateway such as LiteLLM for budgets and rate limits.** Rejected. It needs API keys, and subscriptions do not provide them. PeCore reads token and cost figures from each harness's output and enforces budgets in the scheduler.
*   **A shared protocol layer (ACP, AgentAPI) for all harnesses.** Rejected. Each harness gets a JSON manifest that maps its run command and output stream. Adding a harness means writing a manifest, not code.

### App and storage

*   **An always-on daemon managed by systemd or LaunchAgent.** Rejected (D23). PeCore is an Electron app: download, open, it runs. Closing the app stops everything.
*   **A web app or PWA.** Rejected (D23). PeCore must start processes, create OS users and write to the disk, and a browser cannot.
*   **No GUI: PeCore as an MCP server used from an existing harness, with recipes rendered as Mermaid.** Rejected. The author wants a full React GUI with a graphical recipe editor (D23).
*   **One global SQLite database, or one database partitioned by project.** Rejected (D18). SQLite has no partitions. A project must be one directory that can be copied or shared, so each project has its own `pecore.db`.
*   **A durable workflow engine (Temporal, Restate, DBOS) or LangGraph.js.** Rejected. They need a separate server or force their own programming model, and they do not store state inside the project directory. The engine PeCore needs is small: a graph, a scheduler and one SQLite file per project.
*   **State tables plus a separate audit log, instead of events.** Rejected. Each engine operation writes its event and updates the views in one transaction, so the history and the current state cannot drift apart. The `effects` table stops duplicate pushes and PRs either way.
*   **A custom telemetry database vs raw logs only.** Both are kept. Raw logs are the source; `telemetry.db` is an index of spans that can be deleted without losing state.
*   **An encrypted secrets file (`secrets.enc`).** Rejected (D27). Harnesses and CLIs such as `gh`, `glab` and the AWS CLI keep their own logins. PeCore stores only references, plus Electron `safeStorage` for the few credentials no tool stores.

### Definitions

*   **JSONC files.** Rejected (D14). Plain JSON validated by JSON Schema generated from Zod. Comments go in `description` fields.
*   **Built-in support for languages and forges (a closed list of check types, a `Forge` interface).** Rejected (D3, D13). Every operation is a node written as data: checks, commit, rebase, push, PR or MR, repo creation. A new language or forge needs new nodes, created by hand or with AI, not engine code.
*   **Workdirs and branches as nodes.** Rejected (D15). The engine creates and removes them, and recipes never see them.
*   **Commit and rebase done by the engine.** Rejected (D16, D17). Commit is a node, so a recipe can put a human review before it. Rebase is a node, because conflicts need an agent.
*   **A link from each instance to its template.** Rejected (D19, D21). An instance is a copy. Changing a template never changes the nodes and recipes already copied into projects.

### Existing tools

*   **Issue-to-PR tools (Copilot coding agent, Codex cloud, Claude Code GitHub Action, OpenHands, Vibe Kanban).** Not used. Each works with one provider, or is a cockpit where the user steers each agent. PeCore routes work across several providers and harnesses at once, runs deterministic checks as recipe nodes, and delivers to any forge or to a local repo only.

## Detailed Implementation

The repository starts empty except for `docs/`. Every file below is new unless marked. Tests sit next to the file they test (`<name>.test.ts`) and are listed only when they verify a goal on their own.

### Fixed implementation choices

*   **Engine process:** started with Electron `utilityProcess.fork`, so it runs on Electron's Node, uses the same `better-sqlite3` build as the app, and dies with the app.
*   **`safeStorage` lives only in the Electron main process.** The engine asks the main process to decrypt a credential over the `utilityProcess` message port; decrypted values never touch the disk.
*   **Admin prompt:** `pkexec` on Linux, `osascript -e 'do shell script ... with administrator privileges'` on macOS. One prompt runs one script that does every privileged step.
*   **Dedicated OS user:** `useradd --system --create-home` on Linux, `sysadminctl -addUser` on macOS. One group `pecore-<project>` holds the app user and the project user. Sudo rule in `/etc/sudoers.d/pecore-<project>`: `<app user> ALL=(pecore-<project>) NOPASSWD: ALL`, checked with `visudo -c` before it is installed.
*   **Services:** the project's compose file is run with `<runtime> compose -p pecore-<job-id> up -d`, and `down -v` when the job's workdir is removed.
*   **Package names:** `@pecore/schemas`, `@pecore/engine`, `@pecore/app`, `@pecore/cli`.

### Root

| File | What and why |
|---|---|
| `package.json` | pnpm workspace root; scripts `build`, `test`, `lint`, `typecheck`, `dist` |
| `pnpm-workspace.yaml` | lists `packages/*` |
| `tsconfig.base.json` | shared TypeScript strict settings |
| `vitest.workspace.ts` | runs every package's tests in one command |
| `eslint.config.js` | lint rules for all packages |
| `.gitignore` | ignores `node_modules/`, `dist/`, `out/` |
| `LICENSE` | MIT (D8) |
| `README.md` | what PeCore is, install, first run, build from source |
| `.github/workflows/ci.yml` | lint, typecheck and tests on Linux and macOS for every push |
| `.github/workflows/release.yml` | builds AppImage, deb and dmg on tags and publishes them for auto-update |

### `packages/schemas`: definitions as Zod

Every file exports a Zod schema and the TypeScript type inferred from it. The engine, the app and the CLI import types only from here.

| File | What and why |
|---|---|
| `src/node.ts` | node schema of 3.1: common fields, fields by kind, `probeRules`, `scratchPaths`, placeholder syntax check |
| `src/recipe.ts` | recipe schema of 3.2: `start`, `onBaseChanged`, `maxNodeRuns`, nodes, edges, `perSubtask`, `requires`, `optional`, `maxRounds` |
| `src/project.ts` | `project.json` of 3.5 |
| `src/accounts.ts` | `accounts.json` with the kinds `model`, `forge`, `service` |
| `src/profiles.ts` | `profiles.json` |
| `src/tiers.ts` | `tiers.json`, with the four tier names fixed |
| `src/settings.ts` | `settings.json`: limits, services runtime, project paths, UI preferences |
| `src/harness-manifest.ts` | harness manifest of section 5 |
| `src/artifacts.ts` | artifact types of 3.3 and the JSON shape of `spec`, `findings`, `risk` |
| `src/events.ts` | every event written to `pecore.db` (`job.created`, `node_run.started`, `effect.requested`, `job.base_changed`, ...) |
| `src/api.ts` | request and response bodies of the local API and WebSocket messages |
| `src/errors.ts` | waiting reasons and failure reasons of 4.3 |
| `src/index.ts` | exports |
| `scripts/gen-json-schema.ts` | writes `schemas/*.json` from the Zod schemas, so `$schema` in definition files works in editors |

### `packages/engine`: the engine process

| File | What and why |
|---|---|
| `src/main.ts` | entry point: reads `PECORE_HOME`, takes the lock file, opens the projects, starts the API and the MCP server, sets interrupted jobs to `paused` |
| **home/** | |
| `src/home/layout.ts` | paths of section 2; creates `PECORE_HOME` and `run/` with permissions 0700 on first run |
| `src/home/git-commit.ts` | commits every definition change to `PECORE_HOME` with a readable message |
| `src/home/lock.ts` | one engine per `PECORE_HOME` |
| **definitions/** | |
| `src/definitions/load.ts` | reads and validates definition files; returns typed errors with file and field |
| `src/definitions/recipe-check.ts` | recipe rules beyond the schema: `use` exists in the project, every edge outcome exists on its node, inputs producible before use (3.3), a parent recipe has a commit node (4.6), `providerNot` targets exist |
| `src/definitions/instantiate.ts` | copies a template into a project; no link kept (D19) |
| `src/definitions/engine-node-confirm.ts` | hash of each `runsAs: engine` node, stored when the user confirms; check before run (section 8) |
| **store/** | |
| `src/store/project-db.ts` | opens `pecore.db` in WAL mode; one transaction per engine operation |
| `src/store/migrations/001-init.sql` | tables `events`, `jobs`, `node_runs`, `attempts`, `human_queue`, `effects`, `usage_daily`, `engine_node_confirmations` |
| `src/store/telemetry-db.ts` | `telemetry.db`: spans and log index |
| `src/store/migrations/telemetry-001-init.sql` | tables `spans`, `log_index` |
| `src/store/chats-db.ts` | `chats.db` for orchestrator chats |
| `src/store/migrations/chats-001-init.sql` | tables `chats`, `messages`, `attachments` |
| **graph/** | |
| `src/graph/job-machine.ts` | job states and transitions of 4.1 |
| `src/graph/node-run-machine.ts` | node run states of 4.3 |
| `src/graph/rules.ts` | edges, join, diverging back edges, rounds, `maxNodeRuns`, optional nodes, base change (4.2); pure functions |
| `src/graph/rules.test.ts` | property tests with fast-check: no node runs twice in one step, rounds never exceed `maxRounds`, every job reaches a final state or `waiting` |
| `src/graph/executor.ts` | applies the rules to a job: picks ready nodes, asks the scheduler for slots, hands them to the runners, records outcomes |
| **scheduler/** | |
| `src/scheduler/pools.ts` | in-memory pools of 4.7; takes all units at once or none |
| `src/scheduler/cooldown.ts` | per-account cooldown after quota or rate limit errors; backoff 1, 2, 4, 8 minutes |
| `src/scheduler/tiers.ts` | picks the first available profile of a tier that satisfies `providerNot` |
| `src/scheduler/budget.ts` | sums tokens and cost per attempt; waits with reason `budget` at the limit |
| **workdir/** | |
| `src/workdir/repo.ts` | creates `repo.git` (clone, or empty with one empty commit), shared group, `config`, `hooks/` and `info/` owned by the app user, `.pecore/` in `info/exclude` |
| `src/workdir/worktrees.ts` | creates and removes job and subtask worktrees and `factory/*` branches, as the project's OS user |
| `src/workdir/content-state.ts` | tree hash with a temporary index, excluding ignored files and `.pecore/`; deletes `scratchPaths` matches; restores a previous state |
| `src/workdir/subtasks.ts` | reads subtasks from `spec`; maps `perSubtask` nodes to subtask worktrees |
| **runners/** | |
| `src/runners/process.ts` | spawns a process in its own group, as a given OS user through `sudo -n -u`, with a timeout; stop sends `SIGTERM` then `SIGKILL` after 5 s |
| `src/runners/placeholders.ts` | substitutes placeholders into argument arrays; builds `PECORE_*` environment variables for `shell: true` |
| `src/runners/command.ts` | runs `command` nodes: probe, command, `outcomeRules`, `outputRules`, `check-log` artifact |
| `src/runners/probe.ts` | runs the probe and applies `probeRules`: `done`, `not_done`, `unknown` |
| `src/runners/agent.ts` | runs `agent` nodes: writes the prompt and `.pecore/`, starts the harness from its manifest, reads the stream, validates `outputSchema` |
| `src/runners/human.ts` | puts a human node in `human_queue` and waits for the user's outcome |
| `src/runners/forge-env.ts` | environment for `credentials` (for example `GH_TOKEN` from `gh auth token --user <login>`, `AWS_PROFILE`) |
| **harness/** | |
| `src/harness/manifests.ts` | loads manifests; checks the installed version against the tested range |
| `src/harness/stream.ts` | maps each harness's JSON output to normalised events, tokens and quota errors |
| `src/harness/login.ts` | runs a harness login command as a given OS user and streams its URL or code to the GUI |
| `src/harness/fake-harness.ts` | test harness driven by a script file; used by engine tests and the crash test |
| **jobs/** | |
| `src/jobs/controls.ts` | global pause and play; per job stop, pause, play, archive, delete (G17) |
| `src/jobs/stacked.ts` | `parentJobId`, `dependsOn`, base and old base, `job.base_changed` for children |
| `src/jobs/delete.ts` | runs `cleanup` of completed delivery nodes, then removes branches, worktrees, artifacts, logs and rows |
| `src/jobs/effects.ts` | `effect.requested`, `effect.completed`, `effect.failed` (4.8) |
| `src/jobs/crash.test.ts` | kills the engine during each delivery node with the fake harness, restarts, and checks that nothing is delivered twice (G12) |
| **osuser/** | |
| `src/osuser/script.ts` | builds the privileged script (user, group, sudo rule, ACLs); the same text is shown in the guided procedure |
| `src/osuser/acl.ts` | traverse-only ACLs on the path to `work/` (`setfacl` on Linux, `chmod +a` on macOS) |
| `src/osuser/home-check.ts` | checks that the app user's home and tool login files are not readable by others; returns the fix commands |
| `src/osuser/list.ts` | lists dedicated users for the dropdown |
| **services/** | |
| `src/services/runtime.ts` | runs the project's compose file with the runtime set in settings; waits with reason `services` until healthy |
| **api/** | |
| `src/api/server.ts` | Fastify on `127.0.0.1`, token check, `Origin` and `Host` check |
| `src/api/routes/projects.ts` | create, edit, export, import projects |
| `src/api/routes/jobs.ts` | list, read, controls, `why`, human outcomes |
| `src/api/routes/definitions.ts` | read, write, validate, instantiate templates and instances; confirm engine nodes |
| `src/api/routes/settings.ts` | settings, accounts, profiles, tiers, OS users, harness logins |
| `src/api/routes/chats.ts` | orchestrator chats and attachments |
| `src/api/ws.ts` | live events for the GUI: job and node states, log lines |
| **orchestrator/** | |
| `src/orchestrator/mcp-server.ts` | MCP server with its own token and the tools of section 6 only |
| `src/orchestrator/tools.ts` | tool handlers; `write_*` validate before saving |
| `src/orchestrator/session.ts` | starts the orchestrator's harness as its OS user with the MCP configuration; stores messages in `chats.db` |
| **sources/** | |
| `src/sources/source.ts` | the four operations of section 7 |
| `src/sources/github-issues.ts` | through `gh` |
| `src/sources/gitlab-issues.ts` | through `glab` |
| `src/sources/markdown-folder.ts` | a local folder of Markdown tickets |
| `src/sources/jira.ts` | Jira REST with a credential from `safeStorage` |
| **share/** | |
| `src/share/export.ts` | archive of a project without secrets, clone or workdirs; history optional |
| `src/share/import.ts` | account mapping, OS user choice, engine node confirmation |
| **observability/** | |
| `src/observability/spans.ts` | spans with W3C trace ids; `TRACEPARENT` for harnesses |
| `src/observability/logs.ts` | raw harness logs as `.jsonl.zst` |
| `src/observability/why.ts` | blocking reasons of a job, used by GUI and `pecore job why` |

### `packages/app`: Electron and React

The screens below come from G16. Their layout is not designed yet; it needs its own section before UI work starts.

| File | What and why |
|---|---|
| `electron-builder.yml` | AppImage, deb, dmg; auto-update; rebuilds `better-sqlite3` for Electron |
| `electron.vite.config.ts` | builds main, preload and renderer |
| `src/main/index.ts` | window, menus, starts the engine, kills it on quit |
| `src/main/engine.ts` | `utilityProcess.fork` of the engine; passes `PECORE_HOME` and the API token |
| `src/main/safe-storage.ts` | encrypts and decrypts `run/credentials.json` entries for the engine |
| `src/main/admin.ts` | runs the privileged script with `pkexec` or `osascript` |
| `src/main/notifications.ts` | native notifications, sounds, night mode |
| `src/main/updater.ts` | auto-update |
| `src/preload/index.ts` | exposes only the API address and token to the renderer |
| `src/renderer/main.tsx` | React root and routes |
| `src/renderer/api/client.ts` | typed HTTP client from `@pecore/schemas` |
| `src/renderer/api/live.ts` | WebSocket subscription |
| `src/renderer/screens/FirstRun.tsx` | guided first run (G14) |
| `src/renderer/screens/Chat.tsx` | orchestrator chat with attachments |
| `src/renderer/screens/Projects.tsx` | project list and creation, OS user dropdown |
| `src/renderer/screens/ProjectSettings.tsx` | repo, account, OS user, services, limits, source |
| `src/renderer/screens/Jobs.tsx` | job list with state, waiting reason and controls; global pause and play |
| `src/renderer/screens/JobView.tsx` | live job graph (React Flow), node details, artifacts, raw log |
| `src/renderer/screens/HumanQueue.tsx` | human nodes waiting for the user, with the artifacts they show |
| `src/renderer/screens/RecipeEditor.tsx` | recipe graph editor with drag and drop |
| `src/renderer/screens/NodeEditor.tsx` | node template and instance editor, with AI help through the chat |
| `src/renderer/screens/Library.tsx` | templates, instantiate into a project |
| `src/renderer/screens/Accounts.tsx` | accounts, profiles, tiers, harness logins per OS user |
| `src/renderer/screens/Settings.tsx` | limits, services runtime, paths |
| `src/renderer/components/EngineNodeConfirm.tsx` | shows command, probe, cleanup and credentials of a `runsAs: engine` node and asks for confirmation |

### `packages/cli`

| File | What and why |
|---|---|
| `src/index.ts` | `pecore` command; reads `run/api-token` and calls the local API; fails with a clear message when the app is closed |
| `src/commands/init.ts` | first run without the GUI (G14) |
| `src/commands/project.ts` | `project list`, `export`, `import` |
| `src/commands/job.ts` | `job list`, `why`, `stop`, `pause`, `play`, `archive`, `delete` |
| `src/commands/validate.ts` | validates definition files |

### Shipped templates and manifests

Copied into `PECORE_HOME/library/` on first run. They are data, so adding one needs no engine change (G2, G3).

| File | What and why |
|---|---|
| `library/nodes/spec-writer.json` + `.md` | writes `spec` with criteria, interfaces, subtasks |
| `library/nodes/tests-writer.json` + `.md` | writes tests and throwing stubs |
| `library/nodes/builder.json` + `.md` | fills the stubs; never edits tests |
| `library/nodes/code-reviewer.json` + `.md` | writes `findings` |
| `library/nodes/approver.json` + `.md` | writes `risk` per hunk |
| `library/nodes/human-review.json` | buttons `approve`, `changes`, `reject` |
| `library/nodes/subtask-merge.json` | merges subtask branches; `clean` or `conflict` |
| `library/nodes/git-commit.json` | commit; `done` also when there is nothing new |
| `library/nodes/git-rebase.json` | stash, `rebase --onto`, restore |
| `library/nodes/git-push.json` | push with probe on the remote branch |
| `library/nodes/github-pr.json`, `github-issue-comment.json`, `github-create-repo.json` | GitHub delivery with probe and cleanup |
| `library/nodes/gitlab-mr.json`, `gitlab-issue-comment.json`, `gitlab-create-repo.json` | GitLab delivery with probe and cleanup |
| `library/nodes/typecheck.json`, `eslint.json`, `vitest.json` | TypeScript checks |
| `library/nodes/cargo-check.json`, `cargo-clippy.json`, `cargo-test.json` | Rust checks, for G2 |
| `library/recipes/empty.json` | starts and ends (D7) |
| `library/recipes/feature.json` | the recipe of 3.2 |
| `library/recipes/bugfix.json` | the recipe of CUJ 1 |
| `library/recipes/local-only.json` | ends at commit (CUJ 4) |
| `harnesses/claude-code.json`, `codex.json`, `antigravity.json`, `opencode.json`, `pi.json`, `copilot.json` | harness manifests of section 5 |

### Docs

| File | What and why |
|---|---|
| `docs/designs/pecore.md` | this design |
| `docs/pecore-v0.5.md` (changed) | a first line pointing to the design that replaces it |
| `docs/nodes.md` | how to write a node: fields, placeholders, probe, cleanup, `runsAs` |
| `docs/recipes.md` | how to write a recipe: edges, rounds, joins, subtasks, `onBaseChanged` |
| `docs/harnesses.md` | how to add a harness manifest |

### Build order

Phases set the order only; the product is the sum (D1).

1.  `schemas`, `home`, `definitions`, `store`: files load and validate; empty recipe stored.
2.  `graph`, `scheduler`, `runners/command`, `workdir`: command-only recipes run end to end on a local-only project.
3.  `harness`, `runners/agent`, fake harness: agent nodes, tiers, quota waits.
4.  `osuser`, `services`, `effects`, delivery templates, crash test: dedicated users, GitHub and GitLab delivery.
5.  `api`, `app`, `cli`: GUI and CLI over the same API.
6.  `orchestrator`, `sources`, `share`, `observability`: chat, tickets, export and import, diagnosis.
