set -e
git add -A
if ! git diff --cached --quiet; then
  git commit -q --no-verify -m "$PECORE_JOB_TITLE"
fi
git rev-parse HEAD
