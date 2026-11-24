set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
inputs=$(cat)
if ! printf '%s\n' "$inputs" | jq -e 'has("document")' >/dev/null; then
  gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --base "$PECORE_JOB_TARGET" --json url --jq '.[0].url // empty'
else
  pr=$(gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --base "$PECORE_JOB_TARGET" --json url,title,body)
  printf '%s\n' "$inputs" "$pr" | jq -rs '
    .[0].document as $draft | .[1][0] | select(. and .title == $draft.title and .body == $draft.body) | .url'
fi
