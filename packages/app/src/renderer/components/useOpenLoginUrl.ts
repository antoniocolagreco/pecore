import { useEffect } from "react";

const opened: Set<string> = new Set();

export function useOpenLoginUrl(loginId: string | null | undefined, url: string | null | undefined): void {
  useEffect(() => {
    if (!loginId || !url?.startsWith("https://")) return;
    const key: string = `${loginId}\n${url}`;
    if (opened.has(key)) return;
    opened.add(key);
    window.open(url, "_blank", "noreferrer");
  }, [loginId, url]);
}
