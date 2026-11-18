set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
issue=$(gh issue view "$PECORE_TICKET_ID" --repo "$repo" --json number,title,body,author)
number=$(printf '%s\n' "$issue" | jq -er '.number')
labeled_by=null
if events=$(gh api --paginate "repos/$repo/issues/$number/events"); then
  labeled_by=$(printf '%s\n' "$events" | jq -cs --arg label "$PECORE_PARAMS_LABEL" '
    [.[][] | select(.label.name == $label and (.event == "labeled" or .event == "unlabeled"))] |
    max_by(.id) | if .event == "labeled" then .actor.login else null end
  ')
fi
printf '%s\n' "$issue" | jq --argjson labeledBy "$labeled_by" '{
  title: .title, body: .body, author: .author.login, labeledBy: $labeledBy, attachments: []
}'
