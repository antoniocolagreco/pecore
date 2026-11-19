export function startMergeWatch(everySec: () => number, check: () => Promise<void>): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void check()
        .catch((e: unknown) => console.error("merge watch:", e))
        .finally(next);
    }, everySec() * 1000);
  };
  next();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
