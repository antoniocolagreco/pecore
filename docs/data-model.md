# Data model

This document lists every data structure in <PE/CORE>: the domain types, how they relate, and where they are stored. The source of truth is the code. Zod schemas are in `packages/schemas/src/`, and the SQL tables are created by the migrations in `packages/engine/src/store/`.

## Overview

```
Settings ─────────────── one per app
Account (model | forge | service)
  ▲ account id
  ├── Profile { account, model, effort } ◄── Tier (frontier | strong | standard | cheap)
  ├── Agent card .model { account, model, effort }
  └── Project.repo.account, Project.tracker.account, Node.account

Catalog: Node templates (agent | command | human | repository), Recipe templates
Project ── recipes[] ──► Recipe ── steps ──► Node
   │
   └── Job ── NodeRun ── Attempt ── AttemptLog
        │        └── Artifact
        └── Event (append-only log; the tables above are projections of it)

Chat ── Message ── Attachment, Action
Notification, HumanQueueItem
```

Storage:

| Where | What |
|---|---|
| `PECORE_HOME/chats.db` | Global database: settings, accounts, profiles, tiers, agents, themes, catalog, chats, notifications |
| `PECORE_HOME/projects/<id>/pecore.db` | Project database: project definition, project catalog, events and their projections (jobs, node runs, attempts, artifacts, logs, queue, tickets) |
| `PECORE_HOME/projects/<id>/repo.git`, `work/<job-id>/` | Bare repository and job worktrees |
| `PECORE_HOME/projects/<id>/knowledge/*.md` | Knowledge documents |
| `PECORE_HOME/test/repo/` | Node test folder (not a database) |
| `resources/connectors/*.json` | Connector files, shipped with the app |
| Memory only | Node tests, login progress, live connections |

## Common values

| Name | Rule |
|---|---|
| `Name` | lower case letters, digits and dashes, starting with a letter |
| `DefinitionName` | `Name`, at most 24 characters |
| `ProjectId` | `Name`, at most 24 characters |
| `Outcome` | lower case letters, digits and underscores, starting with a letter |
| `KnowledgeFileName` | `*.md`, at most 100 characters |
| `TierName` | `frontier`, `strong`, `standard`, `cheap` |
| `HexColor` | `#RRGGBB`, upper case |

## Configuration (global)

### Settings

One row in `settings`, plus `ui_preferences` for UI state.

| Field | Type | Default |
|---|---|---|
| `user.name` | string or null | null |
| `limits.jobs` | positive integer or null | null (derived from CPU count) |
| `limits.agents` | positive integer | 4 |
| `servicesRuntime` | `docker`, `podman`, `colima`, `orbstack` or null | null |
| `minFreeDiskGb` | number | 10 |
| `mergeCheckSec` | integer | 300 |
| `projectsFolder` | string | `~` |
| `protectedMode` | boolean | false |
| `ui` | map of name to JSON | `{}` |

`Compaction { auto, max }` is a value object used by agents: token thresholds rounded to powers of two, with `max` at least twice `auto`.

### Account

Table `accounts`. A union on `kind`. The `id` is unique across all kinds.

**ModelAccount** (`kind: "model"`): a login to an AI tool.

| Field | Meaning |
|---|---|
| `id` | account id |
| `connector` | harness: `claude-code`, `codex`, `opencode`, `pi` |
| `provider` | who serves the models, for example `anthropic`, `openrouter` |
| `login` | `subscription` or `api-key` |
| `email` | from the harness, or null |
| `maxParallel` | parallel runs allowed, default 2 |

**ForgeAccount** (`kind: "forge"`): a Git hosting account.

| Field | Meaning |
|---|---|
| `forge` | `github`, `gitlab`, `codecommit`, `git` |
| `host` | host name, normalised |
| `tool` | `gh`, `glab`, `aws`, `git` |
| `user` | login name |
| `awsProfile` | CodeCommit only, optional |
| `author { name, email }` | commit author |

**ServiceAccount** (`kind: "service"`): a tracker or other service.

| Field | Meaning |
|---|---|
| `service` | for example `Jira`, `Atlassian`, `Linear` |
| `tool` | CLI or MCP used, for example `acli`, `atlassian`, `linear` |
| `user` | login name |
| `site` | Jira site, optional |

**Login** (runtime, `LoginView`): one per model account and OS user. `state` is `logged_in`, `logged_out`, `unknown` or `unchecked`, with `email`, `plan`, `defaultDir` and `running`. Logins are checked through the harness, never stored by <PE/CORE>.

**AccountOptions** (runtime): the `models` and `efforts` a model account offers.

### Model choice: Profile and Tier

A model choice is `{ account, model, effort }`, where `account` points to a ModelAccount and `effort` may be null.

- **Profile** (table `profiles`): a named model choice, with `id`.
- **Tier** (table `tier_profiles`): for each `TierName`, an ordered list of profile ids. Nodes and recipe steps ask for a tier, and the engine picks the first usable profile.
- **Auto-setup profiles** (table `auto_setup_profiles`): profiles the app created on its own, kept apart so they can be replaced.

### Agent

Table `agents`, plus `agent_contexts` (Markdown per agent).

| Kind | Fields |
|---|---|
| `agent` (card used by nodes) | `id`, `name`, `color`, `model` (model choice or null), `compaction` |
| `pm` (Project Manager) | `id`, `name`, `color`, `cardId` (default `agent-default`), `model`, `compaction` |
| `assistant` | `id = assistant`, `name`, `color`, `model`, `compaction` |

Built-in ids: `agent-default` (Default Agent) and `assistant`. Names of user agents are unique.

### Themes

Tables `themes` (`id`, `name`) and `theme_tokens` (`theme_id`, `token`, `color`).

## Catalog (templates)

Stored in `catalog_*` tables, in `chats.db` for global templates and in each `pecore.db` for the project's copy. Prompt and script bodies are in `catalog_node_content`, icons in `catalog_icons`. `shipped` marks templates that come with the app.

### Node

A union on `kind`. Common fields:

| Field | Meaning |
|---|---|
| `name`, `description`, `icon`, `tags` | identity and search |
| `params` | JSON Schema of the parameters |
| `outcomes` | possible results, at least one |
| `outputs` | outcome to artifact type it produces |
| `failOutcomes` | outcomes that mean failure |
| `scratchPaths` | files deleted after the run |
| `retry` | retries on harness errors, default 1 |

By kind:

| Kind | Extra fields |
|---|---|
| `agent` | `prompt` (`*.md`), `agent { tier or profiles, providerNot }`, `knowledge`, `agentSession` (`job`, `node`, `new`), `tracker { access: read or read-write, account }`, `timeoutSec`, `changesFiles` |
| `command` | `command` (argv) or `script` (`*.sh`), `inputs`, `optionalInputs`, `outcomeRules`, `outputRules`, `timeoutSec`, `changesFiles` |
| `human` | `interface`: `decision`, `code-review`, `report-review` |
| `repository` | `account`, `script`, `inputs`, `optionalInputs`, `outcomeRules`, `outputRules`, `probe`/`probeRules`, `mergedCheck`/`mergedCheckRules`, `readOnly`, `timeoutSec` (default 120); `changesFiles` is always false |

Rules:

- `OutcomeRule`: by `exitCode` (number or `other`), by a JSON field value, or by a JSON field's other values.
- `OutputRule`: read the output from a `file`, a JSON field (`stdoutJson`) or the last line (`stdoutLastLine`).
- Placeholders in argv and prompts: `{job.*}`, `{project.*}`, `{ticket.id}`, `{workdir}`, `{params.<name>}`.

`open-pr` and `create-repo` are generic Repository nodes; the project's forge supplies the script from `templates/forges/`.

### Recipe

| Field | Meaning |
|---|---|
| `name`, `description`, `icon` | identity |
| `nodes` | step id to step |
| `start` | first step |
| `edges[]` | `{ from, on (outcome), to, maxRounds }` |
| `ends[]` | `{ from, on, result }` with result `succeeded`, `failed`, `not_delivered` |
| `onBaseChanged` | step to run when the base branch moves |
| `ci` | `{ after, on, intervalSec, timeoutSec, maxCorrections, checks }` |
| `layout` | editor positions |

A **step** is `{ use (node name), params, agent { tier or profiles, providerNot }, reads[], requires[], agentId, agentSession, skipWhenUnchanged }`.

### Connector

A shipped JSON file that tells the engine how to drive one harness: `name`, `title`, `kind` (`native` or `adapter`), `harness { program, versionArgs, versionRange }`, `command`, `env`, `configDirEnv`, `configDirFiles`, `sessionConfig`, `sessionMeta`, `reader`, `errors[]` (pattern to `quota`, `rate_limit`, `auth`, `other`), `loginCommand`, `loginUrlPattern`, `loginReadsCode`, `beforeLogin`, `beforeStart`, `identityCommand`, `identityField`. The list of known harnesses, with their colours and whether they are supported, is in `harnesses.ts`.

## Project

Table `project_definition` with `project_recipes`, `project_variables`, `project_credentials`, `project_knowledge_*` and `project_creation` (creation step in progress).

| Field | Meaning |
|---|---|
| `id`, `name` | identity |
| `repo { url, account }` or null | remote repository and its forge account; null for a local project |
| `folder` | local folder, or null for the default |
| `baseBranch` | default `main` |
| `createRepo` | repository creation node, only with a repo |
| `recipes` | recipe names available in the project |
| `recipeKnowledge` | recipe to step to knowledge files |
| `variables` | JSON values for placeholders |
| `credentials` | name to account id |
| `services` | services file, or null |
| `pm { name, color, agentId }` | Project Manager identity |
| `tracker { provider, account }` or null | `github`, `gitlab`, `jira`, `linear` |

## Execution (per project)

The project database is event-sourced. `events` is the append-only log; the other tables are projections rebuilt from it.

### Event

`{ id, jobId, type, payload, at }`. Types:

| Group | Types |
|---|---|
| Job | `job.created`, `job.definitions_saved`, `job.state_changed`, `job.base_changed`, `job.base_change_requested`, `job.ci_check`, `job.delivery_merged`, `job.archived`, `job.unarchived` |
| Node run | `node_run.created`, `node_run.state_changed`, `node_run.git_recorded`, `node_run.completed`, `node_run.failed` |
| Attempt | `attempt.started`, `attempt.session_started`, `attempt.ended` |
| Effect | `effect.requested`, `effect.completed`, `effect.failed` |
| Queue | `queue.added`, `queue.resolved`, `confirmation.recorded` |
| Orders and tickets | `ticket.seen`, `order.read`, `order.handed`, `order.asked`, `order.planned`, `order.done`, `order.dropped` |

### Job

Table `jobs`.

| Field | Meaning |
|---|---|
| `id`, `title`, `request` | what to do |
| `recipe` | recipe name; the recipe and node definitions are frozen in `job.created` and `job.definitions_saved` (`JobDefinitions`) |
| `state` | `queued`, `running`, `waiting`, `paused`, `succeeded`, `not_delivered`, `failed`, `stopped` |
| `waiting_reason` | `parent_job`, `parent_failed`, `concurrency`, `disk`, `network`, `auth`, or a pause reason `user`, `quit` |
| `failure_reason` | see Enumerations |
| `parent_job_id` | job this one builds on |
| `base_branch`, `base`, `old_base`, `target`, `branch` | Git positions |
| `ticket_id`, `order_id`, `order_key` | origin |
| `archived`, `merged_at`, `created_at`, `updated_at` | lifecycle |

**JobRequest** (input to create jobs from chat or an order): `{ key, title, recipe, request, ticketId, dependsOn (at most one key), baseBranch, attachmentIds }`.

**JobDefinitions**: `{ recipeHash, knowledgeByStep, nodes: name → { definition, sidecars, hash } }`.

### NodeRun

Table `node_runs`: one execution of a recipe step.

| Field | Meaning |
|---|---|
| `id`, `job_id`, `node` (step id), `round`, `via_edge` | position in the graph |
| `state` | `pending`, `waiting`, `running`, `completed`, `failed`, `interrupted` |
| `outcome` | result, or the built-ins `stale`, `skipped` |
| `waiting_reason`, `reset_at`, `queue_item_id` | why it waits |
| `auth_account`, `auth_os_user`, `auth_kind` | login it waits for (`harness` or `tool`) |
| `failure_reason` | see Enumerations |
| `files_hash_before`, `files_hash_after`, `git_before` | workdir state |
| `pgid`, `os_user`, `started_at`, `ended_at` | process |

### Attempt and AttemptLog

Table `attempts`: one try of an agent or command inside a node run. Fields: `profile`, `connector`, `harness_version`, `connector_version`, `model`, `account`, `os_user`, `agent_id`, `agent_session`, `session_id`, `resumed`, tokens (`tokens_in`, `tokens_out`, `cache_read`, `cache_write`), `cost`, `end_reason`, `log_omitted`, times.

Table `attempt_logs`: `{ attempt_id, sequence, direction (in, out, err, cmd), at, payload }`.

### Artifact

Table `artifacts`: `{ job_id, run, name, type, sha256, files_hash, content }`. `files_hash` ties an artifact to the workdir state it describes.

| Type | Content |
|---|---|
| `spec` | `{ feature, scenarios[{ name, given[], when, then[], examples? }] }` |
| `diff` | Git patch, plain text, produced by the engine |
| `code_review` | `{ body, comments[{ file, line or hunk, text }] }` |
| `code_analysis` | `{ summary, hunks[{ file, hunk, level: risky or safe, text }] }` |
| `sha` | commit SHA, plain text |
| `pull_request` | `{ title, body, url? }` |
| `feedback` | plain text |
| `log` | plain text, produced for commands |
| `attachment` | a file attached to the job |

### HumanQueueItem

Table `human_queue`: something that waits for the user. `{ id, job_id, kind, subject (JSON), subject_hash, state, choices, choice, note, created_at, resolved_at }`. Kinds: `human-node`, `ci-head`, `agent-question`, `engine-node`, `source-node`, `recipe-change`, `import`, `ticket`, `services`, `round-limit`, `budget`, `outbound`. States: `open`, `resolved`, `cancelled`.

### Tickets and orders

Table `tickets_seen`: `{ source, ticket_id, order_id, seen_at, state }`, with state `received`, `confirming`, `handed`, `asking`, `planned`, `done`, `dropped`. `TicketSnapshot` is `{ title, body, author, labeledBy, attachments }`.

## Chat (global)

| Table | Fields |
|---|---|
| `chats` | `id`, `project` (null for the Assistant), `session_id`, `session_key`, `context_tokens`, `last_read_message_id`, `reported_until`, `instructions` |
| `messages` | `id`, `chat_id`, `role` (`user`, `assistant`), `sender`, `text`, `context`, `state`, `error`, `order_id`, `order_project`, `reply_to`, `created_at` |
| `attachments` | `id`, `chat_id`, `message_id`, `path`, `mime`, `size` |
| `actions` | `id`, `message_id`, `tool`, `target`, `created_at` |
| `notifications` | `id`, `kind`, `title`, `body`, `target`, `seen`, `created_at` |

`ChatForm` (shown as a card): one to six questions, single choice, multiple choice or short text, up to eight options each.

## Node tests (memory only)

`NodeTestView`: `{ id, state (running, waiting, completed, failed, stopped), outcome, failureReason, outputs[{ type, content }], diff, files[{ path, status }], question, error, notice, startedAt, endedAt }`. Only the running test and the last finished one are kept.

## Enumerations

| Name | Values |
|---|---|
| Job state | `queued`, `running`, `waiting`, `paused`, `succeeded`, `not_delivered`, `failed`, `stopped` |
| Node run state | `pending`, `waiting`, `running`, `completed`, `failed`, `interrupted` |
| Node run waiting reason | `concurrency`, `quota`, `rate_limit`, `budget`, `human`, `services`, `round_limit`, `network`, `auth`, `confirmation`, `disk` |
| Failure reason | `HARNESS_ERROR`, `AGENT_UNAVAILABLE`, `TIMEOUT`, `INVALID_OUTPUT`, `READ_ONLY_VIOLATION`, `PROCESS_KILLED`, `COMMAND_NOT_FOUND` |
| Agent session | `job`, `node`, `new` |
| Tracker access | `read`, `read-write` |
| Human interface | `decision`, `code-review`, `report-review` |
| Tracker provider | `github`, `gitlab`, `jira`, `linear` |

## API and live messages

The HTTP routes and their bodies and views are in `packages/schemas/src/api.ts` (`routes`). The views are read models built from the tables above: `ProjectView`, `CreationView`, `JobView`, `JobDetail`, `NodeRunView`, `AttemptView`, `QueueItemView`, `WhyView`, `StatusView`, `NotificationView`, `ChatDetail`, `ChatMessageView`, `DefinitionFile`, `DefinitionEntry`, `LoginView`, `AccountOptions`, `SetupView`, `NodeTestView`.

The WebSocket `/live` sends `LiveMessage`: `job.updated`, `node_run.updated`, `queue.updated`, `project.updated`, `definition.changed`, `node_test.updated`, `configuration.changed`, `accounts.discovery_changed`, `log.line`, `login.progress`, `chat.changed`, `notify`.

The main process and the engine exchange `EngineMessage` (`ready`, `error`, `notify`, `admin`, `active`, `shutdown.done`) and `MainMessage` (`admin.result`, `active?`, `shutdown`).
