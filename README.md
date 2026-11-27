# <PE/CORE>

<PE/CORE> (Product Engineering Core) is a desktop software factory. It runs recipes with agent, human, command and repository steps. It uses your existing Claude Code, Codex, OpenCode and Pi logins. Agent steps can also read or update tracker issues when granted access.

Status: in development. The design is in [docs/design.md](docs/design.md) and the UI in [docs/ui-design.md](docs/ui-design.md). Install and first-run instructions come with the first release.

## Run from source on Linux

Requirements: Linux, Node.js 24, pnpm, git.

```sh
pnpm install
pnpm dev
```

## Build and check

```sh
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

Tests run under Electron's Node, so `better-sqlite3` is built once, for Electron.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
