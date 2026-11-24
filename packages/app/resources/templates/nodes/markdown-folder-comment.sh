set -e
[ -n "$PECORE_PARAMS_FOLDER" ]
case "$PECORE_TICKET_ID" in
  */*|*.comments) exit 1 ;;
esac
ticket="$PECORE_PARAMS_FOLDER/$PECORE_TICKET_ID"
[ -f "$ticket.md" ]
tab=$(printf '\t')
cr=$(printf '\r')
body=$(LC_ALL=C sed -e ':lines' -e '$!N' -e '$!b lines' \
  -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\n/\\n/g' \
  -e "s/$tab/\\\\t/g" -e "s/$cr/\\\\r/g")
created=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
printf '%s\t%s\n' "$created" "$body" >> "$ticket.comments.md"
