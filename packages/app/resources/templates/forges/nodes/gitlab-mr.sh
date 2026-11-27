set -eu
repo="$PECORE_PROJECT_REPO_URL"
draft=$(jq -ce '.pull_request')
case "$0" in
  *-merged)
    iid=$(printf '%s\n' "$draft" | jq -er '.url | capture("/(?<iid>[0-9]+)$").iid')
    exec glab mr view "$iid" -R "$repo" --output json
    ;;
  *-probe)
    requests=$(glab mr list -R "$repo" --source-branch "$PECORE_JOB_BRANCH" --target-branch "$PECORE_JOB_TARGET" --output json)
    printf '%s\n' "$requests" | jq -c --argjson draft "$draft" '
      .[0] | select(. and .title == $draft.title and ((.description // "") | rtrimstr("\n")) == ($draft.body | rtrimstr("\n"))) | $draft + {url: .web_url}'
    ;;
  *) exit 1 ;;
esac
