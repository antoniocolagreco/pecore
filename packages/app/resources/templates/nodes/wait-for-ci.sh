set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

commit=$(jq -er '.sha | strings | select(test("^[0-9a-fA-F]{40}$"))' "$PECORE_INPUTS_COMMIT_PATH") || fail 'CI needs a saved commit SHA'
url=$(jq -er '.url | strings | select(length > 0)' "$PECORE_INPUTS_DELIVERY_PATH") || fail 'CI needs a pull or merge request URL'
url=${url%/}
request=${url##*/}
case "$request" in
  ''|*[!0-9]*) fail 'Invalid pull or merge request number' ;;
esac

github_status() {
  head=$(gh pr view "$request" --repo "$repo" --json headRefOid --jq '.headRefOid') || return 0
  if [ "$head" != "$commit" ]; then printf '%s\n' changed; return 0; fi
  checks=$(gh pr checks "$request" --repo "$repo" --json name,bucket) || :
  head=$(gh pr view "$request" --repo "$repo" --json headRefOid --jq '.headRefOid') || return 0
  if [ "$head" != "$commit" ]; then printf '%s\n' changed; return 0; fi
  printf '%s\n' "$checks" | jq -r '
    if type != "array" or length == 0 then "pending"
    elif any(.[]; .bucket == "fail" or .bucket == "cancel") then "failed"
    elif all(.[]; .bucket == "pass" or .bucket == "skipping") and any(.[]; .bucket == "pass") then "success"
    else "pending" end'
}

gitlab_status() {
  mr=$(glab mr view "$request" -R "$PECORE_PROJECT_REPO_URL" --output json) || return 0
  printf '%s\n' "$mr" | jq -r --arg commit "$commit" '
    if (.sha // "") == "" then "pending"
    elif .sha != $commit then "changed"
    elif .head_pipeline.sha != $commit then "pending"
    else .head_pipeline.status // "pending" end'
}

case "$url" in
  */pull/"$request")
    [ -n "${GH_HOST:-}" ] || fail 'A GitHub account is required to check this pull request'
    repo="$GH_HOST/$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
    status_command=github_status
    ;;
  */-/merge_requests/"$request")
    [ -n "${GITLAB_HOST:-}" ] || fail 'A GitLab account is required to check this merge request'
    status_command=gitlab_status
    ;;
  *) fail 'CI needs a GitHub pull request or GitLab merge request' ;;
esac

interval=30
deadline=$(($(date +%s) + 1800))
while [ "$(date +%s)" -lt "$deadline" ]; do
  status=$($status_command) || status=pending
  remaining=$((deadline - $(date +%s)))
  [ "$remaining" -gt 0 ] || break
  case "$status" in
    success) printf 'CI passed for %s\n' "$commit"; exit 0 ;;
    failed|canceled|skipped) fail "CI $status for $commit" ;;
    changed) fail "The request no longer targets commit $commit" ;;
  esac
  if [ "$remaining" -lt "$interval" ]; then sleep "$remaining"; else sleep "$interval"; fi
done
fail "CI did not finish within 30 minutes for $commit"
