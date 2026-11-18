set -e
set --
if [ -n "${GH_TOKEN:-}${GH_ENTERPRISE_TOKEN:-}" ]; then
  set -- -c credential.helper= -c 'credential.helper=!gh auth git-credential'
elif [ -n "${GITLAB_TOKEN:-}" ]; then
  set -- -c credential.helper= -c 'credential.helper=!glab auth git-credential'
elif [ -n "${AWS_PROFILE:-}" ]; then
  set -- -c credential.helper= -c 'credential.helper=!aws codecommit credential-helper $@'
fi

remote=$(git --git-dir="$PECORE_PROJECT_REPODIR" -c core.hooksPath=/dev/null "$@" \
  ls-remote origin "refs/heads/$PECORE_JOB_BRANCH")
head=$(printf '%s\n' "$remote" | sed -n 's/[[:space:]].*//p')
if [ -z "$head" ]; then
  state=absent
elif [ "$head" = "$PECORE_JOB_COMMIT" ]; then
  state=same
else
  state=other
fi
printf '{"state":"%s","head":"%s"}\n' "$state" "$head"
