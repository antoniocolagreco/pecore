# ACP change: targeted review

Date: 2026-11-18. Target: the parts of `docs/design.md` changed by the move from harness manifests to ACP (sections 2, 3.4, 5, 6, 8, Fixed choices, Connector file, data model, tests, `packages/agents`, build order). Reviewers, each in a fresh context: `egm-design` (architecture) and `egm-implementation-readiness` (phase 3). Both checked the design against `docs/spikes/acp.md` and the fixtures in `packages/agents/fixtures/`.

Verified by hand before applying: setting `model` changes `effort` in the Claude Code traffic; Codex offers `reasoning_effort` and `agent-full-access`; Codex counts cached tokens inside `inputTokens`; the plan sits in `accounts[]._meta.claudeCode.plan`; `ENABLE_CLAUDEAI_MCP_SERVERS=false` removes the claude.ai MCP servers (`claude -p`, 101 tools to 53).

| Finding | Severity | Done in design.md |
|---|---|---|
| Project user cannot run the app user's harness and Node; GUI-launched app lacks the shell `PATH` | Blocker | 5.7: lookup order with `programPaths` and the login shell; traverse ACLs on the path; `checkPrerequisites` as the target user; `DISABLE_AUTOUPDATER=1`; Claude Code `versionRange` as a lower bound |
| claude.ai account MCP connectors join agents' sessions | Blocker | 5.6, section 8, Risks: `ENABLE_CLAUDEAI_MCP_SERVERS=false`; phase 0 check |
| Copied adapter cannot resolve its dependencies under pnpm | Blocker | Fixed choices: Adapters: `build-adapters.mjs` with `npm install --prefix`, version file, pruning |
| Engine and agents contract undefined (`spawn`, `prompt`, `close`) | Blocker | 5.1: typed interface; agents builds argv and connector env, the engine adds user variables |
| End of a turn not defined | Blocker | 5.4: ordered decision list; retry rules |
| Identity cannot be checked; logins are per account and OS user | Blocker / Major | 3.4, 5.9: login = account and OS user; `email` on model accounts; `checkLogin` return type; API `/logins`; `auth_os_user` |
| Domain boundary leaks (config files, env, Keychain) | Major | 5.1 rule; `prepareLogin` returns files the engine writes through `fs-as.ts`; Keychain steps in the connector file |
| Resume unverified, no fallback, orchestrator cwd | Major | 5.5, section 6: resume order, fallback to a new session, fixed chat directory, one message at a time; phase 0 resume fixture |
| Quota contradictions, `allowed_warning`, quota text before output validation | Major | 5.3, 5.4: only `rejected`; classification order; Open Questions and Risks reworded |
| No timeout before the prompt; start-up blocked by `checkLogin` | Major | 5.2: 30 seconds per request; `main.ts` runs `checkLogin` after `ready` |
| Config options order; wrong Codex example | Major | 5.2, Connector file: ordered list with `currentValue` check; Codex example from the traffic |
| Usage double-counted or incomplete; cost baseline | Major | 5.3: four fields, side models, budget formula, cost only for new sessions |
| Adapter version hardcoded in an editable file | Major | 5.6, Connector file: built-in files read from the app; `{adapter:<package>}` |
| Connector files run commands without confirmation | Major | 5.6, section 8: confirmation queue kind `connector`; no orchestrator tool writes them |
| pgid through sudo on fd 3 | Major | Fixed choices: Process groups: pid on the first stderr line; group leader settled in phase 0 |
| Terms risk not backed by the cited spike | Major | `spikes/acp.md` Terms with quotes; Risks row names the release decision |
| Timeouts in two places; retry semantics | Major | 3.4, 5.4, 5.5: node `timeoutSec` only; retry rules |
| Tests not writable as described; fake agent undefined | Major | Tests: `expected.json`, synthetic fixtures, `agent.test.ts`, fake agent script format |
| Event mapping, raw log format, stderr, MCP token in the log | Major / Nit | 5.2, section 9, `acp/client.ts` |
| Login flow (URL, code on stdin, per platform) | Major | 5.9, Connector file, API |
| Smaller points: attempt id, version sources, `resetFormat`, price keys, local day, orchestrator ACLs, `connectors/` in git, permission without `allow_once`, `cancelled` | Nit | applied in the matching rows |

Not applied, for the author: whether to ship a Node runtime instead of requiring Node 22; whether to use up a 5-hour window on purpose to record a real quota error; whether the Usage screen shows Claude Code's remaining quota (`ui-design.md`).
