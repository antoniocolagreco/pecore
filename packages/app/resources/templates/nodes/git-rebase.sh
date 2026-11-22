set -e
head=$(git rev-parse HEAD)
changes=$(git status --porcelain)
if [ -n "$changes" ]; then
  git add -A
  if ! git commit --no-verify -m "pecore checkpoint"; then
    git reset --mixed "$head"
    exit 1
  fi
fi

if git rebase --onto "$PECORE_JOB_BASE" "$PECORE_JOB_OLDBASE"; then
  if [ -n "$changes" ] && [ "$(git log -1 --format=%s)" = "pecore checkpoint" ]; then
    git reset --mixed HEAD~1
  fi
else
  git rebase --abort || :
  git reset --mixed "$head"
  exit 1
fi
