# Harness spike on Linux

Date: 2026-11-18. Arch Linux, kernel 7.2. Claude Code 2.1.327, codex-cli 0.169.0, opencode 2.3.0, agy 1.4.7.

This spike tested the non-interactive mode of each harness. The design later moved to ACP ([ACP spike](acp.md)); the login, auth and session cost findings still hold. Outputs are in `linux/fixtures/<harness>/`. Paths are rewritten to `/tmp/pecore-spike` and `/home/user`. In the Claude `init` events the lists `plugins`, `skills`, `slash_commands`, `agents` and `terminal_slash_commands` are emptied, because they held the author's private plugins.

Test prompt: "rispondi solo ok", model `sonnet` (Claude) or `gpt-6.2-sol` (Codex), effort `low`.

## Common findings

- Claude and Codex read stdin when it is not redirected. Claude waits 3 seconds and prints a warning. The engine must start every harness with stdin from `/dev/null`.
- A missing login is not reported the same way by any two harnesses. The engine should run the identity command before the first run of an account, and after an error that matches no rule (section 3.4 already says so).

## Claude Code

### Flags

| Need | Flags | Verified |
|---|---|---|
| run | `-p <prompt> --output-format stream-json --verbose --model <m> --effort <e>` | yes |
| full permission | `--dangerously-skip-permissions` | yes |
| new session with a known id | `--session-id <uuid>` | yes |
| resume | `--resume <uuid>` | yes, the model kept a number across 4 runs |
| structured output | `--json-schema '<schema>'`; the result event has `structured_output` | yes |
| lean | `--safe-mode`, optionally `--tools "Bash,Read,Edit,Write,Glob,Grep"` | yes |
| MCP | `--mcp-config <file>` with `--strict-mcp-config` | accepted with `--safe-mode`; not tested with a real server |
| identity | `claude auth status --json`, field `email`; also `loginExpiresAt`, `subscriptionType` | yes |
| models | no command; aliases `sonnet`, `opus`, `haiku`, `fable` or full ids | yes |
| efforts | `low`, `medium`, `high`, `xhigh`, `max` | from help |

On Linux the login is the file `$CLAUDE_CONFIG_DIR/.credentials.json`. No keyring is involved.

### Stream

Events: `system/init` (session id, tools, MCP servers), `assistant`, `rate_limit_event`, `result`. Hooks of the user's settings add `system/hook_*` events.

- `result.usage` counts only the current run.
- `result.total_cost_usd` is the total of the whole session. For a resumed run the cost of the attempt is the difference from the previous attempt.
- `rate_limit_event.rate_limit_info` gives `status` (`allowed` seen), `resetsAt` (epoch seconds), `rateLimitType`, and `unifiedWindows.five_hour` and `seven_day` with `utilization` (0 to 1) and `resetsAt`. The engine can read the remaining quota from every run without an extra command.

### Errors

- No login (empty config dir): exit 1 after about 1 second. The `assistant` event has `"error": "authentication_failed"`; the `result` event has `is_error: true` and `result: "Not logged in · Please run /login"`. Rule: `kind: auth`.
- Quota and rate limit: not provoked. The rule can rely on `rate_limit_event.status` other than `allowed`, with `resetsAt`. To confirm the first time it happens; until then, treat it as `other` (phase 0 fallback).

### Session cost

Tokens of a new session before any work. "Written" is cache creation, "read" is cache read.

| Flags | Tools | Input tokens | Written | Read | Cost of the first run | Cost of a repeat within 1 hour |
|---|---|---|---|---|---|---|
| author's full setup (6 MCP servers, 7 plugins, global CLAUDE.md) | 101 | 32,285 | 23,061 | 9,222 | $0.093 | $0.0033 |
| `--strict-mcp-config --setting-sources project --disable-slash-commands` | 22 | 17,998 | 9,397 | 8,601 | $0.038 | not measured |
| `--safe-mode` | 23 | 15,715 | 6,491 | 9,222 | $0.027 | $0.0016 |
| `--safe-mode --exclude-dynamic-system-prompt-sections` | 23 | 15,418 | 6,196 | 9,222 | $0.026 | not measured |
| `--safe-mode --tools "Bash,Read,Edit,Write,Glob,Grep"` | 6 | 7,871 | 2,665 | 5,206 | $0.011 | not measured |

A project user starts with an empty config dir, so its real cost is close to the `--safe-mode` row even without the flag. The flag still protects against plugins or settings added later.

`--safe-mode` also skips the repository's `CLAUDE.md`. Test: a `CLAUDE.md` saying "answer only PECORA"; with `--safe-mode` the answer was `ok`, without it `PECORA`.

Resumed session with `--safe-mode`, a 200-word answer per turn:

| Turn | Written | Read | Output | Cost of the turn |
|---|---|---|---|---|
| 1 (new) | 5,331 | 10,392 | 4 | $0.022 |
| 2 (resume) | 4,034 | 11,726 | 541 | $0.023 |
| 3 (resume) | 575 | 15,760 | 538 | $0.009 |
| 4 (resume) | 572 | 16,335 | 520 | $0.009 |

A resumed turn rereads the whole history from cache. The fixed part is paid once per hour, as long as the cache lives (1 hour).

## Codex

### Flags

| Need | Flags | Verified |
|---|---|---|
| run | `exec --json --skip-git-repo-check -m <m> -c model_reasoning_effort=<e> <prompt>` | yes |
| full permission | `--dangerously-bypass-approvals-and-sandbox` | from help only (see below) |
| resume | `exec resume --json <thread_id> <prompt>` | yes |
| structured output | `--output-schema <file>`; the final `agent_message` text is the JSON | yes |
| lean | `--ignore-user-config --ignore-rules` | yes |
| identity | `codex login status` says only `Logged in using ChatGPT` (exit 0) or `Not logged in` (exit 1). The email is the `email` claim of `tokens.id_token` in `auth.json`; the plan is `chatgpt_plan_type` in the claim `https://api.openai.com/auth` | yes |
| models and efforts | `codex debug models`: `.models[]`, keep `visibility == "list"`; efforts in `supported_reasoning_levels[].effort` (`low` to `max`, some models `ultra`) | yes |

The full-permission flag was not run here. This session's own safety rules blocked it; Codex did not refuse it. Measurements used `--sandbox read-only`, which does not change the prompt size.

### Stream

Events: `thread.started` (`thread_id`, used as session id), `turn.started`, `item.completed` (`agent_message`, `error`, tool items), `turn.completed` (`usage`), `turn.failed`, `error`.

`turn.completed.usage` seems to count the whole thread, not the turn. Turn 2 of a resumed thread reported 56,468 input tokens, about the sum of the first two prompts. The engine should store the difference from the previous attempt, like Claude's cost. To confirm in phase 3 with the fake harness fixtures.

### Errors

- No login (config dir with only `config.toml`): exit 1 after 18 seconds. Codex retries 5 times on WebSocket, falls back to HTTPS and retries 5 more times. Each retry is an `error` event with `401 Unauthorized`; the run ends with `turn.failed`. Rule: `kind: auth` on `401 Unauthorized` in `turn.failed`.
- The 18 seconds are lost on every run of a logged-out account. Running `codex login status` (under 1 second) before the first run of an account avoids them.
- Quota and rate limit: not provoked. Fallback `other`.

### Session cost

| Flags | Input tokens | Cached |
|---|---|---|
| author's setup (global `AGENTS.md` of 9 KB, 2 plugins, rules) | 26,933 | 7,296 |
| `--ignore-user-config --ignore-rules` | 20,756 | 7,296 |
| same plus `-c project_doc_max_bytes=0` | 20,756 | 7,296 |

Repeating the same run did not raise the cached part. A new Codex session costs about 21,000 tokens, 13,500 of them not cached.

Resumed turns (same thread, cumulative values as reported): turn 2 56,468 input of which 34,048 cached; turn 3 89,971 of which 63,360 cached.

## opencode

- Flags from help: `run --format json -m <provider/model#variant> --session <id> --auto <prompt>`. Effort is the `#variant` part of the model. `--auto` approves every permission not explicitly denied.
- Models: `opencode models`.
- No working login (the stored OpenAI login is expired): exit 1 at once, one event `{"type":"error","error":{"type":"provider.auth","message":"Request failed: 401"}}`. Rule: `kind: auth` on `error.type == "provider.auth"`.
- Not measured: stream of a successful run, session cost.

## Antigravity (agy)

- Flags: `-p <prompt> --output-format stream-json --model <m> --effort <e> --json-schema <schema> --conversation <id> --dangerously-skip-permissions --print-timeout <d>`.
- Models: `agy models`, one per line, id and label separated by a tab.
- Stream: `init` (`conversation_id`, tools), `step_update`, `result` (`status`, `response`, `usage`).
- Session cost with the default setup: 7,168 input tokens, none cached. 60 tools, including a browser.
- The Google login works without a subscription (free tier, `Gemini 3.8 Flash (High)` by default).

### Login storage: open problem

agy keeps the login in the desktop keyring (Secret Service, gnome-keyring here), not in a file.

- Empty `HOME`, desktop session available: the run works. The log says `You are not logged into Antigravity` for the file storage, then the token comes from the keyring.
- Empty `HOME`, no desktop session (`DBUS_SESSION_BUS_ADDRESS` unset): agy prints a Google login URL on stderr and writes `result` with `status: "ERROR"`, `error: "authentication failed or timed out"`. Then the process does not exit: `timeout 60` killed it (exit 124), even with `--print-timeout 40s`.

A project user reached through `sudo -H -u` has no desktop session. agy cannot run as a project user until a file login is found (same problem as the macOS Keychain). The engine must also kill agy on its own when `result.status` is `ERROR`.
