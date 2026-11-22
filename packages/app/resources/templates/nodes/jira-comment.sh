set -e
acli jira workitem comment create --key "$PECORE_TICKET_ID" --body-file "$PECORE_COMMENT_PATH"
