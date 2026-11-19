import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const WriteIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const PlanIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);

export const WorldIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Icon>
);

export const AssistantIcon = () => (
  <Icon>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
    <path d="M9 9h6M9 13h4" />
  </Icon>
);

export const BackupIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </Icon>
);

export const ConnectionsIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.1.5l1.4-1.4a5 5 0 0 0-7-7.1L10 6.5" />
    <path d="M14 11a5 5 0 0 0-7.1-.5L5.5 12a5 5 0 0 0 7.1 7.1L14 17.5" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9 7V4.5h6V7" />
    <path d="M6 7l1 12.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7M10 11v6M14 11v6" />
  </Icon>
);

export const HelpIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.2-2.5 4" />
    <path d="M12 17.5h.01" />
  </Icon>
);

export const CollapseIcon = () => (
  <Icon>
    <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Icon>
);

export const ContrastIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="m8 10 4 4 4-4" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon>
    <path d="m10 8 4 4-4 4" />
  </Icon>
);

export const BookIcon = () => (
  <Icon>
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
    <path d="M5 17a3 3 0 0 1 3-3h11" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="1.65" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.65" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.65" fill="currentColor" stroke="none" />
  </Icon>
);

export const PanelLeftIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
);

export const PanelRightIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Icon>
);

export const FocusIcon = () => (
  <Icon>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </Icon>
);

export const BoldIcon = () => (
  <Icon>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
  </Icon>
);

export const ItalicIcon = () => (
  <Icon>
    <path d="M14 5h-4M14 19h-4M14 5l-4 14" />
  </Icon>
);

export const BulletListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="18" r="1" />
  </Icon>
);

export const NumberListIcon = () => (
  <Icon>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 5h1v4M4 9h2M4 14.5a1 1 0 0 1 2 0c0 1-2 1.5-2 3h2" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.1.5l1.4-1.4a5 5 0 0 0-7-7.1L10 6.5" />
    <path d="M14 11a5 5 0 0 0-7.1-.5L5.5 12a5 5 0 0 0 7.1 7.1L14 17.5" />
  </Icon>
);

export const SpellcheckIcon = () => (
  <Icon>
    <path d="M4 15 7.5 5 11 15M5.3 12h4.4" />
    <path d="m13 15 3 3 5-6" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Icon>
);

export const HistoryIcon = () => (
  <Icon>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </Icon>
);

export const SparkleIcon = () => (
  <Icon>
    <path
      d="M12 3l1.2 4.2L17.5 8.5 13.2 9.8 12 14l-1.2-4.2L6.5 8.5l4.3-1.3L12 3zM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3zM6 15.5l.55 1.8 1.8.55-1.8.55L6 20.2l-.55-1.8-1.8-.55 1.8-.55L6 15.5z"
      fill="currentColor"
      stroke="none"
    />
  </Icon>
);

export const MemoryIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="4" rx="1" />
    <rect x="4" y="10" width="16" height="4" rx="1" />
    <rect x="4" y="15" width="16" height="4" rx="1" />
  </Icon>
);

export const ExpandCornersIcon = () => (
  <Icon>
    <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
    <path d="M3 3l7 7M21 3l-7 7M3 21l7-7M21 21l-7-7" />
  </Icon>
);

export const ExtLinkIcon = () => (
  <svg
    className="icon"
    viewBox="0 0 24 24"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" />
  </svg>
);

export const SendIcon = () => (
  <Icon>
    <path d="M4 12l15-7-7 15-2-6-6-2z" />
  </Icon>
);

export const AttachIcon = () => (
  <Icon>
    <path d="M8 12.5V8a4 4 0 018 0v7a2.5 2.5 0 01-5 0V9" />
  </Icon>
);

export const BranchIcon = () => (
  <Icon>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="12" cy="18" r="2" />
    <path d="M6 8v4a4 4 0 004 4M18 8v4a4 4 0 01-4 4" />
  </Icon>
);

export const ListRowsIcon = () => (
  <Icon>
    <path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
  </Icon>
);
