# Data model

The aggregates of <PE/CORE>, grouped by context. For each aggregate: its root, its entities and value objects, the Zod schema in `packages/schemas/src/`, and the tables that store it.

Terms:

- **Aggregate**: a group of objects saved and changed together. Other aggregates refer to it only by its root's id.
- **Entity**: has its own identity.
- **Value object (VO)**: no identity; defined by its values.

## Configuration (`chats.db`)

### Settings

| | |
|---|---|
| Root | `Settings` (one per app) |
| VOs | `UserInfo { name }`, `Limits { jobs, agents }` |
| Attributes | `servicesRuntime`, `minFreeDiskGb`, `mergeCheckSec`, `projectsFolder`, `protectedMode` |
| Zod | `Settings` |
| Tables | `settings` (one row) |

### UiPreference

| | |
|---|---|
| Root | `UiPreference { name, value }` |
| Zod | `Settings.ui` |
| Tables | `ui_preferences` |

### Account

| | |
|---|---|
| Root | `Account`, one of `ModelAccount`, `ForgeAccount`, `ServiceAccount` |
| ModelAccount | `harness` (`connector`), `provider`, `login` (`subscription`, `api-key`), `email`, `maxParallel` |
| ForgeAccount | `forge`, `host`, `tool`, `user`, `awsProfile`, VO `CommitAuthor { name, email }` |
| ServiceAccount | `service`, `tool`, `user`, `site` |
| Rules | `id` unique across all kinds |
| Zod | `Account`, `Accounts` |
| Tables | `accounts` (one table for the three kinds) |

### Profile

| | |
|---|---|
| Root | `Profile` |
| VOs | `ModelSelection { model, effort }` |
| References | `Account` |
| Zod | `Profile`, `Profiles` |
| Tables | `profiles`; `auto_setup_profiles` for profiles the app created |

### Tiers

| | |
|---|---|
| Root | `Tiers` (one per app) |
| VOs | `Tier { name, profiles[] }`, names `frontier`, `strong`, `standard`, `cheap` |
| References | `Profile` |
| Zod | `Tiers` |
| Tables | `tier_profiles` |

### Agent

| | |
|---|---|
| Root | `Agent`, one of `NodeAgent` (card), `ProjectManagerAgent`, `Assistant` |
| VOs | `ModelSelection { account, model, effort }`, `Compaction { auto, max }`, `AgentContext` (Markdown) |
| Attributes | `name`, `color`; PM also `cardId` |
| References | `Account` (through `ModelSelection`), PM's card `Agent` |
| Rules | ids `agent-default` and `assistant` are reserved; card names unique |
| Zod | `NodeAgent`, `ProjectManagerAgent`, `ChatAgent`, `AgentDefinitions` |
| Tables | `agents`, `agent_contexts` |

### Theme

| | |
|---|---|
| Root | `Theme { id, name }` |
| VOs | `ThemeToken { token, color }` |
| Zod | none |
| Tables | `themes`, `theme_tokens` |

## Catalog (`chats.db`, copied into each `pecore.db`)

### NodeTemplate

| | |
|---|---|
| Root | `Node`, one of `AgentNode`, `CommandNode`, `HumanNode`, `RepositoryNode` |
| Identity | `name` |
| VOs (all kinds) | `Params` (JSON Schema), `Outcomes[]`, `Outputs` (outcome → artifact type), `FailOutcomes[]`, `ScratchPaths[]` |
| AgentNode | `Prompt` (Markdown body), `AgentRequirement { tier or profiles, providerNot }`, `AgentTracker { access, account }`, `agentSession`, `knowledge[]` |
| CommandNode | `Command` (argv) or `Script` (shell body), `inputs[]`, `optionalInputs[]`, `OutcomeRule[]`, `OutputRule[]` |
| HumanNode | `interface` |
| RepositoryNode | `account`, `Script`, `Probe { command, rules }`, `MergedCheck { command, rules }`, `inputs[]`, `OutcomeRule[]`, `OutputRule[]` |
| Zod | `Node` |
| Tables | `catalog_nodes`, `catalog_node_lists`, `catalog_node_params`, `catalog_node_outputs`, `catalog_commands`, `catalog_command_args`, `catalog_probe_values`, `catalog_outcome_rules`, `catalog_output_rules`, `catalog_node_content` |

### RecipeTemplate

| | |
|---|---|
| Root | `Recipe` |
| Identity | `name` |
| Entities | `Step` (id unique in the recipe) |
| VOs | `Edge { from, outcome, to, maxRounds }`, `End { from, outcome, result }`, `CiPolicy`, `LayoutPosition`; per step `AgentRequirement`, `Params`, `reads[]`, `requires[]` |
| References | `Node` (by name), `Agent` |
| Rules | start, edges, ends and reads point to existing steps; one destination per step outcome |
| Zod | `Recipe`, `RecipeNode`, `Edge`, `RecipeEnd` |
| Tables | `catalog_recipes`, `catalog_recipe_steps`, `catalog_step_params`, `catalog_step_lists`, `catalog_recipe_lists`, `catalog_recipe_edges`, `catalog_recipe_layout` |

### Icon

| | |
|---|---|
| Root | `Icon { name, svg }` |
| Zod | none |
| Tables | `catalog_icons` |

### Connector (reference data, read-only)

| | |
|---|---|
| Root | `Connector` |
| Zod | `Connector` |
| Storage | `resources/connectors/*.json`, not in a database |

## Project (`pecore.db`)

### Project

| | |
|---|---|
| Root | `Project` |
| VOs | `RepoRef { url, account }`, `PmIdentity { name, color, agentId }`, `TrackerRef { provider, account }`, `recipes[]`, `variables`, `credentials`, `recipeKnowledge` |
| Attributes | `name`, `folder`, `baseBranch`, `createRepo`, `services` |
| References | `Account`, `Agent`, `Recipe`, `Node` |
| Zod | `Project` |
| Tables | `project_definition`, `project_recipes`, `project_variables`, `project_credentials`, `project_knowledge_recipes`, `project_knowledge_steps`, `project_knowledge_reads` |

### ProjectCreation

| | |
|---|---|
| Root | `ProjectCreation { step }` |
| Zod | none (`CreationView` in the API) |
| Tables | `project_creation` |

## Execution (`pecore.db`, event-sourced)

The source of truth is the `events` table, typed by Zod `EventBody`. The other tables are projections rebuilt from the events.

### Job

| | |
|---|---|
| Root | `Job` |
| Entities | `NodeRun` (one run of a step), `Attempt` (one try inside a node run) |
| VOs | `GitPosition { baseBranch, base, oldBase, target, branch }`, `JobDefinitions` (frozen recipe and nodes), `Artifact`, `AttemptLogLine`, `Tokens`, `AuthWait { account, osUser, kind }` |
| Attributes | `title`, `request`, `recipe`, `state`, `waitingReason`, `failureReason`, `ticketId`, `archived`, `mergedAt` |
| References | parent `Job`, `Order`, `Profile`, `Account`, `Agent` |
| Zod | `EventBody` (`job.*`, `node_run.*`, `attempt.*`, `effect.*`), `JobDefinitions`, `Artifact` |
| Tables | `events`; projections `jobs`, `node_runs`, `attempts`, `attempt_logs`, `artifacts` |

### HumanQueueItem

| | |
|---|---|
| Root | `HumanQueueItem` |
| Attributes | `kind`, `subject`, `subjectHash`, `choices[]`, `state`, `choice`, `note` |
| References | `Job` |
| Zod | `queue.added`, `queue.resolved` events |
| Tables | `human_queue` |

### Order

| | |
|---|---|
| Root | `Order` (a ticket received from a tracker) |
| VOs | `TicketSnapshot`, `TicketReply`, `JobRequest[]` (the plan) |
| Attributes | `source`, `ticketId`, `state` |
| References | `Job` (through `order_id`) |
| Zod | `order.*`, `ticket.seen` events, `TicketSnapshot`, `JobRequest` |
| Tables | `tickets_seen` |

## Chat (`chats.db`)

### Chat

| | |
|---|---|
| Root | `Chat` (one for the Assistant, one per Project Manager) |
| Entities | `Message`, `Attachment`, `Action` |
| VOs | `ChatForm`, `SessionRef { sessionId, sessionKey }` |
| References | `Project` |
| Zod | none (`ChatDetail`, `ChatMessageView` in the API) |
| Tables | `chats`, `messages`, `attachments`, `actions` |

### Notification

| | |
|---|---|
| Root | `Notification` |
| Zod | none (`NotificationView` in the API) |
| Tables | `notifications` |

## Not stored

`Login` (per account and OS user), `AccountOptions`, `NodeTest`, login progress and live connections live only in memory.

## Where the Zod schema and the table differ

| Aggregate | Difference |
|---|---|
| Settings | `ui` is a Zod field but its own table; VOs flattened into columns (`user_name`, `job_limit`, `agent_limit`) |
| Account | one table for three kinds, with columns null for the other kinds; `CommitAuthor` flattened; extra `position` column |
| Profile | `auto_setup_profiles` reuses the `Profile` schema in a second table |
| Agent | `AgentContext` stored in `agent_contexts`, outside the agent schema |
| Theme, Icon, ProjectCreation, Chat, Notification | table without a Zod schema |
| NodeTemplate, RecipeTemplate | one Zod object split over 7 to 10 tables, with generic list tables (`field`, `position`, `value`) and `has_*` flags |
| Project | `has_variables`, `has_credentials`, `has_recipe_knowledge`, `uses_templates` flags not in Zod |
| Job, HumanQueueItem, Order | Zod types the events, not the projection rows |
