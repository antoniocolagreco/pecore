set -e
body=$(cat && printf .)
acli jira workitem comment create --key "$PECORE_TICKET_ID" --body="${body%.}"
