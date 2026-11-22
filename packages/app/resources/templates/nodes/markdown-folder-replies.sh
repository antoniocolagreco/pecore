set -e
[ -n "$PECORE_PARAMS_FOLDER" ]
case "$PECORE_TICKET_ID" in
  */*|*.comments) exit 1 ;;
esac
comments="$PECORE_PARAMS_FOLDER/$PECORE_TICKET_ID.comments.md"
if [ ! -f "$comments" ]; then
  printf '[]\n'
  exit 0
fi

tab=$(printf '\t')
since=$(printf '%s\n' "$PECORE_PARAMS_SINCE" | sed 's/\..*//; s/[^0-9]//g')
printf '['
separator=''
while IFS="$tab" read -r created body; do
  stamp=$(printf '%s\n' "$created" | sed 's/[^0-9]//g')
  if [ "$stamp" -gt "${since:-0}" ]; then
    printf '%s{"body":"%s","author":null,"createdAt":"%s"}' "$separator" "$body" "$created"
    separator=','
  fi
done < "$comments"
printf ']\n'
