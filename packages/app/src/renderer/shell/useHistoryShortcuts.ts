import { useEffect } from "react";
import { useNavigate } from "react-router";

export function useHistoryShortcuts(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.shiftKey || event.ctrlKey) return;
      const arrows = event.altKey && !event.metaKey;
      const brackets = event.metaKey && !event.altKey;
      const back = event.key === "BrowserBack" || (arrows && event.key === "ArrowLeft") || (brackets && event.key === "[");
      const forward = event.key === "BrowserForward" || (arrows && event.key === "ArrowRight") || (brackets && event.key === "]");
      if (!back && !forward) return;
      if (arrows && event.target instanceof Element && event.target.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      void navigate(back ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);
}
