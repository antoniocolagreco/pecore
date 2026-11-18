set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
if ! url=$(gh repo view "$repo" --json url --jq .url 2>&1); then
  case "$url" in
    *'Could not resolve to a Repository'*) url=$(gh repo create "$repo" --private) ;;
    *) printf '%s\n' "$url" >&2; exit 1 ;;
  esac
fi
git --git-dir="$PECORE_PROJECT_REPODIR" -c core.hooksPath=/dev/null \
  -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  push "$PECORE_PROJECT_REPO_URL" "refs/heads/$PECORE_PARAMS_BRANCH"
printf '%s\n' "$url"
