set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
comments=$(gh api --paginate "repos/$repo/issues/$PECORE_TICKET_ID/comments")
printf '%s\n' "$comments" | jq -s --arg since "$PECORE_PARAMS_SINCE" '
  def timestamp: sub("(?<seconds>:[0-9]{2})Z$"; "\(.seconds).000Z");
  [.[][] | select((.created_at | timestamp) > ($since | timestamp)) |
    {id: (.id | tostring), body: .body, author: .user.login, createdAt: .created_at}]
'
