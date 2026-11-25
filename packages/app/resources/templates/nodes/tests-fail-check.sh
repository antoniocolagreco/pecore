set -e
npx --no-install vitest --version >/dev/null

set -- run
if [ -n "$PECORE_PARAMS_SUITE" ]; then
  set -- "$@" --project "$PECORE_PARAMS_SUITE"
fi
if npx --no-install vitest "$@"; then
  exit 1
else
  [ "$?" -eq 1 ]
fi
