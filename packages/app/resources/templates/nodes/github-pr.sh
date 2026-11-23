set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
url=$(gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --json url --jq '.[0].url // empty')
if [ -n "${PECORE_INPUTS_PULL_REQUEST_PATH:-}" ]; then
  title=$(jq -er '.title' "$PECORE_INPUTS_PULL_REQUEST_PATH")
  body="$PECORE_WORKDIR/pr-body.md"
  jq -ej '.body' "$PECORE_INPUTS_PULL_REQUEST_PATH" > "$body"
  if [ -n "$url" ]; then
    gh pr edit "$url" --base "$PECORE_JOB_TARGET" --title "$title" --body-file "$body" >/dev/null
    printf '%s\n' "$url"
  else
    gh pr create --repo "$repo" --base "$PECORE_JOB_TARGET" --head "$PECORE_JOB_BRANCH" --title "$title" --body-file "$body"
  fi
  exit 0
fi
if [ -n "$url" ]; then
  gh pr edit "$url" --base "$PECORE_JOB_TARGET" >/dev/null
  printf '%s\n' "$url"
else
  gh pr create --repo "$repo" --base "$PECORE_JOB_TARGET" --head "$PECORE_JOB_BRANCH" \
    --title "$PECORE_JOB_TITLE" --body-file "$PECORE_INPUTS_SPEC_PATH"
fi
