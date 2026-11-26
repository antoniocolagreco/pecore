import { useCallback, useLayoutEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useLocation, useNavigationType } from "react-router";
import type { restorePageScroll } from "./usePageScroll";
import { useViewHistory } from "./ViewHistoryProvider";

export function useViewState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation();
  const navigationType = useNavigationType();
  const history = useViewHistory().state;
  const path = location.pathname;
  const key = JSON.stringify([location.key, path, name]);
  const recentKey = JSON.stringify([path + location.search + location.hash, name]);
  const restoreRecent = (location.state as typeof restorePageScroll | null)?.restorePageScroll === true;
  const read = (previous?: { path: string; name: string; value: T }): T => {
    if (history.entries.has(key)) return history.entries.get(key) as T;
    if (restoreRecent && history.recent.has(recentKey)) return history.recent.get(recentKey) as T;
    if (navigationType === "REPLACE" && previous?.path === path && previous.name === name) return previous.value;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  };

  const [state, setState] = useState(() => ({ key, path, name, value: read() }));
  if (state.key !== key) setState({ key, path, name, value: read(state) });
  useLayoutEffect(() => {
    history.entries.set(state.key, state.value);
    history.recent.set(recentKey, state.value);
  }, [history, recentKey, state]);

  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => setState((current) => {
    if (current.key !== key) return current;
    const value = typeof update === "function" ? (update as (previous: T) => T)(current.value) : update;
    return Object.is(value, current.value) ? current : { ...current, value };
  }), [key]);
  return [state.value, set];
}
