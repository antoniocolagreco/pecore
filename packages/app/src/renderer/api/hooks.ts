import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveMessage } from "@pecore/schemas";
import { ApiError } from "@pecore/schemas";
import { onLive, useConnected } from "./live";

export type Data<T> = { data: T | undefined; error: Error | null; loading: boolean; reload(): void };

export function useData<T>(load: () => Promise<T>, deps: unknown[], refreshOn?: (m: LiveMessage) => boolean): Data<T> {
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  const connected = useConnected();
  const reload = useCallback(() => {
    const n = ++seq.current;
    load().then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error: Error) => n === seq.current && setState((s) => ({ data: s.data, error, loading: false })),
    );
  }, deps);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    reload();
  }, [reload]);
  useEffect(() => {
    if (connected) reload();
  }, [connected, reload]);
  useEffect(() => {
    if (!refreshOn) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onLive((m) => {
      if (!refreshOn(m) || timer) return;
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, 250);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [reload]);
  return { ...state, reload };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): { run(...args: A): Promise<boolean>; busy: boolean; error: string | null; clear(): void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (...args: A) => {
    setBusy(true);
    setError(null);
    try {
      await fn(...args);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, clear: () => setError(null) };
}
