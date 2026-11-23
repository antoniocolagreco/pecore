import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveMessage } from "@pecore/schemas";
import { ApiError, appName } from "@pecore/schemas";
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

const saveDelayMs = 600;

export function useAutoSave<T>(remote: Data<{ value: T; sha256: string }>, put: (body: { value: T; baseSha256: string }) => Promise<{ sha256: string }>, valid: (value: T) => boolean = () => true) {
  const [local, setLocal] = useState<T>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown: T | undefined = local ?? remote.data?.value;
  const latest = useRef<T | undefined>(shown);
  latest.current = shown;
  const sha = useRef<string | undefined>(undefined);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef<T | undefined>(undefined);
  useEffect(() => {
    if (!remote.data || inFlight.current || remote.data.sha256 === sha.current) return;
    const first: boolean = sha.current === undefined;
    sha.current = remote.data.sha256;
    if (first) return;
    setLocal(undefined);
  }, [remote.data]);
  const commit = (value: T): Promise<boolean> => {
    inFlight.current += 1;
    setSaving(true);
    const write: Promise<boolean> = writes.current.then(async () => {
      try {
        const result = await put({ value, baseSha256: sha.current ?? "" });
        sha.current = result.sha256;
        setError(null);
        return true;
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 409) {
          sha.current = undefined;
          setLocal(undefined);
          remote.reload();
          setError(`Changed elsewhere, so ${appName} loaded the new version. Make your last change again.`);
        } else setError(errorText(failure));
        return false;
      } finally {
        inFlight.current -= 1;
        if (!inFlight.current) setSaving(false);
      }
    });
    writes.current = write;
    return write;
  };
  const flush = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const value: T | undefined = waiting.current;
    waiting.current = undefined;
    if (value !== undefined && valid(value)) void commit(value);
  };
  const flushOnLeave = useRef(flush);
  flushOnLeave.current = flush;
  useEffect(() => () => flushOnLeave.current(), []);
  return {
    value: shown, current: remote.data?.value, reload: remote.reload, saving, commit, error,
    update(change: T | ((value: T) => T)): void {
      if (latest.current === undefined) return;
      const value: T = typeof change === "function" ? (change as (value: T) => T)(latest.current) : change;
      latest.current = value;
      setLocal(value);
      waiting.current = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, saveDelayMs);
    },
  };
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
