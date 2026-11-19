set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
if ! url=$(gh repo view "$repo" --json url --jq .url 2>&1); then
  case "$url" in
    *'Could not resolve to a Repository'*) exit 0 ;;
    *) printf '%s\n' "$url" >&2; exit 1 ;;
  esac
fi
branch=$(jq -nr --arg branch "$PECORE_PROJECT_BASEBRANCH" '$branch | @uri')
if result=$(gh api "repos/$repo/branches/$branch" --silent 2>&1); then
  printf '%s\n' "$url"
else
  case "$result" in
    *'HTTP 404'*) exit 0 ;;
    *) printf '%s\n' "$result" >&2; exit 1 ;;
  esac
fi
