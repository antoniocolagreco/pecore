set -e
item=$(acli jira workitem view "$PECORE_TICKET_ID" --fields summary,description,reporter,attachment --json)
printf '%s\n' "$item" | jq '
  def text: if type == "object" then [.. | objects | select(.type == "text") | .text] | join("\n") else . // "" end;
  .fields | {
    title: .summary, body: (.description | text), author: .reporter.accountId,
    labeledBy: null, attachments: [(.attachment // [])[] | .content]
  }
'
