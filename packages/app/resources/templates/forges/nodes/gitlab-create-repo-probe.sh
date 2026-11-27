set -e
if ! project=$(glab repo view "$PECORE_PROJECT_REPO_URL" --output json 2>&1); then
  case "$project" in
    *': 404 '*|*'404 Project Not Found'*) exit 0 ;;
    *) printf '%s\n' "$project" >&2; exit 1 ;;
  esac
fi
ref="refs/heads/$PECORE_PROJECT_BASEBRANCH"
expected=$(git --git-dir="$PECORE_PROJECT_REPODIR" rev-parse --verify "$ref")
remote=$(git ls-remote --refs -- "$PECORE_PROJECT_REPO_URL" "$ref")
if [ "${remote%%[[:space:]]*}" = "$expected" ]; then
  printf '%s\n' "$project" | jq -er '.web_url | strings | select(length > 0)'
fi
