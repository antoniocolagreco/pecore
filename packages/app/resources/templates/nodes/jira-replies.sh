set -e
comments=$(acli jira workitem comment list --key "$PECORE_TICKET_ID" --paginate --json)
printf '%s\n' "$comments" | jq --arg since "$PECORE_PARAMS_SINCE" '
  def text: if type == "object" then [.. | objects | select(.type == "text") | .text] | join("\n") else . // "" end;
  def instant:
    capture("^(?<time>[^.]+?)(?<fraction>\\.[0-9]+)?(?<zone>Z|[+-][0-9]{2}:?[0-9]{2})$") |
    ((.time + "Z") | fromdateiso8601) + (("0" + (.fraction // "")) | tonumber) -
    (.zone | if . == "Z" then 0 else
      sub(":"; "") | ((.[1:3] | tonumber) * 3600 + (.[3:5] | tonumber) * 60) *
      (if startswith("-") then -1 else 1 end)
    end);
  (if type == "array" then . else .comments end) |
  [ .[] | select($since == "" or (.created | instant) > ($since | instant)) |
    {id: (.id | tostring), body: (.body | text), author: .author.accountId, createdAt: .created} ]
'
