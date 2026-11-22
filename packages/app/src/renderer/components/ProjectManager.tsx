import { projectManagerClash } from "@pecore/schemas";
import type { ProjectManagerIdentity } from "@pecore/schemas";
import type { CSSProperties } from "react";
import { TextField } from "../ds/field";
import s from "./ProjectManager.module.css";

function light(color: string): boolean {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel: number = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

export function ProjectManagerAvatar({ pm }: { pm: ProjectManagerIdentity }) {
  return (
    <span className={`${s.avatar} ${light(pm.color) ? s.light : ""}`} style={{ "--pm": pm.color } as CSSProperties} aria-hidden>
      {pm.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProjectDot({ pm }: { pm: ProjectManagerIdentity | null }) {
  return pm ? <span className={s.dot} style={{ background: pm.color }} title={`Project Manager ${pm.name}`} aria-hidden /> : null;
}

export function projectManagerError(pm: ProjectManagerIdentity, used: ProjectManagerIdentity[]): string | null {
  if (!pm.name.trim()) return "Enter a name.";
  const clash = projectManagerClash({ ...pm, name: pm.name.trim() }, used);
  return clash ? `Another project's Project Manager already uses this ${clash === "name" ? "name" : "colour"}.` : null;
}

export function ProjectManagerField({ value, used, disabled, onChange }: {
  value: ProjectManagerIdentity;
  used: ProjectManagerIdentity[];
  disabled?: boolean;
  onChange(value: ProjectManagerIdentity): void;
}) {
  const error: string | null = value.name ? projectManagerError(value, used) : null;
  return (
    <TextField label="Project Manager" required disabled={disabled} value={value.name}
      description="Its name and colour tell this project apart in chats and lists."
      error={error ?? undefined}
      leading={<span className={s.swatch} style={{ background: value.color }}>
        <input type="color" className={s.picker} aria-label="Project Manager colour" disabled={disabled}
          value={value.color.toLowerCase()} onChange={(event) => onChange({ ...value, color: event.target.value.toUpperCase() })} />
      </span>}
      onValueChange={(name) => onChange({ ...value, name })} />
  );
}
