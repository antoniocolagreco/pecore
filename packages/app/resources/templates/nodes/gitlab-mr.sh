set -eu
repo="$PECORE_PROJECT_REPO_URL"
draft=$(jq -ce '.pull_request')
if [ "$0" = gitlab-mr-merged ]; then
  url=$(printf '%s\n' "$draft" | jq -er '.url')
  exec glab mr view "$url" -R "$repo" --output json
fi
if [ "$0" = gitlab-mr-probe ]; then
  requests=$(glab mr list -R "$repo" --source-branch "$PECORE_JOB_BRANCH" --target-branch "$PECORE_JOB_TARGET" --output json)
  printf '%s\n' "$requests" | jq -c --argjson draft "$draft" '
    .[0] | select(. and .title == $draft.title and ((.description // "") | rtrimstr("\n")) == ($draft.body | rtrimstr("\n"))) | $draft + {url: .web_url}'
  exit 0
fi
