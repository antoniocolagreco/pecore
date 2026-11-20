set -eu
export GIT_TERMINAL_PROMPT=0

target="refs/heads/$PECORE_JOB_TARGET"
remote_ref="refs/remotes/origin/$PECORE_JOB_TARGET"
git --git-dir="$PECORE_PROJECT_REPODIR" check-ref-format "$target"
git --git-dir="$PECORE_PROJECT_REPODIR" -c core.hooksPath=/dev/null -c core.fsmonitor=false \
  fetch --no-tags --no-recurse-submodules --no-write-fetch-head origin "+$target:$remote_ref" >&2

if git --git-dir="$PECORE_PROJECT_REPODIR" merge-base --is-ancestor "$PECORE_JOB_COMMIT" "$remote_ref"; then
  printf '%s\n' '{"state":"merged"}'
else
  [ "$?" -eq 1 ] || exit 1
  printf '%s\n' '{"state":"unmerged"}'
fi
