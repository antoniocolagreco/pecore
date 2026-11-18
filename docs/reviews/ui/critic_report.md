# Stage 7: Critic Report (round 1)

*   **Target:** `docs/ui-design.md` (327 lines). Context: `docs/design.md`.
*   **Reviewers:** egm-design and egm-structural (`feature-spec-standard`), egm-style. All three completed.
*   **Verdict:** changes required. 4 Blockers (2 overlapping), 33 Majors (several overlapping), about 45 Nits.

## Blockers

| Id | Reviewer | Finding | Fix |
|---|---|---|---|
| design-1-B1, structural-1-B1 | design, structural | No Alternatives Considered section; UI2, UI7, UI9, UI10, UI17 state one path with no rejected options | Add the section: option, status, reason, what is lost |
| design-1-B2 | design | A confirmation can approve content different from what the user saw: the orchestrator can rewrite a node or recipe while the item is open; a base change can cancel an open review | Detail renders a snapshot from the queue item with its sha256; Confirm sends that hash and the engine refuses a mismatch; changed or cancelled items lock with a banner; design.md `POST /queue/:id` carries the hash |
| structural-1-B2 | structural | No Risks & Limits section (engine disconnect, large diffs and logs, many jobs, untrusted text rendering, accessibility) | Add a risk table and a Limits list |

## Major

| Id | Reviewer | Finding | Fix |
|---|---|---|---|
| structural-1-M1, design-1-M1 | structural, design | No Problem Statement, Goals, Non-Goals; non-goals scattered | Add them; move UI12 and the "no X" statements there |
| structural-1-M2 | structural | Section order; Layout overloaded; top bar under "Navigation (left)" | Reorder; own Top bar section; cross-cutting behaviour section |
| structural-1-M3 | structural | Tray, command palette and artifacts viewer have no layout | Add them |
| structural-1-M4, style-1-N30 | structural, style | Notifications and quiet hours, Appearance, Updates have no inventory id; Usage listed under Settings | Add ids; move Usage |
| structural-1-M5, design-1-M15 | structural, design | No empty, loading, disconnected states; WebSocket load and disconnect unspecified | Cross-cutting states; log subscriptions per open view; disconnected banner and refetch |
| structural-1-M6, design-1-M5 | structural, design | Import and export have no flow (CUJ 7) | "Import project" on Projects reusing wizard steps; export dialog with history option and gitleaks matches |
| structural-1-M7, design-1-M6, style-1-M9 | all | Wizard: home check missing; Confirm step not in design.md; "project exists only when every step succeeded" conflicts with later login and confirm pages; "step" means two things; no manual fallback for OS user creation | Pages vs tasks; project exists after Create; leftovers listed; guided procedure screen |
| design-1-M7 | design | Wizard misses app user option (marked risky), local-only, repo creation node choice, `name`, forge-specific delivery nodes | Add inputs; delivery nodes by forge |
| structural-1-M8, design-1-N1, style-1-M3 | all | Node run color rows overlap (routed fail outcomes, routed `stale`) | First-match order with routed outcomes first |
| design-1-M2, style-1-M1 | design, style | Inbox definition contradicts the agent-question exception; "confirmation queue" misnamed | Distinguish agent questions (design.md marker); exact definition |
| design-1-M3 | design | `auth` wait has no account or login type recorded; no GUI login for tool logins; no retry | design.md records account and type; show the command and "Recheck login" |
| design-1-M4 | design | ID2 fields wrong for `source` nodes; changed definitions have no diff | Field list per kind; diff against last confirmed version |
| design-1-M8 | design | First run order: login before account; no profiles and tiers; custom `PECORE_HOME` path not remembered; resume point undefined | Reorder; store home path in Electron `userData`; done-check per step |
| design-1-M9 | design | "Check" rule also matches `git-commit` | Checks = nodes named in some `requires`, or a node field |
| design-1-M10 | design | Chat cards, unread state, notification history have no storage | design.md: chat actions table, `last_read_at`, notification log |
| design-1-M11 | design | Remote leftovers shown on a deleted job | Store per project; show on project page |
| design-1-M12 | design | No control-by-state rules; Realign "at any time" conflicts with design.md; delete has no confirmation | State-by-control matrix; delete confirmation listing what is removed |
| design-1-M13 | design | Editor and orchestrator can overwrite each other | Save with expected hash; "changed on disk" banner; warn when a node used by live jobs is edited |
| design-1-M14 | design | Recipe node positions have no storage | Author decision: auto layout, positions in the recipe file, or a sidecar file |
| design-1-M16 | design | Round limit and budget items do not say what the user enters | Input, default, which limit, where persisted, one item per limit |
| design-1-M17 | design | Repo, forge account, OS user listed as editable after creation | Read-only after creation |
| style-1-M2 | style | Source column mixes reference kinds; citation format not followed | One format |
| style-1-M4 | style | Prototype "for look only" but the list includes layout | Reword |
| style-1-M5 | style | UI5 "static" and "slow" conflict | Fixed gradient, no animation |
| style-1-M6 | style | UI2 "where it helps", UI12 "not in the way" cannot be checked | Name the screens; checkable rule |
| style-1-M7 | style | UI13 "content only" vague | List what the filter applies to |
| style-1-M8 | style | UI15 holds four rules | Split |
| style-1-M10 | style | "(delivery nodes)" wrong; source nodes are not in recipes | Reword |

## Nits

Summarised; full text in the reviewer reports of this session.

*   **structural:** metadata (author, links); concepts brief link; citation style; heading names; IA4 and IA3 sources; UI1 row; heading markers; `bg` tied to one theme; Inbox items with no job.
*   **style:** "engine" and "live" overloaded; "Needs you" wordings; spend vs cost; capitalisation; token names; UI3, UI6, UI7, UI8, UI11, UI17 wording; tooltips; ID2 hash; IF2 wording; back edge undefined; Inbox list; Library filter; node editor wording; job ids are ULIDs; quota claim; first run wording; status line.
*   **design:** disk wait before start; accessibility (not color alone, 3:1, theme schema, `themes/` in design.md); live log format; Factory counters and filter; title prefill needs a REST read; project deletion; draft storage; instantiate name conflicts; chip references need project and template or instance.

## Questions for the author

1.  design-1-M14: recipe node positions. Auto layout only, positions saved in the recipe file, or a sidecar file?
2.  design-1-M12: should Stop ask for confirmation, like Delete?
3.  design-N8: project deletion. Add it, or list it as a non-goal?
