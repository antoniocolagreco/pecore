# Stage 8: Intermediate Zoom Out Report

*   **Target:** `docs/ui-design.md`, full file. Context: `docs/design.md` and the reports of stages 5-7.
*   **Reviewer:** egm-zoom-out, `zoom-out-standard.md`.
*   **Verdict:** 0 Blockers, 7 Majors, 9 Nits. The fixes added no scope beyond the product; the problems are seams between fixes, or between a fix and design.md.

## Major

| Id | Problem | Fix |
|---|---|---|
| M1 | Snapshot and hash cover only the Inbox detail: inline confirmations (wizard, editor, Library) are not bound to the snapshot; design.md does not say the confirmed hash comes from the snapshot | Inline confirmations use the same component and hash; design.md `confirm.ts`: items are immutable, a changed definition cancels the item and adds a new one; the confirmed hash is the subject's |
| M2 | Import runs `createRepo` from the archive during Create, before Confirm | Inline confirmation of `createRepo` in its Create task |
| M3 | Forge and service tool logins need a terminal, against design.md G16 | Run tool logins in the GUI like harness logins (device or web login), then recheck |
| M4 | First run step 1 requires every tool, so a user with one harness cannot pass it | Step 1 checks unconditional tools only; harness and forge CLI checks run when an account needs them |
| M5 | Choosing `PECORE_HOME` in the first run needs an engine already running on a home | The main process asks for the location before starting the engine |
| M6 | Pause enabled on `queued`, but design.md 4.1 has no such transition | Pause only on running and waiting; global pause holds queued jobs in the scheduler |
| M7 | A job blocked on a compose confirmation shows Waiting (`services`) | design.md 4.3: `confirmation` also covers compose file versions |

## Nit

1.  Realign missing from design.md G17, `jobs/controls.ts`, CLI; tooltip should say a waiting review is discarded.
2.  Export scans with gitleaks only when history is included.
3.  Starting recipe selection missing from `POST /projects` and `defaults.ts`.
4.  ID8 one item per limit needs a line in `budget.ts`; raising a per-job budget affects future jobs.
5.  ID7 should show which cap was hit (`maxRounds` or `maxNodeRuns`).
6.  `PECORE_HOME/themes/` missing from design.md section 2.
7.  "Agent user" vs design.md "project user" / "OS user".
8.  New notification kinds missing from design.md section 9.
9.  Implementation details in Cross-cutting (animation frame, 200 rows).

## Resolution

All findings need no author preference; all applied to `docs/ui-design.md` and `docs/design.md`.
