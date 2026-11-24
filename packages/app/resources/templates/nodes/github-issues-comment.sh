set -e
repo="$PECORE_PROJECT_REPO_OWNER/$PECORE_PROJECT_REPO_NAME"
gh issue comment "$PECORE_TICKET_ID" --repo "$repo" --body-file -
