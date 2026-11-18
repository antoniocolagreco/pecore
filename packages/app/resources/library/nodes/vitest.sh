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
if [ -n "$PECORE_PARAMS_SUITE" ]; then
  exec npx --no-install vitest run --project "$PECORE_PARAMS_SUITE"
fi
exec npx --no-install vitest run
