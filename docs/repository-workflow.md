# Repository workflow

## Shared branches

- `prod` is the default branch and holds the code approved for release.
- `dev` is the shared development branch. Start each task from the latest `origin/dev` and target `dev` in its pull request.
- Promote a release through a pull request from `dev` to `prod`.

## Task branches

Create one branch per fix, improvement or new feature. Keep its commits and pull request focused on that task. When people or agents work in parallel, give each task its own Git worktree or checkout and coordinate before editing the same files.

Use `<type>/<short-description>` with lowercase words separated by hyphens. Include the ticket ID before the description when there is one.

| Type | Use | Example |
| --- | --- | --- |
| `fix` | Fix a bug | `fix/chat-scroll-flicker` |
| `feat` | Add or improve a feature | `feat/project-repository-settings` |
| `refactor` | Change code structure while preserving behaviour | `refactor/project-settings-form` |
| `docs` | Update documentation | `docs/repository-workflow` |
| `test` | Change tests | `test/project-folder-rollback` |
| `ci` | Update CI workflows | `ci/run-linux-checks` |
| `chore` | Maintain dependencies or tooling | `chore/update-electron` |

## Issues

Write each issue in English with three sections:

- **Problem**: what the user sees or cannot do, with a concrete example.
- **Solution**: numbered points describing the expected behaviour, not the implementation.
- **Done when**: checks anyone can verify, including tests and docs to update.

Keep one fact per line and use short, common words. Leave out causes, code paths and proposed fixes unless the solution depends on them. Keep the issue as one clean text: to correct it, rewrite the body instead of adding a comment. Use the labels `bug`, `enhancement`, `ui`, `engine` and `idea` as they apply.

## Commits and pull requests

Use `<type>(<scope>): <summary>` for commits. Use the types above. The scope is optional and names the area changed. Write the summary in English using the imperative, for example `fix(chat): keep confirmation cards visible` or `docs: document the repository workflow`.

Open one pull request per task against `dev`. Describe what changed, link the ticket if there is one, and report the checks you ran and any failures or skips. Bring in the latest `dev` before merging if the pull request has conflicts.
