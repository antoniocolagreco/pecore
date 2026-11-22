set -e
folder="$PECORE_PARAMS_FOLDER"
[ -n "$folder" ]
case "$folder" in
  /*) ;;
  *) folder="./$folder" ;;
esac

entries=$(find "$folder/." ! -name . -prune -type f -name '*.md' ! -name '*.comments.md' -exec sh -ec '
  tab=$(printf "\t")
  cr=$(printf "\r")
  escape() {
    LC_ALL=C sed -e ":lines" -e "\$!N" -e "\$!b lines" \
      -e "s/\\\\/\\\\\\\\/g" -e "s/\"/\\\\\"/g" -e "s/\n/\\\\n/g" \
      -e "s/$tab/\\\\t/g" -e "s/$cr/\\\\r/g"
  }
  for path do
    filename="${path##*/}"
    id="${filename%.md}"
    title=$(sed -n "1{s/^#\\{1,6\\}[[:blank:]]\\{1,\\}//;p;}" < "$path")
    id_json=$(printf "%s\n" "$id" | escape)
    title_json=$(printf "%s\n" "${title:-$id}" | escape)
    printf ",{\"id\":\"%s\",\"title\":\"%s\"}\n" "$id_json" "$title_json"
  done
' sh {} +)
printf '[%s]\n' "${entries#,}"
