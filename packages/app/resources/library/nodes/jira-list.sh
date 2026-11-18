set -e
jql=$(jq -nr --arg label "$PECORE_PARAMS_LABEL" '"statusCategory != Done AND labels = \($label | @json)"')
items=$(acli jira workitem search --jql "$jql" --fields key,summary --paginate --json)
printf '%s\n' "$items" | jq '
  (if type == "array" then . else .issues end) |
  map({id: .key, title: (.fields.summary // .summary)})
'
