import type { ComponentProps, ReactElement } from "react";

export type IconSize = "xs" | "sm" | "md";

type IconProps = ComponentProps<"svg"> & { size?: IconSize; bold?: boolean };

function icon(path: ReactElement, viewBox = "0 0 16 16") {
  return function Icon({ size = "sm", bold = false, ...props }: IconProps) {
    return (
      <svg data-icon={size} data-bold={bold || undefined} viewBox={viewBox} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
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
export const PlayIcon = icon(<path d="M5 3.6v8.8c0 .5.55.8.98.54l6.9-4.4a.64.64 0 0 0 0-1.08l-6.9-4.4A.64.64 0 0 0 5 3.6Z" fill="currentColor" stroke="none" />);
export const PauseIcon = icon(<><rect x="4" y="3" width="2.6" height="10" rx=".8" fill="currentColor" stroke="none" /><rect x="9.4" y="3" width="2.6" height="10" rx=".8" fill="currentColor" stroke="none" /></>);
export const StopIcon = icon(<rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.6" fill="currentColor" stroke="none" />);
export const BellIcon = icon(<><path d="M4 11.25V7a4 4 0 1 1 8 0v4.25l1.25 1.25H2.75Z" /><path d="M6.5 14a1.6 1.6 0 0 0 3 0" /></>);
export const FactoryIcon = icon(<path d="M2 13.5V6.75l3.5 2.25V6.75L9 9V3h4.5v10.5Z M5 11.25h1.5M8.5 11.25H10" />);
export const ListIcon = icon(<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeWidth={1.8} />);
export const InboxIcon = icon(<><path d="M2 9.25 3.6 3.9c.15-.5.6-.85 1.13-.85h6.54c.52 0 .98.34 1.13.85L14 9.25V12c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1Z" /><path d="M2 9.25h3.25l.75 1.5h4l.75-1.5H14" /></>);
export const ChatIcon = icon(<path d="M2.25 7.6c0-2.75 2.57-4.85 5.75-4.85s5.75 2.1 5.75 4.85S11.18 12.45 8 12.45c-.6 0-1.17-.07-1.71-.2L3.5 13.5l.7-2.45C2.98 10.18 2.25 8.96 2.25 7.6Z" />);
export const BoxIcon = icon(<><path d="M8 1.9 13.75 5v6L8 14.1 2.25 11V5Z" /><path d="M2.25 5 8 8.1 13.75 5M8 8.1v6" /></>);
export const ChartIcon = icon(<path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" strokeWidth={1.8} />);
export const BookIcon = icon(<><path d="M2.75 3.25c1.9-.6 3.65-.4 5.25.75v9c-1.6-1.15-3.35-1.35-5.25-.75Z" /><path d="M13.25 3.25c-1.9-.6-3.65-.4-5.25.75v9c1.6-1.15 3.35-1.35 5.25-.75Z" /></>);
export const GearIcon = icon(<><circle cx="8" cy="8" r="2.1" /><path d="M8 1.75v1.6M8 12.65v1.6M14.25 8h-1.6M3.35 8h-1.6M12.42 3.58l-1.13 1.13M4.71 11.29l-1.13 1.13M12.42 12.42l-1.13-1.13M4.71 4.71 3.58 3.58" /><circle cx="8" cy="8" r="4.6" /></>);
export const MoreIcon = icon(<><circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" /></>);
export const SidebarIcon = icon(<><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="M6 2.75v10.5" /></>);
export const ArrowRightIcon = icon(<path d="M3 8h10M9 4l4 4-4 4" />);
export const ArrowUpIcon = icon(<path d="M8 13V3M4 7l4-4 4 4" />);
export const CompactIcon = icon(<path d="M1.5 8h4.75m-2.5-2.5L6.25 8l-2.5 2.5M14.5 8H9.75m2.5-2.5L9.75 8l2.5 2.5" />);
export const ClipIcon = icon(<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />, "0 0 24 24");
export const TrashIcon = icon(<path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.6c.05.66.6 1.15 1.25 1.15h4.3c.66 0 1.2-.5 1.25-1.15l.6-8.6M6.75 7v4.5M9.25 7v4.5" />);
export const RefreshIcon = icon(<><path d="M13.25 8A5.25 5.25 0 1 1 11.6 4.2" /><path d="M13.25 2.5v3h-3" /></>);
export const InfoIcon = icon(<><circle cx="8" cy="8" r="6.25" /><path d="M8 7.25V11" /><circle cx="8" cy="5" r="0.4" fill="currentColor" /></>);
export const CheckCircleIcon = icon(<><circle cx="8" cy="8" r="6.25" /><path d="m5.5 8.25 1.75 1.75 3.25-3.75" /></>);
export const SparkIcon = icon(<path d="M8 1.75c.4 3.1 1.6 4.65 5.25 5.25-3.65.6-4.85 2.15-5.25 5.25-.4-3.1-1.6-4.65-5.25-5.25C6.4 6.4 7.6 4.85 8 1.75ZM12.75 11.5c.15 1.15.6 1.6 1.5 1.75-.9.15-1.35.6-1.5 1.75-.15-1.15-.6-1.6-1.5-1.75.9-.15 1.35-.6 1.5-1.75Z" />);
export const MonitorIcon = icon(<><rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" /><path d="M6 14h4M8 11.25V14" /></>);
