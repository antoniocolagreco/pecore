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

## Connect a Git host

In **Settings > Accounts > Git hosting**, add or select the account for your provider. Use **Log in** for GitHub and GitLab, or sign in with their CLI before opening PeCore. Install `jq` for GitHub and GitLab delivery.

| Provider | Account setup | What the project can deliver |
|---|---|---|
| GitHub | Install `gh`. Use `gh auth login --hostname github.com --git-protocol https`. For Enterprise, use the same hostname in the CLI, account and repository URL. | Create a private repository or use an existing one. Push and open a PR. |
| GitLab | Install `glab`. Use `glab auth login --hostname gitlab.com --git-protocol https`. For self-managed GitLab, use your server hostname. | Create a private repository or use an existing one. Push and open an MR. |
| Private Git | Select Git, enter the server hostname and configure SSH or a Git credential helper. Confirm Git can access the repository with `git ls-remote <url>`. | Push a branch to an existing repository. |
| AWS CodeCommit | Install the AWS CLI. Select CodeCommit and enter an AWS profile with the repository's region and read and push access. Use the repository's HTTPS clone URL. | Push a branch to an existing repository. |

1. In **New project**, choose **Existing repository** or **New repository**. Select the **Forge account**, enter the repository URL and set the base branch, for example `main` or `dev`. You can also set the repository and account in an existing project's settings.
2. In the project's **Recipes** tab, add **Feature to PR** or **Bug Fix to PR**. Run a job with that recipe.
3. The recipe commits and runs **Git Push** with the project account. **Open PR** opens or updates the PR on GitHub and the MR on GitLab. On private Git and CodeCommit it verifies the pushed branch.

Use the supplied Repository nodes as they are. They select the project's Git hosting account. For a custom Repository node, select **Project account** or a specific account and supply a shell script. The script runs in an empty directory with inputs as JSON on stdin. In Project Manager chat, actions that write to the host ask for confirmation.

If a job stops at a Repository node, open that node's attempt log in **Jobs**. Check the CLI is on the app's `PATH`, the account matches the repository host and can push, and the base branch exists. After updating PeCore, start a new job to use the latest scripts. Existing jobs keep the scripts saved at creation.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
