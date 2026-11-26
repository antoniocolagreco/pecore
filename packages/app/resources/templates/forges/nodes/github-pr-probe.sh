set -eu
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
draft=$(jq -ce '.pull_request')
pr=$(gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --base "$PECORE_JOB_TARGET" --json url,title,body)
printf '%s\n' "$pr" | jq -c --argjson draft "$draft" '
  .[0] | select(. and .title == $draft.title and ((.body // "") | rtrimstr("\n")) == ($draft.body | rtrimstr("\n"))) | $draft + {url: .url}'
