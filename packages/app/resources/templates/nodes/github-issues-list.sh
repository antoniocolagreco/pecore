set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
issues=$(gh api --paginate --method GET "repos/$repo/issues" \
  --raw-field state=open --raw-field "labels=$PECORE_PARAMS_LABEL")
printf '%s\n' "$issues" | jq -s '[.[][] | select(has("pull_request") | not) |
  {id: (.number | tostring), title: .title}]'
