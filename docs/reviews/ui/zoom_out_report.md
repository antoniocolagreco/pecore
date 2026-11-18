# Stage 5: Zoom Out Report

*   **Target:** `docs/ui-design.md` (lines 1-265), whole file as FeatureRange; no implementation section.
*   **Context:** `docs/design.md`.
*   **Reviewer:** egm-zoom-out, `zoom-out-standard.md`.
*   **Verdict:** 0 Blockers, 10 Majors, 9 Nits. The screen set fits the product; most problems are gaps between the UI and the engine model.

## Major

| Id | Location | Problem | Fix |
|---|---|---|---|
| M1 | Job states table; A2; UI12 | `waiting` with reason `auth` and `queued` with reason `parent_failed` need the user but are shown as grey Waiting or Queued | Show both as "Needs you", with a link to the action (project Logins, parent's controls); say whether the Inbox count includes them |
| M2 | Factory; UI13 | The Factory counter counts `human_queue` items, the state label counts jobs; several jobs can wait on one confirmation, some items have no job; no lookup from a job waiting for `confirmation` to its item | Different labels or the same count in both; design.md records the blocking queue item id on the node run |
| M3 | C9; job view header | Realign only next to a "base changed" notice, but design.md relies on manual realign exactly when nothing was detected | Realign in the per-job controls (C3); the notice stays as a hint |
| M4 | Job result view | "Whether it is merged": `merged_at` is set only for succeeded jobs with children, so most merged jobs would show "not merged" | Show "Merged" only when `merged_at` is set, otherwise nothing; or design.md runs `mergedCheck` on every delivered job |
| M5 | Inventory B and C | No "New job" action, though `POST /jobs` exists and the CLI has no job-create command | Add a "New job" form (project, recipe, ticket, base branch, parent), or state that jobs come only from the orchestrator and drop `POST /jobs` |
| M6 | Orchestrator; Settings; A3 | The orchestrator's OS user login and profile have no screen after first run; no unread signal for its replies or questions | Orchestrator section in Settings (profile, OS user, login); unread badge on nav and mini chat; notification on reply |
| M7 | New project wizard | Repo creation and the instantiated delivery nodes are engine nodes that need confirmation; the wizard does not say so, and setup stops on Inbox items | Show the confirmation inside the wizard step; final step confirms the project's engine and source nodes; same inline confirmation in the node editor |
| M8 | Job states table; C5 | Node run states have no labels or colours | Add a "Node run states shown" table, using `failOutcomes` and `successOutcomes` |
| M9 | Navigation; UI9; C4 | Jobs page has no layout; stacks are trees (one parent each), so a separate dependency graph view adds little | Write the Jobs layout; stacks as indented collapsible rows; revise UI9 unless the author wants the graph; Factory list shows only non-final jobs |
| M10 | design.md `packages/app` table | The two documents list different screens | After approval, update design.md's screen table; note it in the status line |

## Nit

| Id | Problem | Fix |
|---|---|---|
| N1 | UI5 allows animated gradients, UI6 allows animation only on live state | Drop the option or make it a named exception |
| N2 | `status-running` is amber, the same as `accent` | Separate hue for running, or another accent |
| N3 | "Ask the AI" duplicates the mini chat chip; conversation list both in the page and in the mini chat | "Ask the AI" opens the mini chat; mini chat has current and new conversation only; say whether the chip follows navigation |
| N4 | Settings: `pollSec` is per project; missing prices, project paths, disk threshold, harness manifests, auto-update | Move `pollSec` to the project; add the missing entries |
| N5 | Home permission check and identity mismatch have no UI | Add to Missing configuration, linked from engine status |
| N6 | "Rerun the first run" undefined once `PECORE_HOME` exists | "Recheck prerequisites" with links |
| N7 | A3 misses the ticket-intake notification; tray not in the inventory; content of the in-app notification list undefined | Add them, or drop the list |
| N8 | "Resume interrupted jobs" is play, not resume; needs a stored pause reason; "check node" undefined; D1 should order by risky hunks | "Play interrupted jobs"; define check node; risky hunks first |
| N9 | UI1 dead row; prototype section placement and link; recipe editor template mode; implementation detail in UI6 | Housekeeping |

## Notes from the author's side (Elephant)

*   N9: the prototype is at `docs/pecore_concept_offline.html`, not at the repo root as the reviewer says.
