set -e
[ -n "$PECORE_PARAMS_FOLDER" ]
case "$PECORE_TICKET_ID" in
  */*|*.comments) exit 1 ;;
esac
path="$PECORE_PARAMS_FOLDER/$PECORE_TICKET_ID.md"
tab=$(printf '\t')
cr=$(printf '\r')
escape() {
  LC_ALL=C sed -e ':lines' -e '$!N' -e '$!b lines' \
    -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\n/\\n/g' \
    -e "s/$tab/\\\\t/g" -e "s/$cr/\\\\r/g"
}

title=$(sed -n '1{s/^#\{1,6\}[[:blank:]]\{1,\}//;p;}' < "$path")
title_json=$(printf '%s\n' "${title:-$PECORE_TICKET_ID}" | escape)
body=$(escape < "$path")
printf '{"title":"%s","body":"%s","author":null,"labeledBy":null,"attachments":[]}\n' "$title_json" "$body"
