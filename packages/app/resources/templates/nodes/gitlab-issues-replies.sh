set -e
repo=$(jq -nr --arg repo "$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME" '$repo | @uri')
notes=$(glab api --hostname "${GITLAB_HOST:-gitlab.com}" --paginate "projects/$repo/issues/$PECORE_TICKET_ID/notes")
printf '%s\n' "$notes" | jq -s --arg since "$PECORE_PARAMS_SINCE" '
  def timestamp: sub("(?<seconds>:[0-9]{2})Z$"; "\(.seconds).000Z");
  [.[][] | select(.system == false and (.created_at | timestamp) > ($since | timestamp)) |
    {id: (.id | tostring), body: .body, author: .author.username, createdAt: .created_at}]
'
