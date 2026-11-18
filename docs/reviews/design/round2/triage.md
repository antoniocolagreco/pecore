# Round 2 review: triage

Date: 2026-11-18. Reports in this folder, from a full EGM run (stages 5 to 9) by GPT through Codex.

Rule: apply now only blockers and majors that touch phases 0 to 3 (Claude Code, normal mode, local project), plus leftovers of the old per-project OS user. Everything else goes to Open Questions with the phase that needs it. No more full EGM runs; at most one targeted review before each phase, on the sections that phase uses.

## Now

| # | Finding | Source | Fix |
|---|---|---|---|
| N1 | Phase 3 gate cannot run: `feature` needs a second provider and a GitHub PR | zoom 8, comprehension blocker, IR 1-2, intermediate 5 | a shipped `local-feature` recipe (one provider, ends at the commit); phase 3 gate uses it |
| N2 | Local project creation undefined (`repo: null`) | comprehension, intermediate 5 | `repo: null`: `git init`, empty commit on `baseBranch`, no `createRepo`, no fetch, no forge account |
| N3 | Phase gates use things built later | IR 1-2 | phase 1 validates only templates present in phase 1; phase 2 creates its local project through `projects/` local path (moved from phase 4) |
| N4 | Phase 0 spike inputs and process readiness | IR 1-1 | spike uses the adapter from `npm install` and system Node; `Spawn` resolves after the pid line (protected) or at once (normal); stop before readiness kills by pid |
| N5 | Stale `.pecore/output.json` reused by a later attempt | design 1-6, intermediate 2 | the engine deletes `.pecore/output.json` before every turn |
| N6 | `-32000` read as auth for any error | design 1-7 | auth only when the message says "Authentication required" or the connector's error data says `authentication_failed` |
| N7 | Raw ACP lines have no path to the engine | IR 1-8 | `Session.raw` stream of lines (JSON-RPC and stderr); engine writes it; redaction in the agents package |
| N8 | Existing fixtures lack the `at` field | codebase 1-6, zoom 12 | test loader accepts lines without `at`; plan lists the five existing files |
| N9 | Approval and checks can cover a different tree | design 1-1, intermediate 1 | approval and each required check record the content state; commit gate requires the commit tree to equal it |
| N10 | Archived job and resume contradict | comprehension | archive is final: an archived job cannot resume |
| N11 | Queued jobs after a crash | style 1-8 | queued jobs stay queued; G12 says so |
| N12 | Job-state diagram vs rules | structural 1-2 | add `paused → waiting`, finals from `paused` |
| N13 | Budget with parallel attempts | design 1-9 | checked at attempt start; overshoot of at most the attempts already running |
| N14 | Protected mode: agents can read all protected logins | design 1-4 | state it in 3.4, section 8 and Risks |
| N15 | Leftovers of the per-project OS user | comprehension, structural 1-1, codebase 1-10 | `design.md` 4.5, 4.8, import, container alternative, decision history (D9, D26), wizard page list |

## Later

| Finding | Source | Phase |
|---|---|---|
| Shared `refs/stash` across jobs | zoom 1, design 1-2, intermediate 2 | 4 (rebase) |
| Push and repo creation probes (`unknown`, initial push, observed head) | zoom 2, comprehension, IR 1-3, intermediate 3 | 4 |
| Auth vs network failures for forge commands | design 1-8 | 4 |
| Compose allowlist; one owner for service shutdown | design 1-3, intermediate 4, style 1-7 | 4 |
| Protected repo permissions (`config`, `hooks/`) and mode switch with running jobs | codebase 1-2, intermediate OS boundary | 4 |
| Confirmation store and hash inputs; run the checked bytes | zoom 6, IR 1-7 | 4 |
| Forge-specific choices in the engine | zoom 5 | 4 |
| Slots held while waiting for the forge | zoom 7 | 4 |
| Stacked jobs: merge target, queued child base, merge watch after failure | design 1-5, comprehension, intermediate major 1 | 4 |
| Bugfix recipe: prove the test fails first | zoom 9 | 4 |
| Prerequisites checked only for the feature that needs them | zoom 10 | 4 |
| Project creation wait, cancel, retry | comprehension, IR 1-9 | 4 |
| Renderer `/live` cannot send a Bearer header; typed GUI operations | IR 1-5 | 5 |
| `run/api.json` owner | style 1-7 | 5 |
| Ticket intake crash safety; no-source projects | zoom 4, design 1-10, comprehension | 6 |
| Agent questions: how an agent creates one | comprehension | 6 |
| Image orders to the model | design 1-11 | 6 |
| Protected orchestrator restart with MCP token | intermediate OS boundary | 6 |
| macOS Keychain and gate criteria | IR 1-10 | macOS pass |
| Exact file list, package manifests, versions | IR 1-4 | decided in code, phase by phase |
| Data model payloads, ids, nullability | codebase 1-5 | decided in code (phase 1 Zod types) |

## Not applied

Wording findings with no effect on the build: style 1-1, 1-2, 1-3, 1-5, 1-7, 1-10, 1-11, 1-12, 1-13, 1-9 (IR); structural 1-3; zoom 11.
