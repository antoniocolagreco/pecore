set -e
repo=$(jq -nr --arg repo "$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME" '$repo | @uri')
issues=$(glab api --hostname "${GITLAB_HOST:-gitlab.com}" --paginate --method GET \
  "projects/$repo/issues" --raw-field state=opened --raw-field "labels=$PECORE_PARAMS_LABEL")
printf '%s\n' "$issues" | jq -s '[.[][] | {id: (.iid | tostring), title: .title}]'
