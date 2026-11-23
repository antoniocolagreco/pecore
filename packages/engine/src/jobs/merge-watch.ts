export function startWatch(delayMs: () => number | null, check: () => Promise<void>): { stop(): void; wake(): void } {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let running = false;
  const wake = (): void => {
    if (stopped || running) return;
    if (timer) clearTimeout(timer);
    const ms: number | null = delayMs();
    if (ms === null) return;
    timer = setTimeout(() => {
      running = true;
      void check()
        .catch((e: unknown) => console.error("job watch:", e))
        .finally(() => {
          running = false;
          wake();
        });
    }, Math.max(0, ms));
  };
  wake();
  return {
    wake,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
