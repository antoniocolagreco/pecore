# Agent SDK and ACP spike

Date: 2026-11-18. Linux. Claude Code 2.1.327, `@anthropic-ai/claude-agent-sdk` 0.3.327, `@agentclientprotocol/sdk` 2.8.0, `claude-agent-acp` 0.108.0, `@agentclientprotocol/codex-acp` 2.7.0, opencode 2.3.0.

Question: can PeCore keep a session open with an agent, send several messages, approve tool permissions itself, and read tokens, quota and login errors, using the user's subscription?

Recorded traffic: `packages/agents/fixtures/<connector>/`. Paths are rewritten, the email is `user@example.com`, and the lists of the author's plugins, agents and commands are emptied. Scripts: `acp/client.mjs` (the ACP client, run as `node client.mjs <log> <command> [args]`, with `TURNS` and `OPTS` in the environment) and `acp/agent-sdk-test.mjs`.

## Claude Agent SDK

- The SDK starts the Claude Code binary as a subprocess and talks to it over stdin and stdout. The binary reads the login from its config directory; the SDK makes no API call itself.
- The npm package ships its own Claude Code binary (`claude-agent-sdk-linux-x64`, 356 MB). `pathToClaudeCodeExecutable` uses an installed one instead. Both read the same config directory, so they share the login.
- Test with the author's Pro login, no API key: `apiKeySource: "none"`, answers came back.
- `canUseTool` received the `Write` call with path and content and approved it.
- A second message, sent through the same streaming input, went to the same session and process. The model remembered the file written in turn 1.
- `spawnClaudeCodeProcess` lets the caller start the process itself, for example through `sudo -H -u`. Not tested.
- With `settingSources: []` the account's claude.ai MCP connectors still joined in turn 2 (28 tools, then 76). `strictMcpConfig` should stop that; not tested.

## ACP

ACP (Agent Client Protocol) is JSON-RPC 2.0 over stdin and stdout, one message per line. Zed uses it for its external agents. Zed's public registry lists an ACP command for Claude Code (`claude-agent-acp`, built on the Agent SDK), Codex (`codex-acp`), opencode (`opencode acp`), Copilot CLI (`--acp`), Gemini CLI (`--acp`), pi (`pi-acp`) and Antigravity (`agy-acp-server`, from Google).

One client of about 80 lines, without the ACP library, ran unchanged against Claude Code, Codex and opencode.

### Flow

1. `initialize`: the agent returns its name, version, login methods and capabilities (resume, load, close, fork, MCP transports).
2. `session/new` with `cwd` and `mcpServers`: returns the session id and the options. Claude: `mode`, `model`, `effort`, `fast`. Codex: one model list where effort is part of the id (`gpt-6.2-sol[low]`). opencode: `model`, `effort`, `mode`.
3. `session/set_config_option` sets mode, model and effort. Verified with Claude.
4. `session/prompt` for each message. The agent streams `session/update` notifications and answers the request when the turn ends.

### What PeCore gets

| Need | Claude Code | Codex | opencode |
|---|---|---|---|
| several messages in one session | yes (2 turns) | not tested | not tested |
| tokens per turn | yes, in the `session/prompt` answer: `usage` with input, output, cache read and write | yes, same field | not reached (no login) |
| session cost | yes, `usage_update.cost`, total of the session | no | not reached |
| quota left and reset time | yes, `usage_update._meta._claude/rateLimit` (5-hour and 7-day windows, `resetsAt` in epoch seconds) | no | not reached |
| permission requests | yes, in mode `default`: `session/request_permission` with the command and the options `allow_once`, `allow_always`, `reject_once` | not seen: the author's Codex config allowed the command | not reached |
| account and plan | yes, during `session/new`, before any prompt, in two forms: `auth/status_update` and `_auth/status_update` (email, plan); without a login `{"state":"unauthenticated"}` and `{"authStatus":{"kind":"none","label":"Not logged in"}}` | yes, `_auth/status_update` (email, plan), during `session/new`; without a login: not tested | not reached |
| missing login | JSON-RPC error `-32000` "Authentication required" on `session/prompt` | not tested | same code, "Authentication required: provider authentication required" |

The Claude session took `mode: auto` and the model from the author's settings. PeCore must set mode, model and effort explicitly for every session.

`_meta` fields (`_claude/rateLimit`, `quota`) are extensions of each adapter, not part of the protocol. Their shape can change with an adapter release.

## Terms

Sources read on 2026-11-18: [Claude Code, Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [The Register, 2026-02-20](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access). Quotes:

- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Developers building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider."
- "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users."
- "Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
- "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription [...]"
- "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- Agent SDK overview: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits [...] including agents built on the Claude Agent SDK."
- Consumer terms, section 3.7, as quoted by The Register: no access "through automated or non-human means, whether through a bot, script, or otherwise", "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it".

Reading: PeCore fits the allowed case of an end user signing in to the unmodified Claude Code binary, provided it never handles tokens. No text names a program that drives Claude Code for its user. Not a legal opinion.

## claude.ai MCP servers

With the author's login, `claude -p` listed the account's claude.ai MCP servers (Claude Docs, Google Drive, Google Calendar, Gmail) among 101 tools. With `ENABLE_CLAUDEAI_MCP_SERVERS=false` they were gone (53 tools; the rest came from the author's own plugins and MCP config, which a project user does not have). Not yet checked through the ACP adapter.

## Open points

- Run an adapter as the project user (`sudo -H -u`) with a per-account config directory.
- Quota and rate limit errors: not provoked; Codex sends no quota data over ACP.
- Structured output: ACP has no schema option. The node prompt asks for JSON and PeCore validates it.
- Antigravity ACP: not tested; its login lives in the desktop keyring ([Linux spike](linux-harnesses.md)).
- Codex permission requests with a config that asks for approval.
