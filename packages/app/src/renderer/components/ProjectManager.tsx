import type { ProjectManagerIdentity } from "@pecore/schemas";
import type { CSSProperties } from "react";
import s from "./ProjectManager.module.css";

function light(color: string): boolean {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel: number = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

export function ProjectManagerAvatar({ pm, compact = false }: { pm: ProjectManagerIdentity; compact?: boolean }) {
  return (
    <span className={[s.avatar, compact && s.compact, light(pm.color) && s.light].filter(Boolean).join(" ")}
      style={{ "--pm": pm.color } as CSSProperties} aria-hidden>
      {pm.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
