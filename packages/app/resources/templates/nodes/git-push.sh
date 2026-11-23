set -e
head=$(printf '%s\n' "$PECORE_PROBE_STDOUT" | sed -n 's/.*"head":[[:space:]]*"\([0-9a-f]*\)".*/x\1/p')
case "$head" in
  x*) head="${head#x}" ;;
  *) exit 1 ;;
esac
if [ -n "${PECORE_CI_EXPECTED_HEAD:-}" ] && [ "$head" != "$PECORE_CI_EXPECTED_HEAD" ]; then
  printf 'Remote head changed from %s to %s\n' "$PECORE_CI_EXPECTED_HEAD" "$head" >&2
  exit 1
fi

set --
if [ -n "${GH_TOKEN:-}${GH_ENTERPRISE_TOKEN:-}" ]; then
  set -- -c credential.helper= -c 'credential.helper=!gh auth git-credential'
elif [ -n "${GITLAB_TOKEN:-}" ]; then
  set -- -c credential.helper= -c 'credential.helper=!glab auth git-credential'
elif [ -n "${AWS_PROFILE:-}" ]; then
  set -- -c credential.helper= -c 'credential.helper=!aws codecommit credential-helper $@'
fi

git --git-dir="$PECORE_PROJECT_REPODIR" -c core.hooksPath=/dev/null "$@" \
  push --force-with-lease="refs/heads/$PECORE_JOB_BRANCH:$head" origin \
  "$PECORE_JOB_COMMIT:refs/heads/$PECORE_JOB_BRANCH"
printf '{"state":"same","head":"%s"}\n' "$PECORE_JOB_COMMIT"
