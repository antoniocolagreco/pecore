set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
url=$(jq -er '.reference.url | strings | select(length > 0)')
case "$0" in
*-probe)
  comments=$(gh issue view "$PECORE_TICKET_ID" --repo "$repo" --json comments --jq '.comments')
  printf '%s\n' "$comments" | jq -r --arg url "$url" \
    'select(any(.[]; (.body | contains($url)))) | $url'
  ;;
*)
  gh issue comment --repo "$repo" "$PECORE_TICKET_ID" --body "$url"
  ;;
esac
