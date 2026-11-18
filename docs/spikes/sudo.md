# Claude Code through sudo spike

Date: 2026-11-18. Arch Linux, sudo 1.9.17p2, Claude Code 2.1.327, `@agentclientprotocol/claude-agent-acp` 0.108.0, Node v26.13.1 (LTS, from nodejs.org, SHA-256 checked).

Question: does the "Claude Code through sudo" check of `design.md` (Tests) pass, and is the pid on the first stderr line the leader of its process group?

Setup: the commands of `design.md` (Fixed choices: Protected user, Linux; Sudo rule; ACLs). Adapter and Node in `~/.pecore-spike/adapters/` (mode 755), cwd `~/.pecore-spike/work/` with an ACL `rwx` for `pecore-agent`, traverse ACL on `/home/ac`. Login with `claude auth login --claudeai` as `pecore-agent`, `CLAUDE_CONFIG_DIR=/home/pecore-agent/.pecore-harness/spike`. Client: `sudo/client.mjs` (`node client.mjs <config.json> <log>`). Recorded traffic: `packages/agents/fixtures/claude-code/protected-{new,resume,stop}.jsonl`, in the raw log format with `at`; email and paths rewritten.

## Results

| Check | Result |
|---|---|
| adapter, shipped Node and the user's Claude Code run as `pecore-agent` | yes; `id -un` gives `pecore-agent`; reading `/home/ac/.claude.json` gives "Permission denied" |
| new config directory, one login | yes; `.credentials.json` mode 0600 in it |
| session in `bypassPermissions` | yes; `session/set_config_option` `mode`, the SDK `init` message says `permissionMode: bypassPermissions`; a shell command and a file write ran with no permission request |
| resume in a new process | yes; `session/resume` with the old session id, the model recalled the word written in the previous process |
| no claude.ai MCP servers | yes, with `ENABLE_CLAUDEAI_MCP_SERVERS=false` |
| no repository `.mcp.json` servers | only with `strictMcpConfig` (below) |
| first stderr line pid leads its group | no: the group is sudo's; yes with `setsid` (below) |
| stopping the group stops the harness | yes: `TERM` to the group ended the adapter, `claude` and the shell commands it ran; a process the agent detached itself survived (below) |

## MCP servers

Without options, the SDK `init` message of a session listed the repository's `.mcp.json` server (`source: project`, started: its process was a child of `claude`), the user's own servers (`source: user`) and plugin servers. `_meta.claudeCode.options.strictMcpConfig: true` in `session/new` (and `session/resume`) adds `--strict-mcp-config`: `mcp_servers: []`. Servers passed in the ACP `mcpServers` field still apply. Side effect in normal mode: the user's own MCP servers and plugin servers are dropped too.

With `CLAUDE_CODE_EXECUTABLE` set, the adapter passes the ACP `mcpServers` to `claude` on its command line (`--mcp-config`, adapter `claude-cli.js`, `mcpServersDelivery`). Any local user can read a command line in `/proc`, so a token in an MCP server's headers or env is visible to them.

## Process groups

With `!use_pty` and `detached: true`, sudo is the group leader: the pgid is sudo's pid, and the pid on the first stderr line is a member. `kill -s TERM -<pgid>` as `pecore-agent` still worked (it reaches the processes it may signal), but the recorded pid is not the pgid.

`sudo -n -H -u <user> -- /usr/bin/setsid /bin/sh -c 'echo "PECORE_PID $$" >&2; exec env -i "$@"' sh ...` makes the shell the leader of a new session and group: `setsid` does not fork, because sudo's child is not a group leader, so the printed pid is the pgid. Verified with `ps`: pid = pgid = sid. macOS has no `setsid` command: to settle in the macOS pass.

Claude Code runs each shell command in its own session (`zsh -c ...`, own pgid). On `TERM` it ends those itself: a running `sleep 120` was gone after the stop. A command the agent put in the background with `&` was reparented to init and kept running after the stop; only `kill -KILL -1` as `pecore-agent` ended it. That command is the app-start and app-quit sweep of `design.md`, which also kills every other job's processes, so it cannot run on a single job stop.

## Other findings

- `usermod -aG pecore-agent <app user>` takes effect at the app user's next login. Until then `chgrp pecore-agent` by the app user fails ("Operation not permitted"), so the group step of "Turning protected mode on" fails right after the admin prompt.
- `npm install --prefix out/adapters/@agentclientprotocol/claude-agent-acp@0.108.0` fails with ENOENT on `package.json`: npm does not create a nested prefix. Create the directory first, or use a name without the scope.
- `useradd --create-home` made `/home/pecore-agent` mode 755: the app user and every other local user can list it. The credential files are 0600.
- Claude Code as `pecore-agent` uses `/usr/bin/zsh` for shell commands and writes shell snapshots into the config directory.
