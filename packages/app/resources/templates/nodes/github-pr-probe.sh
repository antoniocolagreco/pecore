set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
if [ -z "${PECORE_INPUTS_DOCUMENT_PATH:-}" ]; then
  gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --base "$PECORE_JOB_TARGET" --json url --jq '.[0].url // empty'
else
  pr=$(gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --base "$PECORE_JOB_TARGET" --json url,title,body)
  printf '%s\n' "$pr" | jq -r --slurpfile draft "$PECORE_INPUTS_DOCUMENT_PATH" '
    .[0] | select(. and .title == $draft[0].title and .body == $draft[0].body) | .url'
fi
