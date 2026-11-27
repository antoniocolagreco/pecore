set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
if ! url=$(gh repo view "$repo" --json url --jq .url 2>&1); then
  case "$url" in
    *'Could not resolve to a Repository'*) exit 0 ;;
    *) printf '%s\n' "$url" >&2; exit 1 ;;
  esac
fi
ref="refs/heads/$PECORE_PROJECT_BASEBRANCH"
expected=$(git --git-dir="$PECORE_PROJECT_REPODIR" rev-parse --verify "$ref")
remote=$(git ls-remote --refs -- "$PECORE_PROJECT_REPO_URL" "$ref")
if [ "${remote%%[[:space:]]*}" = "$expected" ]; then
  printf '%s\n' "$url"
fi
