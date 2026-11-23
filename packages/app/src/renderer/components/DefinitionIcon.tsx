import type { CSSProperties } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { BoxIcon, BookIcon } from "../ds/icons";
import type { IconSize } from "../ds/icons";
import { IconSelect } from "../ds/select";
import type { IconOption } from "../ds/select";
import s from "./DefinitionIcon.module.css";

export type DefinitionType = "node" | "recipe";
type IconLibrary = ReadonlyMap<string, string>;
export const defaultDefinitionIcon: Record<DefinitionType, string> = { node: "node-default", recipe: "recipe-default" };

export function definitionIconName(icons: IconLibrary | undefined, type: DefinitionType, name: string): string {
  const legacyName: string = `${type}-${name}`;
  return icons?.has(legacyName) ? legacyName : defaultDefinitionIcon[type];
}

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
  const icon: string = selected || definitionIconName(icons, type, name);
  const image: string | undefined = icons?.get(icon);
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
  onChange(value: string): void;
}) {
  const defaultIcon: string = defaultDefinitionIcon[type];
  const selected: string = value || definitionIconName(icons, type, name);
  const options: IconOption[] = [
    { value: defaultIcon, label: type === "node" ? "Box" : "Book", icon: <DefinitionIcon icons={icons} type={type} name={name} selected={defaultIcon} /> },
    ...[...(icons?.keys() ?? [])].filter((icon) => icon !== defaultIcon)
      .map((icon) => ({ value: icon, label: icon, icon: <DefinitionIcon icons={icons} type={type} name={name} selected={icon} /> })),
  ];
  if (value && value !== defaultIcon && !icons?.has(value)) options.push({ value, label: value, icon: <DefinitionIcon icons={icons} type={type} name={name} selected={value} /> });
  return <div className={s.field}>
    <span className={s.preview}><DefinitionIcon icons={icons} type={type} name={name} selected={selected} /></span>
    <IconSelect label="Icon" value={selected} options={options} disabled={disabled} onValueChange={onChange} />
  </div>;
}
