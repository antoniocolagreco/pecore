set -e
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  yarn install --frozen-lockfile
elif [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

set -- run
if [ -n "$PECORE_PARAMS_SUITE" ]; then
  set -- "$@" --project "$PECORE_PARAMS_SUITE"
fi
if npx --no-install vitest "$@"; then
  exit 1
else
  [ "$?" -eq 1 ]
fi
