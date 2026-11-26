import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useViewHistory } from "./ViewHistoryProvider";

export const restorePageScroll = { restorePageScroll: true };

export function usePageScroll<T extends HTMLElement = HTMLDivElement>(scope = "page", anchor?: string | null, anchorReady = true) {
  const page = useRef<T>(null);
  const content = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const history = useViewHistory().scroll;

  useLayoutEffect(() => {
    const viewport = page.current;
    if (!viewport) return;
    const { key, pathname, search, hash, state } = location;
    const entry = JSON.stringify([key, pathname, scope]);
    const path = JSON.stringify([pathname + search + hash, scope]);
    const restoreRecent = (state as typeof restorePageScroll | null)?.restorePageScroll === true;
    const target = history.entries.get(entry) ?? (restoreRecent ? history.recent.get(path) : undefined);
    let pending: boolean = true;
    let resize: ResizeObserver | null = null;
    let mutations: MutationObserver | null = null;

    const remember = (): void => {
      if (pending) return;
      const position = { top: viewport.scrollTop, left: viewport.scrollLeft };
      history.entries.set(entry, position);
      history.recent.set(path, position);
    };
    const finish = (): void => {
      pending = false;
      resize?.disconnect();
      mutations?.disconnect();
      remember();
    };
    const restore = (): void => {
      if (!pending) return;
      if (!target && anchor) {
        if (!anchorReady) return;
        const section = document.getElementById(anchor);
        if (section && viewport.contains(section)) section.scrollIntoView?.({ block: "start" });
        finish();
        return;
      }
      const { top, left } = target ?? { top: 0, left: 0 };
      viewport.scrollTop = top;
      viewport.scrollLeft = left;
      if (Math.abs(viewport.scrollTop - top) < 1 && Math.abs(viewport.scrollLeft - left) < 1) finish();
    };
    const scrollKeys = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (scrollKeys.has(event.key)) finish();
    };

    restore();
    if (pending && target) {
      resize = new ResizeObserver(restore);
      resize.observe(viewport);
      if (content.current) resize.observe(content.current);
      else {
        mutations = new MutationObserver(restore);
        mutations.observe(viewport, { childList: true, subtree: true });
      }
    }
    viewport.addEventListener("scroll", remember, { passive: true });
    viewport.addEventListener("wheel", finish, { passive: true });
    viewport.addEventListener("pointerdown", finish);
    viewport.addEventListener("keydown", onKeyDown);
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
      viewport.removeEventListener("scroll", remember);
      viewport.removeEventListener("wheel", finish);
      viewport.removeEventListener("pointerdown", finish);
      viewport.removeEventListener("keydown", onKeyDown);
    };
  }, [location, history, scope, anchor, anchorReady]);

  return { page, content };
}
