import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";

const positions = new Map<string, number>();
const recentPositions = new Map<string, number>();
export const restorePageScroll = { restorePageScroll: true };

export function usePageScroll() {
  const page = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const { key, pathname, search, hash, state } = useLocation();
  const path: string = pathname + search + hash;
  const restoreRecent: boolean = (state as { restorePageScroll?: boolean } | null)?.restorePageScroll === true;

  useLayoutEffect(() => {
    const viewport: HTMLDivElement | null = page.current;
    const inner: HTMLDivElement | null = content.current;
    if (!viewport || !inner) return;
    const target: number = positions.get(key) ?? (restoreRecent ? recentPositions.get(path) : undefined) ?? 0;
    let pending: boolean = true;
    let resize: ResizeObserver | null = null;

    const remember = (): void => {
      if (pending) return;
      positions.set(key, viewport.scrollTop);
      recentPositions.set(path, viewport.scrollTop);
    };
    const finish = (): void => {
      pending = false;
      resize?.disconnect();
      remember();
    };
    const restore = (): void => {
      viewport.scrollTop = target;
      if (Math.abs(viewport.scrollTop - target) < 1) finish();
    };
    const scrollKeys = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (scrollKeys.has(event.key)) finish();
    };

    restore();
    if (pending) {
      resize = new ResizeObserver(restore);
      resize.observe(inner);
      resize.observe(viewport);
    }
    viewport.addEventListener("scroll", remember, { passive: true });
    viewport.addEventListener("wheel", finish, { passive: true });
    viewport.addEventListener("pointerdown", finish);
    viewport.addEventListener("keydown", onKeyDown);
    return () => {
      resize?.disconnect();
      viewport.removeEventListener("scroll", remember);
      viewport.removeEventListener("wheel", finish);
      viewport.removeEventListener("pointerdown", finish);
      viewport.removeEventListener("keydown", onKeyDown);
    };
  }, [key, path, restoreRecent]);

  return { page, content };
}
