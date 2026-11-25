if [ -n "$PECORE_PARAMS_SUITE" ]; then
  exec npx --no-install vitest run --project "$PECORE_PARAMS_SUITE"
fi
exec npx --no-install vitest run
