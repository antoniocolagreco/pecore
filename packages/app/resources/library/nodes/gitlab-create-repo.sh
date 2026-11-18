set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
if ! project=$(glab repo view "$PECORE_PROJECT_REPO_URL" --output json 2>&1); then
  case "$project" in
    *': 404 '*|*'404 Project Not Found'*) glab repo create "$repo" --private --skipGitInit >/dev/null ;;
    *) printf '%s\n' "$project" >&2; exit 1 ;;
  esac
  project=$(glab repo view "$PECORE_PROJECT_REPO_URL" --output json)
fi
url=$(printf '%s\n' "$project" | jq -er '.web_url | strings | select(length > 0)')
git --git-dir="$PECORE_PROJECT_REPODIR" -c core.hooksPath=/dev/null \
  -c credential.helper= -c 'credential.helper=!glab auth git-credential' \
  push "$PECORE_PROJECT_REPO_URL" "refs/heads/$PECORE_PARAMS_BRANCH"
printf '%s\n' "$url"
