# Tasks planner: scope and ten issues

*   **Status:** draft for review, 2026-11-27.
*   **Purpose:** stop the design spiral. Record the original idea, separate what is settled from what is not, and split the work into ten issues.
*   **Not a design spec:** this document does not describe the implementation. New design goes into an issue, not into this file.

## 1. The original idea (anchor)

*   A project chooses **one issue tracker when it is created**: internal, GitHub, GitLab, Jira or Linear. One tracker per project; they do not coexist.
*   The tracker item is the planning entity: a **Task** (internal), an Issue (GitHub) or a Ticket (Jira). In the app it is always a Task with a provider reference.
*   A Task can be created from the UI, from chat with the Project Manager or the Assistant, or from an external tracker. Chat is only one authoring channel.
*   A Task can exist without a Job. Many Tasks can wait.
*   A Task has **at most one active Job**. The Job is an execution attempt.
*   The **JobRequest** is generated at launch from the Task and the user input. It is a DTO, not a persisted entity; its content is stored in the Job.
*   The Job is one-shot. Pause is reversible. Error is recoverable. Termination is closed. Success and rejection are terminal.
*   The **Task owns the planning state, the branch name and the PR**; the Job owns the attempt's workdir, commits and logs. The exact ownership of the workdir across attempts is issue 9.
*   Tracker updates are recipe-driven: a recipe node decides whether to comment, close or change the tracker item. No implicit synchronisation.
*   UI: a tree list of Tasks and a Task detail page.

## 2. Why the scope exploded

The discussion started with a Task entity and two views. It then grew into:

*   a tracker provider abstraction with internal, GitHub and Jira parity;
*   external tracker versioning and content hashes;
*   a job state machine redesign;
*   the PR review lifecycle (`wait for merge`, request changes);
*   `recover` vs `terminate`, recipe snapshots and work preservation;
*   branch, workdir and commit ownership across attempts;
*   optional wait timeouts;
*   agent tools and approvals;
*   migration of existing projects and jobs.

Each item is valid. Together they are too much for one change. The ten issues below split them into deliverable pieces.

## 3. Settled

These are the current consensus. Do not reopen them while working on the issues below.

*   One tracker per project, chosen at creation. The internal tracker needs no external account.
*   Task is planning; Job is execution.
*   A Task can exist without a Job; a Task has at most one active Job.
*   A new execution attempt is a new Job with a new id. A Job can be paused and resumed; it cannot be restarted into a different attempt.
*   The JobRequest is generated at launch and stored in the Job. It is not a table and has no id of its own.
*   Branch and workdir names are task-scoped; one branch and one workdir per Task. Their lifetime and ownership are issue 9.
*   Chat is one way to create a Task, not the only one.
*   Tracker updates are recipe-driven.
*   The internal tracker is built first. GitHub and Jira adapters follow.
*   Task revision numbers are not needed for the job flow. Use `updatedAt` or a content hash only if an audit or concurrency case needs it.

## 4. Open questions (do not block slice 1)

*   Task state model: `open`/`closed` in v1, or a workflow (`todo`, `doing`, `done`, ...)?
*   `SUCCEEDED` meaning: recipe ended, or PR merged? For PR recipes the recommendation is to use `wait for merge`, so `SUCCEEDED` means merged.
*   New Job after `SUCCEEDED` or `REJECTED`: allowed when the Task has no active Job, or only after `TERMINATED`?
*   Workdir ownership: task-owned, or current-job ownership transferred on a new attempt?
*   Comments, attachments and an activity feed: v1 or later? Recommendation: later.
*   Provider switching and import of existing GitHub issues: not v1.

## 5. The ten issues

### 1. Make the project tracker mandatory and add the internal provider

**Problem.** A project can have no tracker, and there is no tracker that works without an external account. The planner needs exactly one tracker per project.

**Solution.**

1.  Add `internal` to the tracker providers.
2.  Require a tracker when a project is created. `account` is optional only for `internal`.
3.  The New Project wizard offers internal (default), GitHub, GitLab, Jira and Linear, and validates the selected account.
4.  Migrate existing projects with no tracker to `internal`.
5.  Show the tracker in project settings. Changing it is a separate migration, not part of this issue.

**Done when.**

*   The schema rejects a project without a tracker.
*   A new project can choose `internal` without any account.
*   Existing projects are migrated to `internal`.
*   Tests cover creation, migration and the wizard.
*   Design docs describe the required tracker.

### 2. Add the Task entity, storage and API

**Problem.** There is no internal planning entity, and no API to list, create or change a Task.

**Solution.**

1.  Task fields: ULID `id`, per-project `number`, `title`, `description`, `tags`, `parentId`, `state`, `branch`, `createdAt`, `updatedAt`, `archivedAt`.
2.  Project database tables `tasks` and `task_tags`. `number` is unique in the project and is never reused. A parent is in the same project and cycles are rejected.
3.  API: list (tree and filters), get, create, update, archive, delete.
4.  Emit `task.updated` for live UI updates.
5.  Task state: `open` and `closed` in v1; the linked Job state is shown separately. Archive is separate from closed.
6.  Delete is refused while the Task has Jobs; archive instead.

**Done when.**

*   Schema tests cover the number, parent and cycle rules.
*   API tests cover CRUD, archive, delete and live events.
*   The database migration exists.
*   Design docs describe the Task fields and states.

### 3. Add the Tasks UI

**Problem.** There is no place to see, create, organise, archive or delete Tasks.

**Solution.**

1.  `/tasks` list: project filter, parent/child tree, filters for state, tag, project and archived, and text search.
2.  `/tasks/:id` detail: edit title, description, tags, parent and state; show the linked Job, branch and PR; archive and delete.
3.  A Tasks tab on the project page.
4.  A New Task dialog. A Run task action follows issue 4.
5.  Empty, loading and disconnected states use the existing design system.

**Done when.**

*   App tests cover navigation, tree, filters, create, edit, archive and delete.
*   The project tab works and restores its view state.
*   The UI uses the existing components.

### 4. Create a Job from a Task with a generated JobRequest

**Problem.** Jobs can be created without a Task, so planning and execution are not linked. There is no single place where the JobRequest is generated.

**Solution.**

1.  Require a Task reference for every new Job. Reject orphan Jobs.
2.  Generate the JobRequest at launch from the Task, the user input, the recipe and the attachments. Store the request, the Task reference and a Task snapshot/hash in the Job.
3.  Add `Run task` and `New job from task`. The manual New job flow selects an existing Task or creates one first.
4.  Enforce at most one active Job per Task.
5.  For external Tasks, read or create the tracker item through the tracker port. External adapters follow in issue 10; internal works first.
6.  Existing Jobs without a Task keep a nullable reference. New Jobs require one.

**Done when.**

*   The API rejects a Job without a Task.
*   The Job stores the request, the Task reference and the Task snapshot/hash.
*   The UI flows create the Task first and then the Job.
*   A second active Job for the same Task is rejected.
*   Tests cover the internal flow and the legacy Jobs.

### 5. Give the Project Manager and Assistant Task tools

**Problem.** Chat cannot create or manage a Task, and `create_jobs` accepts an optional ticket id instead of requiring a Task.

**Solution.**

1.  Add `create_ticket`/`create_task`, `update_task` and `list_tasks`, or route the existing tracker tools to the internal provider.
2.  The Project Manager creates the Task in the project's tracker, then the Job. The Assistant discusses and delegates to the Project Manager.
3.  External tracker writes require confirmation. Internal writes are direct but audited.
4.  Treat Task and ticket content as untrusted in prompts. Scope every call to the project.
5.  `create_jobs` requires the Task reference.

**Done when.**

*   Tool tests cover create, update, list and routing to the internal provider.
*   The Project Manager flow creates a Task and then a Job.
*   External writes show the confirmation card.
*   A call outside the project is refused.
*   Prompt-injection handling is documented and tested.

### 6. Replace the job state machine

**Problem.** `failed` and `stopped` are both final and both resumable, `stop` overlaps with failure, and there is no clean distinction between a recoverable error and a closed attempt.

**Solution.**

1.  States: `queued`, `running`, `waiting`, `paused`, `error`, `succeeded`, `rejected`, `terminated`.
2.  Transitions:
    *   `queued` -> `running`, `paused`, `error`, `terminated`
    *   `running` -> `waiting`, `paused`, `error`, `succeeded`, `rejected`, `terminated`
    *   `waiting` -> `running`, `paused`, `error`, `terminated`
    *   `paused` -> `running`, `waiting`, `terminated`
    *   `error` -> `running` (recover), `terminated`
    *   `succeeded`, `rejected`, `terminated` are terminal.
3.  `error` is recoverable; `terminated` is closed. Remove `stop` and the resume of `failed`/`stopped`. Keep `play` for `paused`.
4.  Keep a reason for `queued`, `waiting`, `error`, `rejected` and `terminated`.
5.  Enforce one active Job per Task.

**Done when.**

*   State and transition tests pass.
*   The executor, API, UI controls and docs use the new states.
*   Existing jobs are migrated from `failed`/`stopped` to `error`/`terminated`.
*   `play` resumes only `paused`; `recover` is the only way out of `error` except termination.

### 7. Add `recover` for `error` jobs

**Problem.** A failure after hours of agent work cannot use a corrected recipe without losing the workdir and commits.

**Solution.**

1.  `recover` snapshots the current recipe and node definitions into the Job and restarts from Start. The workdir, branch, commits and uncommitted work stay.
2.  Add a recovery note to agent prompts: the workdir contains a previous attempt; inspect it, keep what is correct, fix or complete it, do not start from scratch unless necessary.
3.  Start new agent sessions. Keep the old logs, artifacts and attempts in history. Append `job.recovered`.
4.  `terminate` remains the clean path: a new Job with a new id, reset branch/workdir and a new JobRequest.
5.  `recover` uses the same JobRequest. Task changes require terminate and a new Job.

**Done when.**

*   The acceptance test passes: agent work for a while, a command fails, the recipe is corrected, `recover` keeps the work and the job succeeds.
*   The old logs and artifacts stay.
*   A task change is not picked up by `recover`; the UI says to terminate and start a new Job.
*   Docs describe recover vs terminate.

### 8. Add a `wait for merge` node and optional wait timeouts

**Problem.** A Job that opens a PR ends immediately, so review changes after `succeeded` cannot be handled by the same Job. A wait can hang forever.

**Solution.**

1.  Add a built-in wait node after delivery. It waits in `waiting` with reason `merge`, polls at the merge-check interval, and `play` or `check now` forces a check.
2.  Outcomes: `merged`, `changes_requested`, `closed`, `timeout`.
3.  `changes_requested` produces the review feedback and routes to the builder. `merged` goes to success. `closed` goes to `rejected`. `timeout` is routed by the recipe.
4.  Add an optional `waitTimeoutSec` to waiting nodes, with a `timeout` outcome. No default timeout. The UI shows units.
5.  PR recipes do not reach `succeeded` before the merge.

**Done when.**

*   A forge test or fake covers merge, request changes, close and timeout.
*   Request changes routes back to the builder in the same Job.
*   `play`/`check now` forces a check.
*   Timeout is optional and routed by the recipe.
*   Docs describe the node and its outcomes.

### 9. Define branch, workdir and commit lifecycle across attempts

**Problem.** Branch and workdir names are task-scoped, but their lifecycle is job-scoped. Archiving an old Job could delete the branch and workdir of the current Job. A new Job must reset commits without losing PR continuity.

**Solution.**

1.  Branch and workdir names are task-scoped; there is one of each per Task.
2.  Ownership belongs to the current Job. A new Job takes ownership and resets commits to the Task base.
3.  Archiving or deleting a non-current Job does not touch branch or workdir; it only removes its logs and metadata.
4.  Archiving the current Job after merge removes the workdir and branch and keeps the logs.
5.  Deleting the Task removes its resources. One active Job per Task is enforced.

**Done when.**

*   Lifecycle tests pass: archive an old Job and the current resources stay; start a new Job and the commits reset; logs stay.
*   The PR stays on the Task across attempts.
*   The cleanup rules are documented.

### 10. Add GitHub and Jira adapters behind the tracker port

**Problem.** A project can choose GitHub or Jira, but there is no unified create, read, update, comment and state adapter. External trackers have no portable version number.

**Solution.**

1.  Define a tracker port with list, get, create, update, comment and transition, plus capability flags.
2.  Add a GitHub adapter: issues, labels, state, comments, `updated_at` and ETag; a content hash for revision.
3.  Add a Jira adapter: issues, transitions, fields and comments; per-project mapping for the canonical state; ETag/`updated`.
4.  Route the Task UI and agent tools through the port. Do not keep a local shadow aggregate for external items; use a cache for lists and search.
5.  Gate the UI by capability. The parent tree appears only where the provider supports it.
6.  Keep provider-specific fields out of the Task.

**Done when.**

*   Contract tests cover both adapters.
*   Create, read, comment and state changes work on both.
*   Capability flags drive the UI.
*   No provider-specific field leaks into the Task.
*   Docs describe the port and the two adapters.

## 6. Suggested order

*   **Slice 1 — usable internal planner:** issues 1, 2, 3, 4.
*   **Slice 2 — execution lifecycle:** issues 6, 7.
*   **Slice 3 — chat:** issue 5.
*   **Slice 4 — delivery:** issues 8, 9.
*   **Slice 5 — external trackers:** issue 10.

Issue 5 can move earlier once issue 4 exists. The order is a proposal, not a rule.

## 7. Non-goals for now

*   Comments, attachments and an activity feed on internal Tasks.
*   Task revision numbers; use `updatedAt` or a content hash only when needed.
*   Switching a project's tracker after creation.
*   Importing existing GitHub or Jira items into the internal tracker.
*   Two-way comment synchronisation.
*   Multiple active Jobs per Task.
*   Multiple trackers per project.
*   Board/kanban, assignees, priorities, milestones and due dates.
*   Notifications for Task changes.
*   Auto-merge.
*   Cross-project Task parents.
*   Task sharing and export.
*   Full feature parity with GitHub or Jira.

## 8. Stop line

Build slice 1. Do not start issues 6 to 10 before issues 1 to 4 are merged and used. Do not add new design to this document; open an issue instead.
