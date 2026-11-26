set -e
if ! project=$(glab repo view "$PECORE_PROJECT_REPO_URL" --output json 2>&1); then
  case "$project" in
    *': 404 '*|*'404 Project Not Found'*) exit 0 ;;
    *) printf '%s\n' "$project" >&2; exit 1 ;;
  esac
fi
repo=$(jq -nr --arg repo "$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME" '$repo | @uri')
branch=$(jq -nr --arg branch "$PECORE_PROJECT_BASEBRANCH" '$branch | @uri')
if result=$(glab api --hostname "${GITLAB_HOST:-gitlab.com}" "projects/$repo/repository/branches/$branch" 2>&1); then
  printf '%s\n' "$project" | jq -er '.web_url | strings | select(length > 0)'
else
  case "$result" in
    *'HTTP 404'*|*'404 Branch Not Found'*) exit 0 ;;
    *) printf '%s\n' "$result" >&2; exit 1 ;;
  esac
fi
