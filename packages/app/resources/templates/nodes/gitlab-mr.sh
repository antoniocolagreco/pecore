set -e
repo="$PECORE_PROJECT_REPO_URL"
if [ "$0" = gitlab-mr-probe ]; then
  requests=$(glab mr list -R "$repo" --source-branch "$PECORE_JOB_BRANCH" \
    --target-branch "$PECORE_JOB_TARGET" --output json)
  printf '%s\n' "$requests" | jq -r '.[0].web_url // empty'
  exit 0
fi

if [ "$0" != gitlab-mr ]; then
  url=$(jq -er '.url | strings | select(length > 0)' "$PECORE_INPUTS_DELIVERY_PATH")
  exec glab mr view "$url" -R "$repo" --output json
fi

requests=$(glab mr list -R "$repo" --source-branch "$PECORE_JOB_BRANCH" --output json)
id=$(printf '%s\n' "$requests" | jq -r '.[0].iid // empty')
if [ -n "$id" ]; then
  glab mr update "$id" --target-branch "$PECORE_JOB_TARGET" -R "$repo" >/dev/null
else
  description=$(cat "$PECORE_INPUTS_SPEC_PATH")
  glab mr create --source-branch "$PECORE_JOB_BRANCH" --target-branch "$PECORE_JOB_TARGET" \
    --title "$PECORE_JOB_TITLE" --description "$description" -R "$repo" --yes >/dev/null
fi
requests=$(glab mr list -R "$repo" --source-branch "$PECORE_JOB_BRANCH" \
  --target-branch "$PECORE_JOB_TARGET" --output json)
printf '%s\n' "$requests" | jq -er '.[0].web_url | strings | select(length > 0)'
