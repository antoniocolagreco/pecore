import type { CSSProperties } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { BoxIcon, BookIcon } from "../ds/icons";
import type { IconSize } from "../ds/icons";
import { Select } from "../ds/select";
import type { Option } from "../ds/select";
import s from "./DefinitionIcon.module.css";

export type DefinitionType = "node" | "recipe";
type IconLibrary = ReadonlyMap<string, string>;
const automaticIcon: string = "__automatic";

export function useDefinitionIcons() {
  return useData(async (): Promise<IconLibrary> => {
    const entries = await call("listDefinitions", { query: { dir: "templates/icons" } });
    const icons = new Map<string, string>();
    for (const { path, value, errors } of entries) {
      if (typeof value !== "string" || errors.length) continue;
      const name: string = path.slice("templates/icons/".length, -".svg".length);
      icons.set(name, `url("data:image/svg+xml,${encodeURIComponent(value.trim())}")`);
    }
    return icons;
  }, [], (event) => event.type === "definition.changed" && event.path.startsWith("templates/icons/"));
}

export function DefinitionIcon({ icons, type, name, selected, size = "md" }: {
  icons: IconLibrary | undefined;
  type: DefinitionType;
  name: string;
  selected?: string;
  size?: IconSize;
}) {
  const image: string | undefined = icons?.get(selected || `${type}-${name}`);
  if (image) return <span aria-hidden="true" className={s.icon} data-icon={size} style={{ "--icon-image": image } as CSSProperties} />;
  const Fallback = type === "node" ? BoxIcon : BookIcon;
  return <Fallback size={size} />;
}

export function DefinitionIconField({ icons, type, name, value, disabled, onChange }: {
  icons: IconLibrary | undefined;
  type: DefinitionType;
  name: string;
  value: string;
  disabled: boolean;
  onChange(value: string | undefined): void;
}) {
  const options: Option[] = [{ value: automaticIcon, label: "Automatic" }, ...[...(icons?.keys() ?? [])].map((icon) => ({ value: icon, label: icon }))];
  if (value && !icons?.has(value)) options.push({ value, label: value });
  return <div className={s.field}>
    <span className={s.preview}><DefinitionIcon icons={icons} type={type} name={name} selected={value} /></span>
    <Select label="Icon" value={value || automaticIcon} options={options} disabled={disabled}
      onValueChange={(next) => onChange(next === automaticIcon ? undefined : next ?? undefined)} />
  </div>;
}
