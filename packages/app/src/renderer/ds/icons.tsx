import type { ComponentProps, ReactElement } from "react";

type IconProps = ComponentProps<"svg"> & { size?: number };

function icon(path: ReactElement, viewBox = "0 0 16 16") {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
        {path}
      </svg>
    );
  };
}

export const CheckIcon = icon(<path d="m3.5 8.5 3 3 6-7" />);
export const DashIcon = icon(<path d="M4 8h8" />);
export const ChevronUpDownIcon = icon(<path d="m5 6 3-3 3 3M5 10l3 3 3-3" />);
export const ChevronDownIcon = icon(<path d="m4.5 6.5 3.5 3.5 3.5-3.5" />);
export const ChevronUpIcon = icon(<path d="m4.5 9.5 3.5-3.5 3.5 3.5" />);
export const XIcon = icon(<path d="m4.5 4.5 7 7m0-7-7 7" />);
export const SearchIcon = icon(<><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3 3" /></>);
export const EyeIcon = icon(<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8Z" /><circle cx="8" cy="8" r="2" /></>);
export const EyeOffIcon = icon(<><path d="M6.4 4c.5-.15 1-.25 1.6-.25 4 0 6.25 4.25 6.25 4.25s-.6 1.1-1.75 2.25M4.2 5.2C2.6 6.3 1.75 8 1.75 8S4 12.25 8 12.25c1.2 0 2.25-.4 3.1-.9" /><path d="M6.6 6.6a2 2 0 0 0 2.8 2.8M2.5 2.5l11 11" /></>);
export const PlusIcon = icon(<path d="M8 3.5v9M3.5 8h9" />);
export const MinusIcon = icon(<path d="M3.5 8h9" />);
export const AlertIcon = icon(<><circle cx="8" cy="8" r="6.25" /><path d="M8 5v3.5" /><circle cx="8" cy="11" r="0.4" fill="currentColor" /></>);
export const FolderIcon = icon(<path d="M2 4.75c0-.7.55-1.25 1.25-1.25h2.9l1.5 1.5h5.1c.7 0 1.25.55 1.25 1.25v5.5c0 .7-.55 1.25-1.25 1.25h-9.5C2.55 13 2 12.45 2 11.75Z" />);
export const LinkIcon = icon(<><path d="M6.75 9.25a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.5.5" /><path d="M9.25 6.75a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.5-.5" /></>);
export const SunIcon = icon(<><circle cx="8" cy="8" r="2.75" /><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" /></>);
export const MoonIcon = icon(<path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85Z" />);
export const MonitorIcon = icon(<><rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" /><path d="M6 14h4M8 11.25V14" /></>);
