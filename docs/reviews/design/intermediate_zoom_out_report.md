# Stage 8: Intermediate Zoom Out Report

*   **Target:** `docs/design.md` (lines 1-935). FeatureRange 1-712, DetailedRange 713-935.
*   **Reviewer:** egm-zoom-out with `zoom-out-standard.md`, focused on the additions from Stages 6 and 7.
*   **Verdict:** Needs revision. 0 Blockers, 4 Majors, 5 Nits. First zoom-out pass resolved; settled decisions not re-raised.

## Major

*   **M1. Git network steps done by the engine outside nodes, with no stated credentials.** Push after repo creation (section 2), fetch on merge (4.6), clone (CUJ 6); nothing fetches before a job starts, so `baseBranch` goes stale. Fix: the repo creation node pushes the initial commit itself; clone and fetch become declared engine operations with the project account through `forge-env.ts`; fetch at job start.
*   **M2. Four separate confirmation flows.** Engine and source nodes, orchestrator recipe changes, import review, untrusted tickets; only one has a UI, untrusted tickets have no table. Fix: one queue, extending `human_queue` and `HumanQueue.tsx` with a `kind` column.
*   **M3. `pecore-fs` has no runtime or install location.** An AppImage FUSE mount is not readable by the project user. The real protection is running as the project user. Fix: use standard POSIX tools as the project user through `runners/process.ts`; no custom binary.
*   **M4. systemd user scope does not work for system users reached through `sudo env -i`; the sweep would kill the app user's session for app-user projects.** Fix: drop the scope; sweep with `sudo -n -u <user> kill -KILL -1` for dedicated users only.

## Nit

*   **N1.** The 60-second debounce adds little: base changes already apply after the running node ends. Drop it.
*   **N2.** `cleanCheckout` is a mitigation no shipped recipe or template uses. Set it on shipped test templates or call it opt-in.
*   **N3.** The `effects` table duplicates the probe that always runs first. Keep `effect.*` as events only; fix the Alternatives entry.
*   **N4.** Stash handling repeats the content-state restore and is too low-level for the spec.
*   **N5.** Use an existing ruleset (gitleaks default rules) for the export token scan.

## Resolution

All findings need no author preference; all were applied to `docs/design.md`.
