set -e
url=$(jq -er '.url | strings | select(length > 0)' "$PECORE_INPUTS_REFERENCE_PATH")
case "$0" in
*-probe)
  repo=$(jq -nr --arg repo "$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME" '$repo | @uri')
  notes=$(glab api --hostname "${GITLAB_HOST:-gitlab.com}" --paginate "projects/$repo/issues/$PECORE_TICKET_ID/notes")
  printf '%s\n' "$notes" | jq -rs --arg url "$url" \
    'select(any(.[][]; (.body | contains($url)))) | $url'
  ;;
*)
  glab issue note "$PECORE_TICKET_ID" -R "$PECORE_PROJECT_REPO_URL" --message "$url"
  ;;
esac
