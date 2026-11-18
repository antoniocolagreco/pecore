set -e
issue=$(glab issue view "$PECORE_TICKET_ID" -R "$PECORE_PROJECT_REPO_URL" --output json)
repo=$(jq -nr --arg repo "$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME" '$repo | @uri')
iid=$(printf '%s\n' "$issue" | jq -er '.iid')
labeled_by=null
if events=$(glab api --hostname "${GITLAB_HOST:-gitlab.com}" --paginate "projects/$repo/issues/$iid/resource_label_events"); then
  labeled_by=$(printf '%s\n' "$events" | jq -cs --arg label "$PECORE_PARAMS_LABEL" '
    [.[][] | select(.label.name == $label)] |
    max_by(.id) | if .action == "add" then .user.username else null end
  ')
fi
printf '%s\n' "$issue" | jq --argjson labeledBy "$labeled_by" '{
  title: .title, body: (.description // ""), author: .author.username, labeledBy: $labeledBy, attachments: []
}'
