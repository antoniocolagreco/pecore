set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
inputs=$(cat)
url=$(gh pr list --repo "$repo" --head "$PECORE_JOB_BRANCH" --json url --jq '.[0].url // empty')
if printf '%s\n' "$inputs" | jq -e 'has("document")' >/dev/null; then
  title=$(printf '%s\n' "$inputs" | jq -er '.document.title')
  if [ -n "$url" ]; then
    printf '%s\n' "$inputs" | jq -ej '.document.body' | gh pr edit "$url" --base "$PECORE_JOB_TARGET" --title "$title" --body-file - >/dev/null
    printf '%s\n' "$url"
  else
    printf '%s\n' "$inputs" | jq -ej '.document.body' | gh pr create --repo "$repo" --base "$PECORE_JOB_TARGET" --head "$PECORE_JOB_BRANCH" --title "$title" --body-file -
  fi
  exit 0
fi
if [ -n "$url" ]; then
  gh pr edit "$url" --base "$PECORE_JOB_TARGET" >/dev/null
  printf '%s\n' "$url"
else
  printf '%s\n' "$inputs" | jq -e '.spec' | gh pr create --repo "$repo" --base "$PECORE_JOB_TARGET" --head "$PECORE_JOB_BRANCH" \
    --title "$PECORE_JOB_TITLE" --body-file -
fi
